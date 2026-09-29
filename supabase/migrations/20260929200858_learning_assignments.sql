-- Learning stays behind the existing authenticated RPC. No direct client grants.
create table knowledge_private.assignments (
  id text primary key default gen_random_uuid()::text,
  test_id text not null references knowledge_private.tests(id) on delete restrict,
  author_id uuid not null references auth.users(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  employee_login text not null,
  test_title text not null,
  pass_mark integer not null check (pass_mark between 1 and 100),
  questions jsonb not null check (jsonb_typeof(questions)='array' and jsonb_array_length(questions) between 1 and 60),
  assigned_at timestamptz not null default now(),
  due_at timestamptz not null check (isfinite(due_at)),
  completed_at timestamptz,
  completed_attempt_id text references knowledge_private.attempts(id) on delete set null,
  cancelled_at timestamptz,
  check (completed_at is null or cancelled_at is null)
);
alter table knowledge_private.assignments enable row level security;
revoke all on knowledge_private.assignments from public, anon, authenticated;
create unique index assignments_one_pending on knowledge_private.assignments(test_id,user_id)
  where completed_at is null and cancelled_at is null;
create index assignments_user on knowledge_private.assignments(user_id,assigned_at desc);
create index assignments_author on knowledge_private.assignments(author_id,assigned_at desc);

alter table knowledge_private.attempts
  add column mode text not null default 'exam' check (mode in ('exam','practice')),
  add column source_attempt_id text references knowledge_private.attempts(id) on delete set null,
  add column assignment_id text references knowledge_private.assignments(id) on delete set null,
  add constraint practice_not_assignment check (mode='exam' or assignment_id is null);
drop index knowledge_private.one_active_attempt;
create unique index one_active_attempt on knowledge_private.attempts(user_id,test_id)
  where finished_at is null and mode='exam' and assignment_id is null;
create unique index one_active_practice on knowledge_private.attempts(user_id,source_attempt_id)
  where finished_at is null and mode='practice';
create unique index one_active_assigned_attempt on knowledge_private.attempts(assignment_id)
  where finished_at is null and assignment_id is not null;
create index attempts_assignment on knowledge_private.attempts(assignment_id,started_at desc) where assignment_id is not null;

create or replace function knowledge_private.attempt_json(a knowledge_private.attempts, details boolean default false)
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object('id',a.id,'testId',a.test_id,'testTitle',a.test_title,
    'employeeName',a.employee_name,'passMark',a.pass_mark,'startedAt',a.started_at,
    'finishedAt',a.finished_at,'score',a.score,'total',a.total,'demo',a.test_id='demo-information',
    'mode',a.mode,'sourceAttemptId',a.source_attempt_id,'assignmentId',a.assignment_id,
    'assignmentCancelled',coalesce((select s.cancelled_at is not null from knowledge_private.assignments s where s.id=a.assignment_id),false))
    || case when details then jsonb_build_object('answers',a.answers,'questions',
      case when a.finished_at is not null then a.questions else (
        select jsonb_agg(jsonb_build_object('id',q.value->'id','text',q.value->'text','options',q.value->'options') order by q.ordinality)
        from jsonb_array_elements(a.questions) with ordinality q
      ) end
    ) else '{}'::jsonb end;
$$;

create function knowledge_private.assignment_json(s knowledge_private.assignments)
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object('id',s.id,'testId',s.test_id,'testTitle',s.test_title,
    'employeeLogin',s.employee_login,'authorLogin',(select l.login_key from knowledge_private.logins l where l.user_id=s.author_id),
    'passMark',s.pass_mark,'count',jsonb_array_length(s.questions),'assignedAt',s.assigned_at,'dueAt',s.due_at,
    'completedAt',s.completed_at,'completedAttemptId',s.completed_attempt_id,
    'status',case when s.cancelled_at is not null then 'cancelled' when s.completed_at is not null then 'passed'
      when s.due_at<now() then 'overdue' else 'assigned' end,
    'lastScore',last_result.score,'lastTotal',last_result.total,'lastFinishedAt',last_result.finished_at,
    'inProgressAttemptId',(select a.id from knowledge_private.attempts a where a.assignment_id=s.id and a.finished_at is null))
  from (select 1) dummy left join lateral (
    select a.score,a.total,a.finished_at from knowledge_private.attempts a
    where a.assignment_id=s.id and a.finished_at is not null order by a.finished_at desc,a.id limit 1
  ) last_result on true;
$$;
revoke all on function knowledge_private.assignment_json(knowledge_private.assignments) from public, anon, authenticated;

-- Preserve the existing role/delegation checks as a private implementation.
alter function knowledge_private.workspace(jsonb) rename to workspace_roles;
revoke all on function knowledge_private.workspace_roles(jsonb) from public, anon, authenticated;
create function knowledge_private.workspace(payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  operation text;
  member_role text;
  target_user uuid;
  target_login text;
  employee text;
  deadline timestamptz;
  t knowledge_private.tests;
  a knowledge_private.attempts;
  source_attempt knowledge_private.attempts;
  s knowledge_private.assignments;
  questions jsonb;
  result jsonb;
  assigned_id text;
begin
  if uid is null then raise exception using errcode='PT401',message='Войдите в аккаунт, чтобы продолжить.'; end if;
  if jsonb_typeof(payload) is distinct from 'object' or octet_length(payload::text)>200000 then
    raise exception using errcode='PT400',message='Некорректные данные.';
  end if;
  operation := coalesce(payload->>'action',payload->>'op','workspace');

  if operation in ('assignTest','rescheduleAssignment','cancelAssignment') then
    select role into member_role from knowledge_private.test_creators where user_id=uid for share;
    if member_role is null then raise exception using errcode='PT403',message='Назначать тесты могут только авторы, добавленные владельцем сайта.'; end if;
    if operation in ('assignTest','rescheduleAssignment') then
      if jsonb_typeof(payload->'dueAt') is distinct from 'string' or
         coalesce(payload->>'dueAt','') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$' then
        raise exception using errcode='PT400',message='Укажите дату и время сдачи.';
      end if;
      deadline := (payload->>'dueAt')::timestamptz;
      if not isfinite(deadline) or deadline<=now() then
        raise exception using errcode='PT400',message='Срок сдачи должен быть в будущем.';
      end if;
    end if;
    if operation='assignTest' then
      select * into t from knowledge_private.tests where id=payload->>'testId' and owner_id=uid and published and not demo for share;
      if not found then raise exception using errcode='PT404',message='Можно назначить только свой опубликованный тест.'; end if;
      target_login := knowledge_private.login_key(knowledge_private.text_field(payload->'login','Логин',2,100));
      select l.user_id into target_user from knowledge_private.logins l join auth.users u on u.id=l.user_id
        where l.login_key=target_login and u.email_confirmed_at is not null;
      if target_user is null then raise exception using errcode='PT404',message='Пользователь не найден или ещё не подтвердил почту. Проверьте логин.'; end if;
      insert into knowledge_private.assignments(test_id,author_id,user_id,employee_login,test_title,pass_mark,questions,due_at)
        values(t.id,uid,target_user,target_login,t.title,t.pass_mark,t.questions,deadline) returning * into s;
    else
      select * into s from knowledge_private.assignments where id=payload->>'id' and author_id=uid for update;
      if not found then raise exception using errcode='PT404',message='Назначение не найдено.'; end if;
      if s.completed_at is not null then raise exception using errcode='PT409',message='Задание уже пройдено.'; end if;
      if operation='cancelAssignment' then
        update knowledge_private.assignments set cancelled_at=coalesce(cancelled_at,now()) where id=s.id returning * into s;
      else
        if s.cancelled_at is not null then raise exception using errcode='PT409',message='Назначение отменено. Создайте новое.'; end if;
        update knowledge_private.assignments set due_at=deadline where id=s.id returning * into s;
      end if;
    end if;
    return knowledge_private.assignment_json(s);

  elsif operation='startAssignment' then
    select * into s from knowledge_private.assignments where id=payload->>'assignmentId' and user_id=uid for update;
    if not found then raise exception using errcode='PT404',message='Назначение не найдено.'; end if;
    if s.cancelled_at is not null then raise exception using errcode='PT409',message='Назначение отменено автором.'; end if;
    if s.completed_at is not null then raise exception using errcode='PT409',message='Задание уже пройдено.'; end if;
    select * into a from knowledge_private.attempts where assignment_id=s.id and finished_at is null;
    if found then return knowledge_private.attempt_json(a,true); end if;
    -- Assigned results use the registered recipient, never a supplied display name.
    employee := s.employee_login;
    insert into knowledge_private.attempts(test_id,author_id,user_id,employee_name,test_title,pass_mark,questions,total,assignment_id)
      values(s.test_id,s.author_id,uid,employee,s.test_title,s.pass_mark,s.questions,jsonb_array_length(s.questions),s.id) returning * into a;
    return knowledge_private.attempt_json(a,true);

  elsif operation='practice' then
    select * into source_attempt from knowledge_private.attempts where id=payload->>'sourceAttemptId' and user_id=uid for share;
    if not found then raise exception using errcode='PT404',message='Результат не найден.'; end if;
    if source_attempt.finished_at is null then raise exception using errcode='PT409',message='Сначала завершите проверку.'; end if;
    select jsonb_agg(q.value order by q.ordinality) into questions
      from jsonb_array_elements(source_attempt.questions) with ordinality q
      where source_attempt.answers->(q.value->>'id') is distinct from q.value->'correct';
    if questions is null then raise exception using errcode='PT400',message='В этой попытке нет ошибок для тренировки.'; end if;
    perform pg_advisory_xact_lock(hashtextextended('practice:'||uid::text||':'||source_attempt.id,0));
    select * into a from knowledge_private.attempts where user_id=uid and source_attempt_id=source_attempt.id and mode='practice' and finished_at is null;
    if found then return knowledge_private.attempt_json(a,true); end if;
    insert into knowledge_private.attempts(test_id,author_id,user_id,employee_name,test_title,pass_mark,questions,total,mode,source_attempt_id)
      values(source_attempt.test_id,null,uid,source_attempt.employee_name,source_attempt.test_title,100,questions,jsonb_array_length(questions),'practice',source_attempt.id) returning * into a;
    return knowledge_private.attempt_json(a,true);

  elsif operation='start' then
    -- Ordinary exams, assigned exams and practice have independent resumable sessions.
    employee := knowledge_private.text_field(payload->'employeeName','Имя сотрудника',2,100);
    select * into t from knowledge_private.tests where id=payload->>'testId' and published for share;
    if not found then raise exception using errcode='PT404',message='Этот тест пока недоступен.'; end if;
    perform pg_advisory_xact_lock(hashtextextended(uid::text||':'||t.id,0));
    select * into a from knowledge_private.attempts where user_id=uid and test_id=t.id and mode='exam' and assignment_id is null and finished_at is null;
    if found then return knowledge_private.attempt_json(a,true); end if;
    insert into knowledge_private.attempts(test_id,author_id,user_id,employee_name,test_title,pass_mark,questions,total)
      values(t.id,t.owner_id,uid,employee,t.title,t.pass_mark,t.questions,jsonb_array_length(t.questions)) returning * into a;
    return knowledge_private.attempt_json(a,true);
  end if;

  if operation in ('answer','submit') then
    select assignment_id into assigned_id from knowledge_private.attempts where id=payload->>'id' and user_id=uid;
    -- Same lock order as start/cancel/reschedule; grade only the caller's snapshot.
    if assigned_id is not null then perform 1 from knowledge_private.assignments where id=assigned_id for update; end if;
  end if;
  result := knowledge_private.workspace_roles(payload);
  if operation='submit' and assigned_id is not null then
    update knowledge_private.assignments set completed_at=(result->>'finishedAt')::timestamptz,completed_attempt_id=result->>'id'
      where id=assigned_id and user_id=uid and cancelled_at is null and completed_at is null
      and (result->>'mode')='exam' and (result->>'score')::integer*100 >= (result->>'total')::integer*pass_mark;
  elsif operation='workspace' then
    result := result || jsonb_build_object(
      'team',coalesce((select jsonb_agg(x.value) from jsonb_array_elements(result->'team') x where x.value->>'mode'='exam'),'[]'::jsonb),
      'assignments',coalesce((select jsonb_agg(knowledge_private.assignment_json(x) order by x.assigned_at desc)
        from (select * from knowledge_private.assignments where user_id=uid order by assigned_at desc limit 500) x),'[]'::jsonb),
      'assignedTeam',coalesce((select jsonb_agg(knowledge_private.assignment_json(x) order by x.assigned_at desc)
        from (select * from knowledge_private.assignments where author_id=uid and exists(select 1 from knowledge_private.test_creators where user_id=uid)
          order by assigned_at desc limit 500) x),'[]'::jsonb));
  end if;
  return result;
exception
  when invalid_datetime_format or datetime_field_overflow or invalid_text_representation then
    raise exception using errcode='PT400',message='Некорректная дата или значение поля.';
  when unique_violation then
    raise exception using errcode='PT409',message='У сотрудника уже есть незавершённое назначение этого теста.';
end;
$$;
revoke all on function knowledge_private.workspace(jsonb) from public, anon, authenticated;
grant execute on function knowledge_private.workspace(jsonb) to authenticated;
create or replace function public.knowledge_workspace(payload jsonb default '{}'::jsonb)
returns jsonb language sql security invoker set search_path = '' as $$
  select knowledge_private.workspace(payload);
$$;
revoke all on function public.knowledge_workspace(jsonb) from public, anon, authenticated;
grant execute on function public.knowledge_workspace(jsonb) to authenticated;
