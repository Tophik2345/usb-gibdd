-- Live ranks authorize test operations. Site ownership still controls accounts and grants.
alter table knowledge_private.assignments
  add column version integer not null default 1,
  add column reset_from_id text references knowledge_private.assignments(id),
  add column reset_to_id text references knowledge_private.assignments(id);

create function knowledge_private.test_rank_level()
returns integer language plpgsql security definer set search_path='' as $$
declare result integer;
begin
  perform knowledge_private.require_active_account();
  perform knowledge_private.ensure_staff_member(auth.uid());
  -- A demotion or archive must wait for an already authorized request to finish.
  select case when m.active then r.level else 0 end into result
    from knowledge_private.department_members m join knowledge_private.staff_ranks r on r.name=m.rank
    where m.user_id=auth.uid() for share of m;
  return coalesce(result,0);
end; $$;
revoke all on function knowledge_private.test_rank_level() from public,anon,authenticated;

create function knowledge_private.assignment_revision()
returns trigger language plpgsql set search_path='' as $$
begin new.version:=old.version+1; return new; end; $$;
revoke all on function knowledge_private.assignment_revision() from public,anon,authenticated;
create trigger assignment_revision before update on knowledge_private.assignments
  for each row execute function knowledge_private.assignment_revision();

create or replace function knowledge_private.test_revision()
returns trigger language plpgsql set search_path='' as $$
begin
  if (new.title,new.description,new.category,new.published,new.questions,new.pass_mark,new.shuffle_questions,new.shuffle_answers,new.time_limit_minutes)
     is distinct from (old.title,old.description,old.category,old.published,old.questions,old.pass_mark,old.shuffle_questions,old.shuffle_answers,old.time_limit_minutes)
  then new.version:=old.version+1; end if;
  return new;
end; $$;

alter function knowledge_private.assignment_json(knowledge_private.assignments) rename to assignment_json_before_rank_tests;
create function knowledge_private.assignment_json(s knowledge_private.assignments)
returns jsonb language sql stable set search_path='' as $$
  select knowledge_private.assignment_json_before_rank_tests(s)||jsonb_build_object('version',s.version,
    'resetFromId',s.reset_from_id,'resetToId',s.reset_to_id)
    ||case when s.reset_to_id is not null then jsonb_build_object('status','reset') else '{}'::jsonb end;
$$;
alter function knowledge_private.attempt_json(knowledge_private.attempts,boolean) rename to attempt_json_before_rank_tests;
create function knowledge_private.attempt_json(a knowledge_private.attempts,details boolean default false)
returns jsonb language sql stable set search_path='' as $$
  select knowledge_private.attempt_json_before_rank_tests(a,details)||jsonb_build_object(
    'assignmentReset',coalesce(s.reset_to_id is not null,false),
    'readOnly',a.user_id is distinct from auth.uid() or coalesce(s.reset_to_id is not null,false))
    from (select 1) dummy left join knowledge_private.assignments s on s.id=a.assignment_id;
$$;
revoke all on function knowledge_private.assignment_json(knowledge_private.assignments),
  knowledge_private.assignment_json_before_rank_tests(knowledge_private.assignments),
  knowledge_private.attempt_json(knowledge_private.attempts,boolean),
  knowledge_private.attempt_json_before_rank_tests(knowledge_private.attempts,boolean) from public,anon,authenticated;

create function knowledge_private.rank_save_test(payload jsonb)
returns jsonb language plpgsql set search_path='' as $$
<<saved_test>>
declare t knowledge_private.tests; key text:=nullif(payload->>'id',''); title text; description text; category text;
  mark integer; questions jsonb; published boolean; sq boolean; sa boolean; minutes integer;
begin
  if key is not null then
    select * into t from knowledge_private.tests where id=key and not demo for update;
    if not found then raise exception using errcode='PT404',message='Тест не найден.'; end if;
    if jsonb_typeof(payload->'version') is distinct from 'number' or coalesce(payload->>'version','') !~ '^[0-9]{1,9}$' then
      raise exception using errcode='PT400',message='Обновите тест перед сохранением.';
    end if;
    if (payload->>'version')::integer<>t.version then raise exception using errcode='PT409',message='Тест уже изменён. Загрузите текущую версию.'; end if;
  end if;
  title:=knowledge_private.text_field(payload->'title','Название',3,120);
  description:=knowledge_private.text_field(coalesce(payload->'description','""'::jsonb),'Описание',0,600);
  category:=knowledge_private.text_field(coalesce(payload->'category','"Общие знания"'::jsonb),'Тема',1,60);
  if jsonb_typeof(payload->'passMark') is distinct from 'number' or coalesce(payload->>'passMark','') !~ '^[0-9]{1,3}$'
    or (payload->>'passMark')::integer not between 1 and 100 or jsonb_typeof(payload->'published') is distinct from 'boolean'
  then raise exception using errcode='PT400',message='Проверьте проходной балл и статус публикации.'; end if;
  mark:=(payload->>'passMark')::integer; published:=(payload->>'published')::boolean;
  questions:=knowledge_private.questions_checked(payload->'questions');
  sq:=coalesce(t.shuffle_questions,false); sa:=coalesce(t.shuffle_answers,false); minutes:=t.time_limit_minutes;
  if payload?'shuffleQuestions' then
    if jsonb_typeof(payload->'shuffleQuestions') is distinct from 'boolean' then raise exception using errcode='PT400',message='Проверьте перемешивание вопросов.'; end if;
    sq:=(payload->>'shuffleQuestions')::boolean;
  end if;
  if payload?'shuffleAnswers' then
    if jsonb_typeof(payload->'shuffleAnswers') is distinct from 'boolean' then raise exception using errcode='PT400',message='Проверьте перемешивание ответов.'; end if;
    sa:=(payload->>'shuffleAnswers')::boolean;
  end if;
  if payload?'timeLimitMinutes' then
    if payload->'timeLimitMinutes'='null'::jsonb then minutes:=null;
    else
      if jsonb_typeof(payload->'timeLimitMinutes') is distinct from 'number' or coalesce(payload->>'timeLimitMinutes','') !~ '^[0-9]{1,3}$' then raise exception using errcode='PT400',message='Таймер: от 1 до 180 минут или без ограничения.'; end if;
      minutes:=nullif((payload->>'timeLimitMinutes')::integer,0);
      if minutes not between 1 and 180 then raise exception using errcode='PT400',message='Таймер: от 1 до 180 минут.'; end if;
    end if;
  end if;
  if key is null then
    key:=gen_random_uuid()::text;
    insert into knowledge_private.tests(id,owner_id,title,description,category,pass_mark,questions,published,shuffle_questions,shuffle_answers,time_limit_minutes)
      values(key,auth.uid(),title,description,category,mark,questions,published,sq,sa,minutes) returning * into t;
  else
    update knowledge_private.tests x set title=saved_test.title,description=saved_test.description,category=saved_test.category,
      pass_mark=mark,questions=saved_test.questions,published=saved_test.published,shuffle_questions=sq,shuffle_answers=sa,
      time_limit_minutes=minutes,updated_at=now() where x.id=key returning * into t;
  end if;
  return knowledge_private.test_json(t,auth.uid(),true);
end; $$;
revoke all on function knowledge_private.rank_save_test(jsonb) from public,anon,authenticated;

alter function knowledge_private.workspace(jsonb) rename to workspace_before_rank_tests;
revoke all on function knowledge_private.workspace_before_rank_tests(jsonb) from public,anon,authenticated;
create function knowledge_private.workspace(payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); level integer; op text; result jsonb; t knowledge_private.tests; a knowledge_private.attempts;
  s knowledge_private.assignments; replacement knowledge_private.assignments; deadline timestamptz; recipient uuid; login text;
  new_id text; preserved integer;
begin
  level:=knowledge_private.test_rank_level();
  if jsonb_typeof(payload) is distinct from 'object' or octet_length(payload::text)>200000 then raise exception using errcode='PT400',message='Некорректные данные.'; end if;
  op:=coalesce(payload->>'action',payload->>'op','workspace');
  if op in ('saveTest','test') then
    if level<12 then raise exception using errcode='PT403',message='Создание и редактирование тестов доступны от звания «Полковник».'; end if;
    if op='saveTest' then return knowledge_private.rank_save_test(payload); end if;
    select * into t from knowledge_private.tests where id=payload->>'id' and not demo;
    if not found then raise exception using errcode='PT404',message='Тест не найден.'; end if;
    return knowledge_private.test_json(t,uid,true);
  end if;
  if op in ('assignTest','rescheduleAssignment','cancelAssignment','resetAssignment') then
    if level<9 then raise exception using errcode='PT403',message='Управление назначениями доступно от звания «Капитан».'; end if;
    if op in ('assignTest','rescheduleAssignment','resetAssignment') then
      if jsonb_typeof(payload->'dueAt') is distinct from 'string' or
        coalesce(payload->>'dueAt','') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$' then
        raise exception using errcode='PT400',message='Укажите дату и время сдачи.';
      end if;
      deadline:=(payload->>'dueAt')::timestamptz;
      if not isfinite(deadline) or deadline<=now() then raise exception using errcode='PT400',message='Срок сдачи должен быть в будущем.'; end if;
    end if;
    if op='assignTest' then
      select * into t from knowledge_private.tests where id=payload->>'testId' and published and not demo for share;
      if not found then raise exception using errcode='PT404',message='Выберите опубликованный тест.'; end if;
      login:=knowledge_private.login_key(knowledge_private.text_field(payload->'login','Логин',2,100));
      select u.id into recipient from auth.users u join knowledge_private.logins l on l.user_id=u.id
        where l.login_key=login and u.email_confirmed_at is not null and (u.banned_until is null or u.banned_until<=now()) for share of u;
      if not found then raise exception using errcode='PT404',message='Сотрудник не найден, заблокирован или не подтвердил почту.'; end if;
      perform knowledge_private.ensure_staff_member(recipient);
      if not exists(select 1 from knowledge_private.department_members where user_id=recipient and active) then
        raise exception using errcode='PT403',message='Сотрудник вне действующего состава.';
      end if;
      insert into knowledge_private.assignments(test_id,author_id,user_id,employee_login,test_title,pass_mark,questions,due_at)
        values(t.id,uid,recipient,login,t.title,t.pass_mark,t.questions,deadline) returning * into s;
    else
      select * into s from knowledge_private.assignments where id=payload->>'id' for update;
      if not found then raise exception using errcode='PT404',message='Назначение не найдено.'; end if;
      if jsonb_typeof(payload->'version') is distinct from 'number' or coalesce(payload->>'version','') !~ '^[0-9]{1,9}$' then raise exception using errcode='PT400',message='Обновите список назначений.'; end if;
      if s.version<>(payload->>'version')::integer or s.reset_to_id is not null then raise exception using errcode='PT409',message='Назначение уже изменено. Обновите задания.'; end if;
      if op='resetAssignment' then
        perform 1 from auth.users where id=s.user_id and email_confirmed_at is not null and (banned_until is null or banned_until<=now()) for share;
        if not found or not exists(select 1 from knowledge_private.department_members where user_id=s.user_id and active) then
          raise exception using errcode='PT404',message='Аккаунт сотрудника недоступен для повторного назначения.';
        end if;
        select * into t from knowledge_private.tests where id=s.test_id and published and not demo for share;
        if not found then raise exception using errcode='PT409',message='Тест снят с публикации. Сначала опубликуйте его.'; end if;
        -- Replace the assignment, never update or delete its attempts or results.
        if s.completed_at is null and s.cancelled_at is null then
          update knowledge_private.assignments set cancelled_at=now() where id=s.id;
        end if;
        new_id:=gen_random_uuid()::text;
        insert into knowledge_private.assignments(id,test_id,author_id,user_id,employee_login,test_title,pass_mark,questions,due_at,reset_from_id)
          values(new_id,t.id,uid,s.user_id,s.employee_login,t.title,t.pass_mark,t.questions,deadline,s.id) returning * into replacement;
        update knowledge_private.assignments set reset_to_id=new_id where id=s.id;
        select count(*) into preserved from knowledge_private.attempts where assignment_id=s.id;
        insert into knowledge_private.management_events(actor_id,actor_login,area,operation,target_id,title,details)
          values(uid,(select login_key from knowledge_private.logins where user_id=uid),'assignments','reset',s.id,s.test_title,
            jsonb_build_object('employee',s.employee_login,'previousAssignment',s.id,'newAssignment',new_id,'preservedAttempts',preserved,'dueAt',deadline));
        return knowledge_private.assignment_json(replacement);
      end if;
      if s.completed_at is not null then raise exception using errcode='PT409',message='Задание уже пройдено.'; end if;
      if op='cancelAssignment' then
        update knowledge_private.assignments set cancelled_at=coalesce(cancelled_at,now()) where id=s.id returning * into s;
      else
        if s.cancelled_at is not null then raise exception using errcode='PT409',message='Назначение отменено. Создайте новое.'; end if;
        update knowledge_private.assignments set due_at=deadline where id=s.id returning * into s;
      end if;
    end if;
    return knowledge_private.assignment_json(s);
  end if;
  if op='attempt' then
    select * into a from knowledge_private.attempts where id=payload->>'id';
    if found and a.user_id<>uid then
      if level<9 then raise exception using errcode='PT404',message='Попытка не найдена.'; end if;
      return knowledge_private.attempt_json(a,true);
    end if;
  end if;
  if op in ('answer','submit') then
    -- Finish expired own attempts before locking a specific assignment, retaining
    -- the common lock order when several tabs have different timed assignments.
    perform knowledge_private.finish_expired(uid);
    perform 1 from knowledge_private.assignments checked_assignment join knowledge_private.attempts checked_attempt on checked_attempt.assignment_id=checked_assignment.id
      where checked_attempt.id=payload->>'id' and checked_attempt.user_id=uid for update of checked_assignment;
    if exists(select 1 from knowledge_private.attempts checked_attempt join knowledge_private.assignments checked_assignment on checked_assignment.id=checked_attempt.assignment_id
      where checked_attempt.id=payload->>'id' and checked_attempt.user_id=uid and checked_assignment.reset_to_id is not null) then
      raise exception using errcode='PT409',message='Назначение обнулено. Начните новое задание; предыдущая попытка сохранена в истории.';
    end if;
  end if;
  if op='startAssignment' then
    perform 1 from knowledge_private.assignments where id=payload->>'assignmentId' and user_id=uid for update;
    if exists(select 1 from knowledge_private.assignments where id=payload->>'assignmentId' and user_id=uid and reset_to_id is not null) then
      raise exception using errcode='PT409',message='Назначение обнулено. Начните новое задание.';
    end if;
  end if;
  result:=knowledge_private.workspace_before_rank_tests(payload);
  if op='workspace' then
    result:=result||jsonb_build_object('permissions',(result->'permissions')||jsonb_build_object(
      'canCreateTests',level>=12,'canEditAllTests',level>=12,'canAssignTests',level>=9,'canViewAllResults',level>=9),
      'managed',case when level>=12 then coalesce((select jsonb_agg(knowledge_private.test_json(listed_test,uid) order by listed_test.created_at desc) from knowledge_private.tests listed_test where not listed_test.demo),'[]'::jsonb) else '[]'::jsonb end,
      'assignmentTests',case when level>=9 then coalesce((select jsonb_agg(knowledge_private.test_json(listed_test,uid) order by listed_test.created_at desc) from knowledge_private.tests listed_test where listed_test.published and not listed_test.demo),'[]'::jsonb) else '[]'::jsonb end,
      'team',case when level>=9 then coalesce((select jsonb_agg(knowledge_private.attempt_json(listed_attempt) order by listed_attempt.finished_at desc) from
        (select * from knowledge_private.attempts where finished_at is not null and mode='exam' order by finished_at desc,id desc limit 500) listed_attempt),'[]'::jsonb) else '[]'::jsonb end,
      'assignedTeam',case when level>=9 then coalesce((select jsonb_agg(knowledge_private.assignment_json(listed_assignment) order by listed_assignment.assigned_at desc,listed_assignment.id) from
        (select * from knowledge_private.assignments order by assigned_at desc,id desc limit 500) listed_assignment),'[]'::jsonb) else '[]'::jsonb end);
  end if;
  return result;
exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow or numeric_value_out_of_range then
  raise exception using errcode='PT400',message='Проверьте данные и срок сдачи.';
when unique_violation then raise exception using errcode='PT409',message='У сотрудника уже есть действующее назначение этого теста. Обновите задания.';
end; $$;
revoke all on function knowledge_private.workspace(jsonb) from public,anon,authenticated;
grant execute on function knowledge_private.workspace(jsonb) to authenticated;
create or replace function public.knowledge_workspace(payload jsonb default '{}'::jsonb)
returns jsonb language sql security invoker set search_path='' as $$ select knowledge_private.workspace(payload); $$;
comment on function public.knowledge_workspace(jsonb) is 'Rank-based test permissions 20261001150000';

create or replace function knowledge_private.editor(payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); op text; draft_key text; test_key text; expected integer; base integer; level integer;
  t knowledge_private.tests; d knowledge_private.test_drafts; content jsonb; result jsonb; new_key text;
begin
  perform knowledge_private.require_active_account();
  if not exists(select 1 from auth.users where id=uid and email_confirmed_at is not null) then raise exception using errcode='PT401',message='Подтвердите почту и войдите в аккаунт.'; end if;
  level:=knowledge_private.test_rank_level();
  if level<12 then raise exception using errcode='PT403',message='Редактор тестов доступен от звания «Полковник».'; end if;
  if jsonb_typeof(payload) is distinct from 'object' or octet_length(payload::text)>200000 then raise exception using errcode='PT400',message='Черновик слишком большой или содержит некорректные данные.'; end if;
  op:=payload->>'action';
  if op='list' then
    return jsonb_build_object('drafts',coalesce((select jsonb_agg(jsonb_build_object('id',id,'testId',test_id,'title',form->>'title','version',version,'baseVersion',base_version,'updatedAt',updated_at) order by updated_at desc)
      from knowledge_private.test_drafts where owner_id=uid),'[]'::jsonb));
  end if;
  if op='copy' then
    select * into t from knowledge_private.tests where id=payload->>'testId' and not demo for share;
    if not found then raise exception using errcode='PT403',message='Тест недоступен для копирования.'; end if;
    new_key:=gen_random_uuid()::text;
    insert into knowledge_private.tests(id,owner_id,title,description,category,pass_mark,questions,published,shuffle_questions,shuffle_answers,time_limit_minutes)
      values(new_key,uid,left(t.title,112)||' — копия',t.description,t.category,t.pass_mark,knowledge_private.questions_checked(t.questions),false,t.shuffle_questions,t.shuffle_answers,t.time_limit_minutes)
      returning * into t;
    return knowledge_private.test_json(t,uid,true);
  end if;
  if op not in ('load','save','discard','publish') or op is null then raise exception using errcode='PT400',message='Неизвестная операция редактора.'; end if;
  draft_key:=payload->>'id';
  if draft_key like 'test:%' and char_length(draft_key) between 6 and 105 then
    test_key:=substr(draft_key,6);
    select * into t from knowledge_private.tests where id=test_key and not demo for update;
    if not found then raise exception using errcode='PT403',message='Тест недоступен для редактирования.'; end if;
  elsif draft_key ~ '^new:[0-9a-f-]{36}$' then
    perform substr(draft_key,5)::uuid;
  else raise exception using errcode='PT400',message='Некорректный ID черновика.';
  end if;
  select * into d from knowledge_private.test_drafts where owner_id=uid and id=draft_key for update;
  if op='load' then
    return jsonb_build_object('draft',case when d.id is not null then jsonb_build_object('id',d.id,'testId',d.test_id,'baseVersion',d.base_version,'version',d.version,'form',d.form,'updatedAt',d.updated_at) else null end,
      'test',case when t.id is not null then knowledge_private.test_json(t,uid,true) else null end);
  end if;
  if jsonb_typeof(payload->'version') is distinct from 'number' or coalesce(payload->>'version','') !~ '^[0-9]{1,9}$' then raise exception using errcode='PT400',message='Обновите черновик.'; end if;
  expected:=(payload->>'version')::integer;
  if expected<>coalesce(d.version,0) then raise exception using errcode='PT409',message='Черновик изменён в другой вкладке или на другом устройстве. Ваши правки остались на этом устройстве.'; end if;
  if op='discard' then
    delete from knowledge_private.test_drafts where owner_id=uid and id=draft_key and version=expected;
    return jsonb_build_object('discarded',true);
  end if;
  if op='save' then
    if d.id is null and (select count(*) from knowledge_private.test_drafts where owner_id=uid)>=100 then raise exception using errcode='PT400',message='Слишком много черновиков. Завершите или удалите ненужные.'; end if;
    base:=d.base_version;
    if d.id is null and test_key is not null then
      if jsonb_typeof(payload->'baseVersion') is distinct from 'number' or coalesce(payload->>'baseVersion','') !~ '^[0-9]{1,9}$' or (payload->>'baseVersion')::integer<>t.version then
        raise exception using errcode='PT409',message='Тест уже изменён. Сохраните свои правки как новый черновик или загрузите текущую версию.';
      end if;
      base:=t.version;
    end if;
    content:=knowledge_private.draft_form(payload->'form',test_key);
    insert into knowledge_private.test_drafts(owner_id,id,test_id,base_version,form) values(uid,draft_key,test_key,base,content)
      on conflict(owner_id,id) do update set form=excluded.form,version=test_drafts.version+1,updated_at=now() where test_drafts.version=expected returning * into d;
    if not found then raise exception using errcode='PT409',message='Черновик изменён в другой вкладке. Загрузите сохранённую версию.'; end if;
    return jsonb_build_object('id',d.id,'testId',d.test_id,'baseVersion',d.base_version,'version',d.version,'form',d.form,'updatedAt',d.updated_at);
  end if;
  if d.id is null then raise exception using errcode='PT409',message='Сначала сохраните черновик.'; end if;
  if test_key is not null and t.version is distinct from d.base_version then raise exception using errcode='PT409',message='Тест уже изменён. Сохраните свои правки как новый черновик или загрузите текущую версию.'; end if;
  result:=knowledge_private.workspace(d.form||jsonb_build_object('action','saveTest','id',coalesce(test_key,''),'version',t.version));
  delete from knowledge_private.test_drafts where owner_id=uid and id=draft_key;
  select * into t from knowledge_private.tests where id=result->>'id';
  return knowledge_private.test_json(t,uid,true);
exception when invalid_text_representation or numeric_value_out_of_range then raise exception using errcode='PT400',message='Проверьте настройки и ID черновика.';
end; $$;

create or replace function knowledge_private.results(payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); level integer; scope text; test_key text; employee text; status text;
  day_from text; day_to text; date_from timestamptz; date_to timestamptz; min_score integer; max_score integer;
  snap timestamptz; cursor_time timestamptz; cursor_id text; result jsonb;
begin
  perform knowledge_private.require_active_account();
  if not exists(select 1 from auth.users where id=uid and email_confirmed_at is not null) then raise exception using errcode='PT401',message='Подтвердите почту и войдите в аккаунт.'; end if;
  if jsonb_typeof(payload) is distinct from 'object' or octet_length(payload::text)>4096 then raise exception using errcode='PT400',message='Некорректные фильтры.'; end if;
  level:=knowledge_private.test_rank_level();
  scope:=coalesce(payload->>'scope','mine');
  if scope in ('team','all') and level<9 then raise exception using errcode='PT403',message='Результаты сотрудников доступны от звания «Капитан».'; end if;
  if scope not in ('mine','practice','team','all') then raise exception using errcode='PT400',message='Выберите раздел результатов.'; end if;
  test_key:=nullif(payload->>'testId',''); employee:=lower(btrim(regexp_replace(coalesce(payload->>'employee',''),'\s+',' ','g')));
  if char_length(employee)>100 then raise exception using errcode='PT400',message='Поиск сотрудника: не более 100 символов.'; end if;
  status:=coalesce(nullif(payload->>'status',''),'all');
  if status not in ('all','passed','failed') then raise exception using errcode='PT400',message='Выберите статус результата.'; end if;
  day_from:=nullif(payload->>'from',''); day_to:=nullif(payload->>'to','');
  if day_from is not null then
    if day_from !~ '^\d{4}-\d{2}-\d{2}$' or to_char(day_from::date,'YYYY-MM-DD')<>day_from then raise exception using errcode='PT400',message='Проверьте начальную дату.'; end if;
    date_from:=day_from::timestamp at time zone 'Europe/Moscow';
  end if;
  if day_to is not null then
    if day_to !~ '^\d{4}-\d{2}-\d{2}$' or to_char(day_to::date,'YYYY-MM-DD')<>day_to then raise exception using errcode='PT400',message='Проверьте конечную дату.'; end if;
    date_to:=(day_to::date+1)::timestamp at time zone 'Europe/Moscow';
  end if;
  if date_from>=date_to then raise exception using errcode='PT400',message='Начальная дата должна быть не позже конечной.'; end if;
  if payload->>'minScore' is not null then
    if payload->>'minScore' !~ '^[0-9]{1,3}$' then raise exception using errcode='PT400',message='Оценка: от 0 до 100%.'; end if;
    min_score:=(payload->>'minScore')::integer;
  end if;
  if payload->>'maxScore' is not null then
    if payload->>'maxScore' !~ '^[0-9]{1,3}$' then raise exception using errcode='PT400',message='Оценка: от 0 до 100%.'; end if;
    max_score:=(payload->>'maxScore')::integer;
  end if;
  if min_score not between 0 and 100 or max_score not between 0 and 100 or min_score>max_score then raise exception using errcode='PT400',message='Проверьте диапазон оценки: от 0 до 100%.'; end if;
  snap:=coalesce((payload->>'snapshot')::timestamptz,statement_timestamp());
  if not isfinite(snap) then raise exception using errcode='PT400',message='Обновите результаты.'; end if;
  if payload->'cursor' is not null and payload->'cursor'<>'null'::jsonb then
    cursor_time:=(payload->'cursor'->>'finishedAt')::timestamptz; cursor_id:=payload->'cursor'->>'id';
    if cursor_time is null or not isfinite(cursor_time) or cursor_id is null or char_length(cursor_id)>100 then raise exception using errcode='PT400',message='Обновите страницу результатов.'; end if;
  end if;
  with visible as materialized (
    select a.* from knowledge_private.attempts a where a.finished_at is not null and a.finished_at<=snap
      and case when scope='all' then true when scope='team' then a.author_id=uid else a.user_id=uid and (a.mode='practice')=(scope='practice') end
  ), filtered as materialized (
    select a.* from visible a where (test_key is null or a.test_id=test_key)
      and (employee='' or strpos(lower(regexp_replace(a.employee_name,'\s+',' ','g')),employee)>0)
      and (date_from is null or a.finished_at>=date_from) and (date_to is null or a.finished_at<date_to)
      and (min_score is null or a.score*100>=min_score*a.total) and (max_score is null or a.score*100<=max_score*a.total)
      and (status='all' or (a.score*100>=a.pass_mark*a.total)=(status='passed'))
  ), page as materialized (
    select a.* from filtered a where cursor_time is null or (a.finished_at,a.id)<(cursor_time,cursor_id)
    order by a.finished_at desc,a.id desc limit 101
  ), shown as materialized (select * from page order by finished_at desc,id desc limit 100)
  select jsonb_build_object('rows',coalesce((select jsonb_agg(knowledge_private.attempt_json(a,false) order by a.finished_at desc,a.id desc) from shown a),'[]'::jsonb),
    'total',(select count(*) from filtered),'snapshot',snap,
    'nextCursor',case when (select count(*) from page)>100 then (select jsonb_build_object('finishedAt',finished_at,'id',id) from shown order by finished_at,id limit 1) else null end,
    'tests',coalesce((select jsonb_agg(jsonb_build_object('id',test_id,'title',test_title) order by test_title,test_id)
      from (select distinct on(test_id) test_id,test_title from visible order by test_id,finished_at desc,id desc) t),'[]'::jsonb)) into result;
  return result;
exception when invalid_text_representation or datetime_field_overflow or numeric_value_out_of_range then raise exception using errcode='PT400',message='Проверьте даты и диапазон оценки.';
end; $$;

create or replace function knowledge_private.finish_expired(uid uuid) returns void language plpgsql set search_path='' as $$
declare candidate record; a knowledge_private.attempts; grade integer;
begin
  for candidate in select id,assignment_id from knowledge_private.attempts
    where user_id=uid and finished_at is null and deadline_at<=clock_timestamp() order by id loop
    if candidate.assignment_id is not null then perform 1 from knowledge_private.assignments where id=candidate.assignment_id for update; end if;
    select * into a from knowledge_private.attempts where id=candidate.id and finished_at is null for update;
    if not found or a.deadline_at>clock_timestamp() or exists(select 1 from knowledge_private.assignments where id=a.assignment_id and reset_to_id is not null) then continue; end if;
    select count(*)::integer into grade from jsonb_array_elements(a.questions) q where a.answers->(q->>'id')=q->'correct';
    update knowledge_private.attempts set score=grade,finished_at=deadline_at where id=a.id;
    if a.assignment_id is not null and grade*100>=a.total*a.pass_mark then
      update knowledge_private.assignments set completed_at=a.deadline_at,completed_attempt_id=a.id
        where id=a.assignment_id and completed_at is null and cancelled_at is null;
    end if;
  end loop;
end; $$;


comment on function public.knowledge_editor(jsonb) is 'Rank-based editor 20261001150000';
comment on function public.knowledge_results(jsonb) is 'Rank-based results 20261001150000';
notify pgrst,'reload schema';
