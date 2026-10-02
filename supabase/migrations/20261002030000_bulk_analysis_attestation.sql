-- Bulk assignment commits are atomic and retry-safe. Reports read saved snapshots.
create table knowledge_private.bulk_assignment_requests (
  actor_id uuid not null references auth.users(id) on delete cascade,
  request_id uuid not null, parameters jsonb not null, response jsonb,
  created_at timestamptz not null default now(), primary key(actor_id,request_id)
);
alter table knowledge_private.bulk_assignment_requests enable row level security;
revoke all on knowledge_private.bulk_assignment_requests from public,anon,authenticated;

create function public.knowledge_bulk_assign(payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); level integer:=0; op text; t knowledge_private.tests; recipient_ids uuid[]; expected integer;
  deadline timestamptz; key uuid; parameters jsonb; saved knowledge_private.bulk_assignment_requests;
  people jsonb; created jsonb; skipped jsonb; result jsonb; q text; cursor_id uuid; page jsonb; total integer;
begin
  perform knowledge_private.require_active_account();
  if not exists(select 1 from auth.users where id=uid and email_confirmed_at is not null) then raise exception using errcode='PT401',message='Подтвердите почту и войдите в аккаунт.'; end if;
  select case when m.active then r.level else 0 end into level from knowledge_private.department_members m join knowledge_private.staff_ranks r on r.name=m.rank where m.user_id=uid for share of m;
  if coalesce(level,0)<9 then raise exception using errcode='PT403',message='Массовые назначения доступны от звания «Капитан».'; end if;
  if jsonb_typeof(payload) is distinct from 'object' or octet_length(payload::text)>16000 then raise exception using errcode='PT400',message='Некорректное назначение.'; end if;
  op:=coalesce(payload->>'action','recipients');
  if op='recipients' then
    q:=btrim(coalesce(payload->>'query',''));if char_length(q)>100 then raise exception using errcode='PT400',message='Сократите запрос.'; end if;
    if payload ? 'cursor' and payload->'cursor'<>'null'::jsonb then cursor_id:=(payload->>'cursor')::uuid;end if;
    with eligible as materialized (
      select m.user_id,m.display_name,m.static_id,m.rank,l.login_key from knowledge_private.department_members m
        join auth.users u on u.id=m.user_id join knowledge_private.logins l on l.user_id=u.id
        where m.active and u.email_confirmed_at is not null and (u.banned_until is null or u.banned_until<=now())
          and strpos(translate(lower(m.display_name||' '||m.static_id||' '||m.rank||' '||l.login_key),'ё','е'),translate(lower(q),'ё','е'))>0
    ), listed as (select * from eligible where cursor_id is null or user_id>cursor_id order by user_id limit 101)
    select (select count(*) from eligible),coalesce(jsonb_agg(jsonb_build_object('userId',user_id,'displayName',display_name,'login',login_key,'staticId',static_id,'rank',rank) order by user_id),'[]') into total,page from listed;
    return jsonb_build_object('total',total,'items',(select coalesce(jsonb_agg(x order by pos),'[]') from jsonb_array_elements(page) with ordinality j(x,pos) where pos<=100),'nextCursor',case when jsonb_array_length(page)>100 then page->99->>'userId' else null end);
  end if;
  if op not in ('preview','create') then raise exception using errcode='PT400',message='Неизвестное действие.'; end if;
  if jsonb_typeof(payload->'userIds') is distinct from 'array' then raise exception using errcode='PT400',message='Выберите сотрудников.'; end if;
  if jsonb_array_length(payload->'userIds') not between 1 and 100 or exists(select 1 from jsonb_array_elements(payload->'userIds') x where jsonb_typeof(x)<>'string') then raise exception using errcode='PT400',message='Выберите от 1 до 100 сотрудников.'; end if;
  select array_agg(x::uuid order by x::uuid) into recipient_ids from jsonb_array_elements_text(payload->'userIds') x;
  if cardinality(recipient_ids)<>(select count(distinct x) from unnest(recipient_ids) x) then raise exception using errcode='PT400',message='В списке есть повторяющиеся сотрудники.'; end if;
  if jsonb_typeof(payload->'testId') is distinct from 'string' or char_length(payload->>'testId') not between 1 and 100
    or jsonb_typeof(payload->'testVersion') is distinct from 'number' or coalesce(payload->>'testVersion','') !~ '^[0-9]{1,9}$' then raise exception using errcode='PT400',message='Обновите список тестов.'; end if;
  expected:=(payload->>'testVersion')::integer;
  if jsonb_typeof(payload->'dueAt') is distinct from 'string' or coalesce(payload->>'dueAt','') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$' then raise exception using errcode='PT400',message='Укажите срок сдачи.'; end if;
  deadline:=(payload->>'dueAt')::timestamptz;
  if not isfinite(deadline) then raise exception using errcode='PT400',message='Некорректный срок.'; end if;
  parameters:=jsonb_build_object('testId',payload->>'testId','testVersion',expected,'userIds',to_jsonb(recipient_ids),'dueAt',deadline);
  if op='create' then
    if jsonb_typeof(payload->'requestId') is distinct from 'string' then raise exception using errcode='PT400',message='Обновите предварительный список.'; end if;
    key:=(payload->>'requestId')::uuid;
    insert into knowledge_private.bulk_assignment_requests(actor_id,request_id,parameters) values(uid,key,parameters) on conflict do nothing;
    select * into saved from knowledge_private.bulk_assignment_requests where actor_id=uid and request_id=key for update;
    if saved.parameters<>parameters then raise exception using errcode='PT409',message='Этот запрос уже использован для другого назначения. Обновите предварительный список.'; end if;
    if saved.response is not null then return saved.response||jsonb_build_object('replayed',true); end if;
  end if;
  if deadline<=clock_timestamp() then raise exception using errcode='PT400',message='Срок сдачи должен быть в будущем.'; end if;
  select * into t from knowledge_private.tests where id=payload->>'testId' and published and not demo for share;
  if not found then raise exception using errcode='PT409',message='Тест снят с публикации или недоступен. Обновите список.'; end if;
  if t.version<>expected then raise exception using errcode='PT409',message='Тест изменён. Обновите список и проверьте назначения заново.'; end if;
  -- Lock recipients in a common order; archive/block changes wait for this transaction.
  perform 1 from auth.users where id=any(recipient_ids) order by id for share;
  perform 1 from knowledge_private.department_members where user_id=any(recipient_ids) order by user_id for share;
  if (select count(*) from auth.users u join knowledge_private.department_members m on m.user_id=u.id join knowledge_private.logins l on l.user_id=u.id
    where u.id=any(recipient_ids) and m.active and u.email_confirmed_at is not null and (u.banned_until is null or u.banned_until<=now()))<>cardinality(recipient_ids)
  then raise exception using errcode='PT409',message='Один из сотрудников недоступен. Обновите состав и предварительный список.'; end if;
  -- Keep existing assignments active until the skip result is recorded.
  perform 1 from knowledge_private.assignments where user_id=any(recipient_ids) and test_id=t.id
    and completed_at is null and cancelled_at is null and reset_to_id is null order by id for share;
  select jsonb_agg(jsonb_build_object('userId',u.id,'displayName',m.display_name,'login',l.login_key,'existingAssignmentId',a.id) order by u.id) into people
    from auth.users u join knowledge_private.department_members m on m.user_id=u.id join knowledge_private.logins l on l.user_id=u.id
    left join knowledge_private.assignments a on a.user_id=u.id and a.test_id=t.id and a.completed_at is null and a.cancelled_at is null and a.reset_to_id is null where u.id=any(recipient_ids);
  if op='preview' then return jsonb_build_object('test',knowledge_private.test_json(t,uid,false),'dueAt',deadline,'recipients',people,'createCount',(select count(*) from jsonb_array_elements(people) x where x->'existingAssignmentId'='null'),'skipCount',(select count(*) from jsonb_array_elements(people) x where x->'existingAssignmentId'<>'null'));end if;
  with added as (
    insert into knowledge_private.assignments(test_id,author_id,user_id,employee_login,test_title,pass_mark,questions,due_at)
      select t.id,uid,(x->>'userId')::uuid,x->>'login',t.title,t.pass_mark,t.questions,deadline from jsonb_array_elements(people) x where x->'existingAssignmentId'='null'
      on conflict do nothing returning id,user_id
  ) select coalesce(jsonb_agg(jsonb_build_object('id',id,'userId',user_id) order by user_id),'[]') into created from added;
  select coalesce(jsonb_agg(jsonb_build_object('userId',u,'id',a.id) order by u),'[]') into skipped from unnest(recipient_ids) u
    join knowledge_private.assignments a on a.user_id=u and a.test_id=t.id and a.completed_at is null and a.cancelled_at is null and a.reset_to_id is null
    where not exists(select 1 from jsonb_array_elements(created) x where (x->>'userId')::uuid=u);
  result:=jsonb_build_object('testTitle',t.title,'dueAt',deadline,'created',created,'skipped',skipped,'createdCount',jsonb_array_length(created),'skipCount',jsonb_array_length(skipped),'replayed',false);
  update knowledge_private.bulk_assignment_requests set response=result where actor_id=uid and request_id=key;
  return result;
exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow or numeric_value_out_of_range then raise exception using errcode='PT400',message='Проверьте сотрудников, тест и срок сдачи.';
end; $$;
revoke all on function public.knowledge_bulk_assign(jsonb) from public,anon,authenticated;
grant execute on function public.knowledge_bulk_assign(jsonb) to authenticated;
comment on function public.knowledge_bulk_assign(jsonb) is 'Atomic bulk assignments 20261002030000';

create function public.knowledge_analysis(payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); level integer:=0; days integer:=30; stamp timestamptz:=clock_timestamp(); day_to date; day_from date; period_start timestamptz;
  selected text:=''; page_offset integer:=0; result jsonb;
begin
  perform knowledge_private.require_active_account();
  if not exists(select 1 from auth.users where id=uid and email_confirmed_at is not null) then raise exception using errcode='PT401',message='Подтвердите почту и войдите в аккаунт.';end if;
  select case when m.active then r.level else 0 end into level from knowledge_private.department_members m join knowledge_private.staff_ranks r on r.name=m.rank where m.user_id=uid for share of m;
  if coalesce(level,0)<9 then raise exception using errcode='PT403',message='Анализ ошибок доступен от звания «Капитан».';end if;
  if jsonb_typeof(payload) is distinct from 'object' or octet_length(payload::text)>4096 then raise exception using errcode='PT400',message='Некорректный анализ.';end if;
  if payload ? 'days' then if jsonb_typeof(payload->'days')<>'number' or payload->>'days' not in ('7','30','90') then raise exception using errcode='PT400',message='Выберите период: 7, 30 или 90 дней.';end if;days:=(payload->>'days')::integer;end if;
  if payload ? 'testId' then if jsonb_typeof(payload->'testId')<>'string' or char_length(payload->>'testId')>100 then raise exception using errcode='PT400',message='Выберите тест.';end if;selected:=payload->>'testId';end if;
  if payload ? 'offset' then if jsonb_typeof(payload->'offset')<>'number' or payload->>'offset' !~ '^[0-9]{1,7}$' then raise exception using errcode='PT400',message='Обновите анализ.';end if;page_offset:=(payload->>'offset')::integer;end if;
  if payload ? 'snapshot' then if jsonb_typeof(payload->'snapshot')<>'string' then raise exception using errcode='PT400',message='Обновите анализ.';end if;stamp:=(payload->>'snapshot')::timestamptz;if not isfinite(stamp) then raise exception using errcode='PT400',message='Некорректная дата анализа.';end if;stamp:=least(stamp,clock_timestamp());end if;
  day_to:=(stamp at time zone 'Europe/Moscow')::date;day_from:=day_to-(days-1);period_start:=day_from::timestamp at time zone 'Europe/Moscow';
  with all_exams as materialized (
    select a.*,t.category from knowledge_private.attempts a join knowledge_private.tests t on t.id=a.test_id
      where a.mode='exam' and a.finished_at>=period_start and a.finished_at<=stamp and not t.demo
  ), exams as materialized (select * from all_exams where selected='' or test_id=selected), answers as materialized (
    select a.id attempt_id,a.test_id,a.test_title,a.test_version,a.category,q->>'id' question_id,q->>'text' question_text,
      (select jsonb_agg(value order by value) from jsonb_array_elements(q->'options')) options_key,
      q->'options'->((q->>'correct')::integer) correct_text,
      coalesce(a.answers->(q->>'id')=q->'correct',false) correct,a.answers->(q->>'id') is null unanswered
      from exams a cross join lateral jsonb_array_elements(a.questions) q
  ), grouped as materialized (
    select test_id,test_title,test_version,question_id,question_text,options_key,correct_text,count(*) seen,
      count(*) filter(where not correct) wrong,count(*) filter(where unanswered) unanswered
      from answers group by test_id,test_title,test_version,question_id,question_text,options_key,correct_text
  ), problematic as materialized (
    select *,row_number() over(order by wrong::numeric/seen desc,wrong desc,seen desc,test_title,test_version nulls last,question_text,question_id,options_key,correct_text) ordinal from grouped where wrong>0
  ), question_page as (select * from problematic order by ordinal limit 20 offset page_offset), topics as (
    select category,count(distinct attempt_id) exams,count(*) seen,count(*) filter(where not correct) wrong,count(*) filter(where unanswered) unanswered from answers group by category
  ) select jsonb_build_object('snapshot',stamp,'period',jsonb_build_object('days',days,'from',day_from,'to',day_to),
    'summary',jsonb_build_object('exams',(select count(*) from exams),'seen',(select count(*) from answers),'wrong',(select count(*) from answers where not correct),'unanswered',(select count(*) from answers where unanswered),'errorRate',(select round(count(*) filter(where not correct)::numeric*100/nullif(count(*),0),1) from answers)),
    'tests',(select coalesce(jsonb_agg(jsonb_build_object('id',test_id,'title',title) order by title,test_id),'[]') from (select test_id,max(test_title) title from all_exams group by test_id) choices),
    'topics',(select coalesce(jsonb_agg(jsonb_build_object('name',category,'exams',exams,'seen',seen,'wrong',wrong,'unanswered',unanswered,'errorRate',round(wrong::numeric*100/seen,1)) order by wrong::numeric/seen desc,category),'[]') from topics),
    'totalQuestions',(select count(*) from problematic),'questions',(select coalesce(jsonb_agg(jsonb_build_object('id','question:'||ordinal,'testId',test_id,'testTitle',test_title,'version',test_version,'text',question_text,'seen',seen,'wrong',wrong,'unanswered',unanswered,'errorRate',round(wrong::numeric*100/seen,1)) order by ordinal),'[]') from question_page),
    'nextOffset',case when page_offset+20<(select count(*) from problematic) then page_offset+20 else null end) into result;
  return result;
exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow or numeric_value_out_of_range then raise exception using errcode='PT400',message='Проверьте фильтры анализа.';
end; $$;
revoke all on function public.knowledge_analysis(jsonb) from public,anon,authenticated;
grant execute on function public.knowledge_analysis(jsonb) to authenticated;
comment on function public.knowledge_analysis(jsonb) is 'Snapshot error analysis 20261002030000';

create function public.knowledge_attestation(payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); subject uuid; level integer:=0; manager boolean:=false; own boolean; stamp timestamptz:=clock_timestamp();
  person jsonb; results jsonb; clearance jsonb; view_results boolean; view_clearance boolean;
begin
  perform knowledge_private.require_active_account();
  if not exists(select 1 from auth.users where id=uid and email_confirmed_at is not null) then raise exception using errcode='PT401',message='Подтвердите почту и войдите в аккаунт.';end if;
  if jsonb_typeof(payload) is distinct from 'object' or octet_length(payload::text)>4096 then raise exception using errcode='PT400',message='Некорректная карточка.';end if;
  subject:=uid;if payload ? 'userId' then if jsonb_typeof(payload->'userId')<>'string' then raise exception using errcode='PT400',message='Выберите сотрудника.';end if;subject:=(payload->>'userId')::uuid;end if;own:=subject=uid;
  select case when m.active then r.level else 0 end into level from knowledge_private.department_members m join knowledge_private.staff_ranks r on r.name=m.rank where m.user_id=uid for share of m;
  select role in ('owner','deputy') into manager from knowledge_private.test_creators where user_id=uid for share;
  view_results:=own or coalesce(level,0)>=9;view_clearance:=own or coalesce(manager,false);
  if not own and not view_results and not view_clearance then raise exception using errcode='PT403',message='Карточки других сотрудников доступны руководителям в пределах их полномочий.';end if;
  select jsonb_build_object('userId',u.id,'displayName',coalesce(m.display_name,l.login_key),'staticId',coalesce(m.static_id,''),'rank',m.rank,'position',m.position,'active',coalesce(m.active,false)) into person
    from auth.users u join knowledge_private.logins l on l.user_id=u.id left join knowledge_private.department_members m on m.user_id=u.id where u.id=subject;
  if person is null then raise exception using errcode='PT404',message='Сотрудник не найден.';end if;
  with latest as materialized (
    select distinct on(a.test_id) a.* from knowledge_private.attempts a join knowledge_private.tests t on t.id=a.test_id
      where view_results and a.user_id=subject and a.mode='exam' and a.finished_at is not null and a.finished_at<=stamp and not t.demo
      order by a.test_id,a.finished_at desc,a.id desc
  ) select (select coalesce(jsonb_agg(jsonb_build_object('id',id,'testId',test_id,'title',test_title,'version',test_version,'score',score,'total',total,'passMark',pass_mark,'finishedAt',finished_at) order by finished_at desc,id desc),'[]') from latest),
    case when view_clearance then knowledge_private.clearance_state(subject) else null end into results,clearance;
  if clearance is not null then clearance:=jsonb_build_object('status',clearance->'status','ready',clearance->'ready','programVersion',clearance->'programVersion','note',clearance->'note','requestedAt',clearance->'requestedAt','decidedAt',clearance->'decidedAt','decidedBy',clearance->'decidedBy',
    'materialCount',jsonb_array_length(clearance->'materials'),'materialsRead',(select count(*) from jsonb_array_elements(clearance->'materials') x where x->'readAt'<>'null'),
    'requiredTestCount',jsonb_array_length(clearance->'tests'),'requiredTestsPassed',(select count(*) from jsonb_array_elements(clearance->'tests') x where x->>'passed'='true'));end if;
  return jsonb_build_object('serverNow',stamp,'own',own,'person',person,'permissions',jsonb_build_object('results',view_results,'clearance',view_clearance),'results',case when view_results then results else null end,'clearance',clearance);
exception when invalid_text_representation then raise exception using errcode='PT400',message='Некорректный сотрудник.';
end; $$;
revoke all on function public.knowledge_attestation(jsonb) from public,anon,authenticated;
grant execute on function public.knowledge_attestation(jsonb) to authenticated;
comment on function public.knowledge_attestation(jsonb) is 'Scoped attestation card 20261002030000';
