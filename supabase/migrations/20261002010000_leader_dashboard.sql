-- Read-only leader overview. Test ranks and training roles remain separate.
create index service_clearances_pending_dashboard
  on knowledge_private.service_clearances(requested_at,user_id) where status='pending';

create function public.knowledge_dashboard(payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  uid uuid:=auth.uid(); stamp timestamptz:=clock_timestamp(); op text;
  level integer:=0; training_manager boolean:=false; days integer:=30;
  day_to date; day_from date; period_start timestamptz; tests jsonb; clearances jsonb;
  target text; person uuid; person_data jsonb; item knowledge_private.assignments;
begin
  perform knowledge_private.require_active_account();
  if not exists(select 1 from auth.users where id=uid and email_confirmed_at is not null) then
    raise exception using errcode='PT401',message='Подтвердите почту и войдите в аккаунт.';
  end if;
  select case when m.active then r.level else 0 end into level
    from knowledge_private.department_members m join knowledge_private.staff_ranks r on r.name=m.rank
    where m.user_id=uid for share of m;
  level:=coalesce(level,0);
  select role in ('owner','deputy') into training_manager
    from knowledge_private.test_creators where user_id=uid for share;
  training_manager:=coalesce(training_manager,false);
  if level<9 and not training_manager then
    raise exception using errcode='PT403',message='Сводка доступна от звания «Капитан», а заявки на допуск — владельцу и заместителю.';
  end if;
  if jsonb_typeof(payload) is distinct from 'object' or octet_length(payload::text)>4096 then
    raise exception using errcode='PT400',message='Некорректные данные сводки.';
  end if;
  op:=coalesce(payload->>'action','summary');
  if op='assignment' then
    if level<9 then raise exception using errcode='PT403',message='Назначения сотрудников доступны от звания «Капитан».'; end if;
    target:=payload->>'id';
    if jsonb_typeof(payload->'id') is distinct from 'string' or char_length(target) not between 1 and 100 then
      raise exception using errcode='PT400',message='Выберите назначение.';
    end if;
    select * into item from knowledge_private.assignments where id=target;
    if not found then raise exception using errcode='PT404',message='Назначение не найдено. Обновите сводку.'; end if;
    return knowledge_private.assignment_json(item);
  elsif op='clearance' then
    if not training_manager then raise exception using errcode='PT403',message='Подготовка сотрудников доступна владельцу и заместителю.'; end if;
    if jsonb_typeof(payload->'userId') is distinct from 'string' then raise exception using errcode='PT400',message='Выберите сотрудника.'; end if;
    begin person:=(payload->>'userId')::uuid;
    exception when invalid_text_representation then raise exception using errcode='PT400',message='Некорректный сотрудник.'; end;
    select jsonb_build_object('userId',u.id,'login',l.login_key,'state',knowledge_private.clearance_state(u.id)) into person_data
      from auth.users u join knowledge_private.logins l on l.user_id=u.id
      left join knowledge_private.department_members m on m.user_id=u.id
      where u.id=person and u.email_confirmed_at is not null and (u.banned_until is null or u.banned_until<=stamp)
        and m.active;
    if person_data is null then raise exception using errcode='PT404',message='Действующий сотрудник не найден. Обновите сводку.'; end if;
    return person_data;
  elsif op<>'summary' then
    raise exception using errcode='PT400',message='Неизвестное действие.';
  end if;
  if payload ? 'days' then
    if jsonb_typeof(payload->'days')<>'number' or payload->>'days' not in ('7','30','90') then
      raise exception using errcode='PT400',message='Выберите период: 7, 30 или 90 дней.';
    end if;
    days:=(payload->>'days')::integer;
  end if;
  day_to:=(stamp at time zone 'Europe/Moscow')::date;
  day_from:=day_to-(days-1);
  period_start:=day_from::timestamp at time zone 'Europe/Moscow';
  if level>=9 then
    with active as materialized (
      select a.* from knowledge_private.assignments a where a.completed_at is null
        and a.cancelled_at is null and a.reset_to_id is null
    ), exams as materialized (
      select a.* from knowledge_private.attempts a where a.mode='exam' and a.finished_at>=period_start
        and a.finished_at<=stamp and not exists(select 1 from knowledge_private.tests t where t.id=a.test_id and t.demo)
    )
    select jsonb_build_object(
      'activeAssignments',(select count(*) from active),
      'overdueAssignments',(select count(*) from active where due_at<=stamp),
      'dueSoonAssignments',(select count(*) from active where due_at>stamp and due_at<=stamp+interval '24 hours'),
      'finishedExams',(select count(*) from exams),
      'passedExams',(select count(*) from exams where score*100>=pass_mark*total),
      'failedExams',(select count(*) from exams where score*100<pass_mark*total),
      'averageScore',(select round(avg(score::numeric*100/total),1) from exams),
      'passRate',(select round(100.0*count(*) filter(where score*100>=pass_mark*total)/nullif(count(*),0),1) from exams),
      'overdue',coalesce((select jsonb_agg(knowledge_private.assignment_json(a) order by a.due_at,a.id)
        from (select * from active where due_at<=stamp order by due_at,id limit 8) a),'[]'::jsonb),
      'recentResults',coalesce((select jsonb_agg(knowledge_private.attempt_json(a,false) order by a.finished_at desc,a.id desc)
        from (select * from exams order by finished_at desc,id desc limit 8) a),'[]'::jsonb)
    ) into tests;
  end if;
  if training_manager then
    with pending as materialized (
      select c.user_id,l.login_key,c.requested_at from knowledge_private.service_clearances c
      join auth.users u on u.id=c.user_id join knowledge_private.logins l on l.user_id=c.user_id
      left join knowledge_private.department_members m on m.user_id=c.user_id
      where c.status='pending' and u.email_confirmed_at is not null and (u.banned_until is null or u.banned_until<=stamp)
        and m.active and knowledge_private.clearance_state(c.user_id)->>'status'='pending'
    )
    select jsonb_build_object('pendingCount',(select count(*) from pending),
      'pending',coalesce((select jsonb_agg(jsonb_build_object('userId',user_id,'login',login_key,'requestedAt',requested_at)
        order by requested_at,user_id) from (select * from pending order by requested_at,user_id limit 8) p),'[]'::jsonb)) into clearances;
  end if;
  return jsonb_build_object('serverNow',stamp,'period',jsonb_build_object('days',days,'from',day_from,'to',day_to),
    'permissions',jsonb_build_object('canViewTests',level>=9,'canManageClearances',training_manager),
    'tests',tests,'clearances',clearances);
end; $$;
revoke all on function public.knowledge_dashboard(jsonb) from public,anon,authenticated;
grant execute on function public.knowledge_dashboard(jsonb) to authenticated;
comment on function public.knowledge_dashboard(jsonb) is 'Leader dashboard 20261002010000';
