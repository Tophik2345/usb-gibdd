-- Search indexes public test metadata only; historical events remain scoped.
create function public.knowledge_search(payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); op text; q text; words text[]; kind text; title_cursor text; id_cursor text; rows jsonb; total integer; t knowledge_private.tests;
begin
  perform knowledge_private.require_active_account();
  if not exists(select 1 from auth.users where id=uid and email_confirmed_at is not null) then raise exception using errcode='PT401',message='Подтвердите почту и войдите в аккаунт.'; end if;
  if jsonb_typeof(payload) is distinct from 'object' or octet_length(payload::text)>4096 then raise exception using errcode='PT400',message='Некорректный поиск.'; end if;
  op:=coalesce(payload->>'action','search');
  if op='test' then
    if jsonb_typeof(payload->'id') is distinct from 'string' or char_length(payload->>'id') not between 1 and 100 then raise exception using errcode='PT400',message='Выберите тест.'; end if;
    select * into t from knowledge_private.tests where id=payload->>'id' and published;
    if not found then raise exception using errcode='PT404',message='Тест снят с публикации или удалён. Обновите поиск.'; end if;
    return knowledge_private.test_json(t,uid,false);
  elsif op<>'search' then raise exception using errcode='PT400',message='Неизвестное действие.'; end if;
  if jsonb_typeof(payload->'query') is distinct from 'string' then raise exception using errcode='PT400',message='Введите запрос.'; end if;
  q:=translate(lower(btrim(regexp_replace(payload->>'query','\s+',' ','g'))),'ё','е');
  if char_length(q) not between 2 and 100 then raise exception using errcode='PT400',message='Запрос: от 2 до 100 символов.'; end if;
  select array_agg(case when w ~ '^[а-я]{5,}$' then regexp_replace(w,'(иями|ями|ами|ого|ему|ому|ыми|ими|ая|яя|ое|ее|ые|ие|ию|ия|ую|юю|ий|ый|ой|ов|ев|ам|ям|ах|ях|ом|ем|а|я|ы|и|у|ю|е|о)$','') else w end)
    into words from unnest(string_to_array(q,' ')) w;
  kind:=coalesce(payload->>'kind','test');
  if kind not in ('test','material') then raise exception using errcode='PT400',message='Выберите область поиска.'; end if;
  if payload->'cursor' is not null and payload->'cursor'<>'null'::jsonb then
    if jsonb_typeof(payload->'cursor')<>'object' or jsonb_typeof(payload->'cursor'->'title') is distinct from 'string'
      or jsonb_typeof(payload->'cursor'->'id') is distinct from 'string' or char_length(payload->'cursor'->>'title')>300
      or char_length(payload->'cursor'->>'id') not between 1 and 150 then raise exception using errcode='PT400',message='Обновите страницу поиска.'; end if;
    title_cursor:=payload->'cursor'->>'title';id_cursor:=payload->'cursor'->>'id';
  end if;
  with candidates as materialized (
    select 'test:'||x.id id,x.title,left(x.description,280) summary,x.category source,x.id target_id,null::text href,
      translate(lower(x.title),'ё','е') sort_title,translate(lower(x.title||' '||x.description||' '||x.category),'ё','е') searchable
      from knowledge_private.tests x where kind='test' and x.published
    union all
    select 'material:'||m.id,m.title,left(m.description,280),'Материал подготовки',null,m.href,
      translate(lower(m.title),'ё','е'),translate(lower(m.title||' '||m.description),'ё','е')
      from knowledge_private.training_materials m where kind='material'
  ), matched as materialized (
    select * from candidates c where not exists(select 1 from unnest(words) w where strpos(c.searchable,w)=0)
  ), page as (
    select * from matched where title_cursor is null or (sort_title,id)>(title_cursor,id_cursor)
      order by sort_title,id limit 21
  )
  select (select count(*) from matched),coalesce(jsonb_agg(jsonb_build_object('id',id,'kind',kind,'title',title,'summary',summary,
    'source',source,'targetId',target_id,'href',href,'sortTitle',sort_title) order by sort_title,id),'[]'::jsonb) into total,rows from page;
  return jsonb_build_object('total',total,'items',(select coalesce(jsonb_agg(x order by pos),'[]'::jsonb)
    from jsonb_array_elements(rows) with ordinality j(x,pos) where pos<=20),
    'nextCursor',case when jsonb_array_length(rows)>20 then jsonb_build_object('title',rows->19->>'sortTitle','id',rows->19->>'id') else null end);
end; $$;
revoke all on function public.knowledge_search(jsonb) from public,anon,authenticated;
grant execute on function public.knowledge_search(jsonb) to authenticated;
comment on function public.knowledge_search(jsonb) is 'Metadata search 20261002020000';

create index management_events_person_history on knowledge_private.management_events(area,target_id,created_at desc,id desc)
  where area in ('department_members','service_clearances');

create function knowledge_private.person_history(subject uuid, tests boolean, ranks boolean, clearances boolean)
returns table(event_key text,kind text,title text,summary text,target_id text,occurred_at timestamptz)
language sql stable set search_path='' as $$
  select 'result:'||a.id,'result',a.test_title,
    case when a.score*100>=a.total*a.pass_mark then 'Зачёт' else 'Без зачёта' end||' · '||a.score||' из '||a.total||' · '||round(a.score::numeric*100/a.total,1)||'%',a.id,a.finished_at
    from knowledge_private.attempts a where $2 and a.user_id=$1 and a.mode='exam' and a.finished_at is not null
      and not exists(select 1 from knowledge_private.tests t where t.id=a.test_id and t.demo)
  union all
  select 'rank:'||e.id,'rank','Присвоено звание «'||(e.details->>'rank')||'»',
    coalesce(e.details->>'previousRank','')||' → '||(e.details->>'rank')||' · '||e.actor_login,$1::text,e.created_at
    from knowledge_private.management_events e where $3 and e.area='department_members' and e.target_id=$1::text and e.details ? 'rank'
  union all
  select 'clearance:'||e.id,'clearance',case e.details->>'status' when 'pending' then 'Заявка на допуск отправлена'
    when 'approved' then 'Допуск подтверждён' when 'rejected' then 'Подготовка возвращена на доработку' when 'revoked' then 'Допуск отозван' else 'Допуск изменён' end,
    e.actor_login||case when coalesce(e.details->>'note','')<>'' then ' · '||left(e.details->>'note',600) else '' end,$1::text,e.created_at
    from knowledge_private.management_events e where $4 and e.area='service_clearances' and e.target_id=$1::text and e.operation<>'delete';
$$;
revoke all on function knowledge_private.person_history(uuid,boolean,boolean,boolean) from public,anon,authenticated;

create function public.knowledge_history(payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); subject uuid; level integer:=0; manager boolean:=false; own boolean; view_tests boolean; view_ranks boolean; view_clearances boolean;
  filter_kind text; name text; stamp timestamptz:=clock_timestamp(); snap timestamptz; cursor_at timestamptz; cursor_id text; rows jsonb; total integer;
begin
  perform knowledge_private.require_active_account();
  if not exists(select 1 from auth.users where id=uid and email_confirmed_at is not null) then raise exception using errcode='PT401',message='Подтвердите почту и войдите в аккаунт.'; end if;
  if jsonb_typeof(payload) is distinct from 'object' or octet_length(payload::text)>4096 then raise exception using errcode='PT400',message='Некорректная история.'; end if;
  subject:=uid;
  if payload ? 'userId' then
    if jsonb_typeof(payload->'userId') is distinct from 'string' then raise exception using errcode='PT400',message='Выберите сотрудника.'; end if;
    begin subject:=(payload->>'userId')::uuid;exception when invalid_text_representation then raise exception using errcode='PT400',message='Некорректный сотрудник.'; end;
  end if;
  own:=subject=uid;
  select case when m.active then r.level else 0 end into level from knowledge_private.department_members m
    join knowledge_private.staff_ranks r on r.name=m.rank where m.user_id=uid for share of m;
  level:=coalesce(level,0);
  select role in ('owner','deputy') into manager from knowledge_private.test_creators where user_id=uid for share;
  manager:=coalesce(manager,false);
  view_tests:=own or level>=9;view_ranks:=own or level>=9;view_clearances:=own or manager;
  if not own and level<9 and not manager then raise exception using errcode='PT403',message='История других сотрудников доступна руководителям в пределах их полномочий.'; end if;
  select coalesce(m.display_name,l.login_key) into name from auth.users u join knowledge_private.logins l on l.user_id=u.id
    left join knowledge_private.department_members m on m.user_id=u.id where u.id=subject;
  if name is null then raise exception using errcode='PT404',message='Сотрудник не найден.'; end if;
  filter_kind:=coalesce(payload->>'kind','all');
  if filter_kind not in ('all','result','rank','clearance') then raise exception using errcode='PT400',message='Выберите вид событий.'; end if;
  if (filter_kind='result' and not view_tests) or (filter_kind='rank' and not view_ranks) or (filter_kind='clearance' and not view_clearances) then
    raise exception using errcode='PT403',message='Этот вид истории недоступен.';
  end if;
  snap:=stamp;
  if payload ? 'snapshot' and payload->'snapshot'<>'null'::jsonb then
    if jsonb_typeof(payload->'snapshot')<>'string' then raise exception using errcode='PT400',message='Обновите историю.'; end if;
    begin snap:=(payload->>'snapshot')::timestamptz;exception when others then raise exception using errcode='PT400',message='Некорректная дата истории.'; end;
    if not isfinite(snap) then raise exception using errcode='PT400',message='Некорректная дата истории.'; end if;
    snap:=least(snap,stamp);
  end if;
  if payload->'cursor' is not null and payload->'cursor'<>'null'::jsonb then
    if jsonb_typeof(payload->'cursor')<>'object' or jsonb_typeof(payload->'cursor'->'at') is distinct from 'string'
      or jsonb_typeof(payload->'cursor'->'id') is distinct from 'string' or char_length(payload->'cursor'->>'id') not between 1 and 150 then
      raise exception using errcode='PT400',message='Обновите страницу истории.';
    end if;
    begin cursor_at:=(payload->'cursor'->>'at')::timestamptz;exception when others then raise exception using errcode='PT400',message='Некорректная дата страницы.'; end;
    if not isfinite(cursor_at) then raise exception using errcode='PT400',message='Некорректная дата страницы.'; end if;
    cursor_id:=payload->'cursor'->>'id';
  end if;
  with visible as materialized (
    select * from knowledge_private.person_history(subject,view_tests,view_ranks,view_clearances)
      where occurred_at<=snap and (filter_kind='all' or person_history.kind=filter_kind)
  ), page as (
    select * from visible where cursor_at is null or (occurred_at,event_key)<(cursor_at,cursor_id)
      order by occurred_at desc,event_key desc limit 21
  )
  select (select count(*) from visible),coalesce(jsonb_agg(jsonb_build_object('id',event_key,'kind',page.kind,'title',title,'summary',summary,
    'targetId',target_id,'createdAt',occurred_at) order by occurred_at desc,event_key desc),'[]'::jsonb) into total,rows from page;
  return jsonb_build_object('userId',subject,'displayName',name,'own',own,'snapshot',snap,'total',total,
    'permissions',jsonb_build_object('results',view_tests,'ranks',view_ranks,'clearances',view_clearances,'others',level>=9 or manager),
    'items',(select coalesce(jsonb_agg(x order by pos),'[]'::jsonb) from jsonb_array_elements(rows) with ordinality j(x,pos) where pos<=20),
    'nextCursor',case when jsonb_array_length(rows)>20 then jsonb_build_object('at',rows->19->>'createdAt','id',rows->19->>'id') else null end);
end; $$;
revoke all on function public.knowledge_history(jsonb) from public,anon,authenticated;
grant execute on function public.knowledge_history(jsonb) to authenticated;
comment on function public.knowledge_history(jsonb) is 'Scoped person history 20261002020000';
