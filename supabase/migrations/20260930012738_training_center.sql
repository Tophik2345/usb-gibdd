-- Training features extend the existing private RPC architecture. No client table grants.
alter table knowledge_private.tests
  add column shuffle_questions boolean not null default false,
  add column shuffle_answers boolean not null default false,
  add column time_limit_minutes integer check(time_limit_minutes between 1 and 180),
  add column version integer not null default 1;
alter table knowledge_private.assignments
  add column shuffle_questions boolean not null default false,
  add column shuffle_answers boolean not null default false,
  add column time_limit_minutes integer check(time_limit_minutes between 1 and 180),
  add column test_version integer;
alter table knowledge_private.attempts
  add column deadline_at timestamptz,
  add column time_limit_minutes integer,
  add column test_version integer,
  add column shuffled boolean not null default false;
create index attempts_deadlines on knowledge_private.attempts(user_id,deadline_at) where finished_at is null and deadline_at is not null;

create function knowledge_private.random_questions(items jsonb, mix_questions boolean, mix_answers boolean)
returns jsonb language plpgsql volatile set search_path='' as $$
declare q jsonb; result jsonb:='[]'; options jsonb; correct integer;
begin
  for q in select value from jsonb_array_elements(items) with ordinality x
    order by case when mix_questions then random() else ordinality::double precision end loop
    if mix_answers then
      select jsonb_agg(value order by n),max(n-1) filter(where old_index=(q->>'correct')::integer)
        into options,correct from (
          select value,ordinality-1 old_index,row_number() over(order by random())::integer n
          from jsonb_array_elements(q->'options') with ordinality x
        ) randomized;
      q:=q||jsonb_build_object('options',options,'correct',correct);
    end if;
    result:=result||jsonb_build_array(q);
  end loop;
  return result;
end; $$;

create function knowledge_private.test_revision() returns trigger language plpgsql set search_path='' as $$
begin
  if (new.questions,new.pass_mark,new.shuffle_questions,new.shuffle_answers,new.time_limit_minutes)
     is distinct from (old.questions,old.pass_mark,old.shuffle_questions,old.shuffle_answers,old.time_limit_minutes)
  then new.version:=old.version+1; end if;
  return new;
end; $$;
create trigger test_revision before update on knowledge_private.tests for each row execute function knowledge_private.test_revision();

create function knowledge_private.assignment_settings() returns trigger language plpgsql set search_path='' as $$
declare t knowledge_private.tests;
begin
  select * into t from knowledge_private.tests where id=new.test_id;
  new.shuffle_questions:=t.shuffle_questions; new.shuffle_answers:=t.shuffle_answers;
  new.time_limit_minutes:=t.time_limit_minutes; new.test_version:=t.version;
  return new;
end; $$;
create trigger assignment_settings before insert on knowledge_private.assignments for each row execute function knowledge_private.assignment_settings();

create function knowledge_private.attempt_settings() returns trigger language plpgsql set search_path='' as $$
declare sq boolean; sa boolean; minutes integer; revision integer;
begin
  if new.mode='practice' then return new; end if;
  if new.assignment_id is not null then
    select shuffle_questions,shuffle_answers,time_limit_minutes,test_version into sq,sa,minutes,revision
      from knowledge_private.assignments where id=new.assignment_id;
  else
    select shuffle_questions,shuffle_answers,time_limit_minutes,version into sq,sa,minutes,revision
      from knowledge_private.tests where id=new.test_id;
  end if;
  new.questions:=knowledge_private.random_questions(new.questions,sq,sa);
  new.shuffled:=sq or sa; new.time_limit_minutes:=minutes; new.test_version:=revision;
  if minutes is not null then new.deadline_at:=new.started_at+make_interval(mins=>minutes); end if;
  return new;
end; $$;
create trigger attempt_settings before insert on knowledge_private.attempts for each row execute function knowledge_private.attempt_settings();

create function knowledge_private.reject_late_answers() returns trigger language plpgsql set search_path='' as $$
begin
  if new.answers is distinct from old.answers and old.deadline_at<=clock_timestamp() then
    raise exception using errcode='PT409',message='Время истекло. Получите результат проверки.';
  end if;
  return new;
end; $$;
create trigger reject_late_answers before update on knowledge_private.attempts for each row execute function knowledge_private.reject_late_answers();
revoke all on function knowledge_private.reject_late_answers() from public,anon,authenticated;

alter function knowledge_private.assignment_json(knowledge_private.assignments) rename to assignment_json_before_training;
create function knowledge_private.assignment_json(s knowledge_private.assignments)
returns jsonb language sql stable set search_path='' as $$
  select knowledge_private.assignment_json_before_training(s)||jsonb_build_object('timeLimitMinutes',s.time_limit_minutes,'shuffleQuestions',s.shuffle_questions,'shuffleAnswers',s.shuffle_answers);
$$;
revoke all on function knowledge_private.assignment_json(knowledge_private.assignments),knowledge_private.assignment_json_before_training(knowledge_private.assignments) from public,anon,authenticated;

alter function knowledge_private.test_json(knowledge_private.tests,uuid,boolean) rename to test_json_before_training;
create function knowledge_private.test_json(t knowledge_private.tests, uid uuid, details boolean default false)
returns jsonb language sql stable set search_path='' as $$
  select knowledge_private.test_json_before_training(t,uid,details)||jsonb_build_object(
    'shuffleQuestions',t.shuffle_questions,'shuffleAnswers',t.shuffle_answers,'timeLimitMinutes',t.time_limit_minutes,'version',t.version);
$$;
alter function knowledge_private.attempt_json(knowledge_private.attempts,boolean) rename to attempt_json_before_training;
create function knowledge_private.attempt_json(a knowledge_private.attempts, details boolean default false)
returns jsonb language sql volatile set search_path='' as $$
  select knowledge_private.attempt_json_before_training(a,details)||jsonb_build_object('deadlineAt',a.deadline_at,
    'timeLimitMinutes',a.time_limit_minutes,'shuffled',a.shuffled,'testVersion',a.test_version,'serverNow',clock_timestamp(),
    'timedOut',a.deadline_at is not null and a.finished_at>=a.deadline_at);
$$;

create function knowledge_private.finish_expired(uid uuid) returns void language plpgsql set search_path='' as $$
declare candidate record; a knowledge_private.attempts; grade integer;
begin
  for candidate in select id,assignment_id from knowledge_private.attempts
    where user_id=uid and finished_at is null and deadline_at<=clock_timestamp() order by id loop
    if candidate.assignment_id is not null then perform 1 from knowledge_private.assignments where id=candidate.assignment_id for update; end if;
    select * into a from knowledge_private.attempts where id=candidate.id and finished_at is null for update;
    if not found or a.deadline_at>clock_timestamp() then continue; end if;
    select count(*)::integer into grade from jsonb_array_elements(a.questions) q where a.answers->(q->>'id')=q->'correct';
    update knowledge_private.attempts set score=grade,finished_at=deadline_at where id=a.id;
    if a.assignment_id is not null and grade*100>=a.total*a.pass_mark then
      update knowledge_private.assignments set completed_at=a.deadline_at,completed_attempt_id=a.id
        where id=a.assignment_id and completed_at is null and cancelled_at is null;
    end if;
  end loop;
end; $$;

alter function knowledge_private.workspace(jsonb) rename to workspace_before_training;
revoke all on function knowledge_private.workspace_before_training(jsonb) from public,anon,authenticated;
create function knowledge_private.workspace(payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); op text; result jsonb; a knowledge_private.attempts; t knowledge_private.tests;
  sq boolean; sa boolean; minutes integer;
begin
  if uid is null then raise exception using errcode='PT401',message='Войдите в аккаунт.'; end if;
  if jsonb_typeof(payload) is distinct from 'object' or octet_length(payload::text)>200000 then raise exception using errcode='PT400',message='Некорректные данные.'; end if;
  op:=coalesce(payload->>'action',payload->>'op','workspace');
  perform knowledge_private.finish_expired(uid);
  if op='answer' then
    select * into a from knowledge_private.attempts where id=payload->>'id' and user_id=uid;
    if found and a.finished_at is not null and a.deadline_at is not null and a.finished_at>=a.deadline_at then
      return jsonb_build_object('saved',false,'expired',true,'attempt',knowledge_private.attempt_json(a,true));
    end if;
  end if;
  if op='saveTest' then
    select * into t from knowledge_private.tests where id=nullif(payload->>'id','') and owner_id=uid;
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
  end if;
  result:=knowledge_private.workspace_before_training(payload);
  if op='saveTest' then
    update knowledge_private.tests set shuffle_questions=sq,shuffle_answers=sa,time_limit_minutes=minutes where id=result->>'id' and owner_id=uid;
  end if;
  return result;
exception when invalid_text_representation or numeric_value_out_of_range then
  raise exception using errcode='PT400',message='Проверьте настройки теста.';
end; $$;
revoke all on function knowledge_private.workspace(jsonb) from public,anon,authenticated;
grant execute on function knowledge_private.workspace(jsonb) to authenticated;
create or replace function public.knowledge_workspace(payload jsonb default '{}'::jsonb)
returns jsonb language sql security invoker set search_path='' as $$ select knowledge_private.workspace(payload); $$;

alter table knowledge_private.announcements add column requires_ack boolean not null default false;
create table knowledge_private.announcement_reads (
  announcement_id uuid not null references knowledge_private.announcements(id) on delete cascade,
  version integer not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  read_at timestamptz not null default now(),
  primary key(announcement_id,version,user_id)
);
create index announcement_reads_user on knowledge_private.announcement_reads(user_id,announcement_id);
alter table knowledge_private.announcement_reads enable row level security;
revoke all on knowledge_private.announcement_reads from public,anon,authenticated;
alter function knowledge_private.portal(jsonb) rename to portal_before_training;
revoke all on function knowledge_private.portal_before_training(jsonb) from public,anon,authenticated;
create function knowledge_private.portal(payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); op text; result jsonb; notice knowledge_private.announcements; required boolean;
begin
  if jsonb_typeof(payload) is distinct from 'object' or octet_length(payload::text)>40000 then raise exception using errcode='PT400',message='Некорректные данные.'; end if;
  op:=coalesce(payload->>'action',payload->>'op','announcements');
  if op in ('ackAnnouncement','announcementReaders') then
    if uid is null or not exists(select 1 from auth.users where id=uid and email_confirmed_at is not null) then raise exception using errcode='PT401',message='Войдите в аккаунт с подтверждённой почтой.'; end if;
    if op='announcementReaders' and not exists(select 1 from knowledge_private.test_creators where user_id=uid and role in ('owner','deputy')) then raise exception using errcode='PT403',message='Список ознакомления доступен руководству.'; end if;
    select * into notice from knowledge_private.announcements where id=(payload->>'id')::uuid and published for share;
    if not found or not notice.requires_ack then raise exception using errcode='PT404',message='Объявление для ознакомления не найдено.'; end if;
    if op='ackAnnouncement' then
      if (payload->>'version')::integer is distinct from notice.version then raise exception using errcode='PT409',message='Объявление изменилось. Обновите страницу и прочитайте новую версию.'; end if;
      insert into knowledge_private.announcement_reads(announcement_id,version,user_id) values(notice.id,notice.version,uid) on conflict do nothing;
      return jsonb_build_object('readAt',(select read_at from knowledge_private.announcement_reads where announcement_id=notice.id and version=notice.version and user_id=uid));
    end if;
    return jsonb_build_object('title',notice.title,'version',notice.version,'readers',coalesce((select jsonb_agg(jsonb_build_object('login',l.login_key,'readAt',r.read_at) order by l.login_key)
      from knowledge_private.logins l join auth.users u on u.id=l.user_id and u.email_confirmed_at is not null
      left join knowledge_private.announcement_reads r on r.user_id=l.user_id and r.announcement_id=notice.id and r.version=notice.version),'[]'::jsonb));
  end if;
  if op='saveAnnouncement' and payload?'requiresAck' and jsonb_typeof(payload->'requiresAck') is distinct from 'boolean' then raise exception using errcode='PT400',message='Проверьте настройку ознакомления.'; end if;
  result:=knowledge_private.portal_before_training(payload);
  if op='saveAnnouncement' and payload?'requiresAck' then
    update knowledge_private.announcements set requires_ack=(payload->>'requiresAck')::boolean where id=(result->>'id')::uuid;
  elsif op in ('announcements','manageAnnouncements') then
    result:=jsonb_build_object('announcements',coalesce((select jsonb_agg(x.value||jsonb_build_object('requiresAck',a.requires_ack,'readAt',r.read_at) order by x.ordinality)
      from jsonb_array_elements(result->'announcements') with ordinality x
      join knowledge_private.announcements a on a.id=(x.value->>'id')::uuid
      left join knowledge_private.announcement_reads r on r.announcement_id=a.id and r.version=a.version and r.user_id=uid),'[]'::jsonb));
  end if;
  return result;
exception when invalid_text_representation or numeric_value_out_of_range then raise exception using errcode='PT400',message='Проверьте данные формы.';
end; $$;
revoke all on function knowledge_private.portal(jsonb) from public,anon,authenticated;
grant execute on function knowledge_private.portal(jsonb) to anon,authenticated;
create or replace function public.knowledge_portal(payload jsonb default '{}'::jsonb)
returns jsonb language sql security invoker set search_path='' as $$ select knowledge_private.portal(payload); $$;

create table knowledge_private.training_program (
  singleton boolean primary key default true check(singleton), version integer not null default 1,
  required_tests text[] not null default '{}', updated_at timestamptz not null default now()
);
insert into knowledge_private.training_program(singleton) values(true);
create table knowledge_private.training_materials (
  id text primary key,title text not null,description text not null,href text not null,position integer not null
);
insert into knowledge_private.training_materials values
  ('first-shift','Памятка новой смены','Подготовка, общение, остановка, задержание и доказательства.','#new-employees',1),
  ('charter','Внутренний устав ГИБДД','Обязанности, дисциплина и пределы самостоятельной службы.','#laws?document=charter',2),
  ('road-law','КоАП и ПДД','Изучите оба документа: полномочия, дорожные нарушения и порядок действий.','#laws?document=administrative',3);
create table knowledge_private.material_reads (
  user_id uuid not null references auth.users(id) on delete cascade,
  material_id text not null references knowledge_private.training_materials(id) on delete cascade,
  program_version integer not null,read_at timestamptz not null default now(),
  primary key(user_id,material_id,program_version)
);
create index material_reads_material on knowledge_private.material_reads(material_id);
create table knowledge_private.service_clearances (
  user_id uuid primary key references auth.users(id) on delete cascade,
  status text not null check(status in ('pending','approved','rejected','revoked')),
  program_version integer not null,test_versions jsonb not null,
  requested_at timestamptz not null default now(),decided_at timestamptz,
  decided_by uuid references auth.users(id) on delete set null,note text not null default ''
);
create index clearances_decider on knowledge_private.service_clearances(decided_by);
create table knowledge_private.rp_scenarios (
  id text primary key,title text not null,description text not null,graph jsonb not null,published boolean not null default false
);
create table knowledge_private.rp_runs (
  id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id) on delete cascade,
  scenario_id text not null references knowledge_private.rp_scenarios(id) on delete restrict,
  title text not null,graph jsonb not null,node_id text,history jsonb not null default '[]',
  started_at timestamptz not null default now(),finished_at timestamptz
);
create unique index rp_runs_active on knowledge_private.rp_runs(user_id,scenario_id) where finished_at is null;
create index rp_runs_scenario on knowledge_private.rp_runs(scenario_id);
create index rp_runs_user on knowledge_private.rp_runs(user_id,started_at desc);
create table knowledge_private.management_events (
  id bigint generated always as identity primary key,created_at timestamptz not null default now(),
  actor_id uuid references auth.users(id) on delete set null,actor_login text not null,
  area text not null,operation text not null,target_id text not null,title text not null,details jsonb not null default '{}'
);
create index management_events_actor on knowledge_private.management_events(actor_id);
create index management_events_area on knowledge_private.management_events(area,id desc);
alter table knowledge_private.training_program enable row level security;
alter table knowledge_private.training_materials enable row level security;
alter table knowledge_private.material_reads enable row level security;
alter table knowledge_private.service_clearances enable row level security;
alter table knowledge_private.rp_scenarios enable row level security;
alter table knowledge_private.rp_runs enable row level security;
alter table knowledge_private.management_events enable row level security;
revoke all on knowledge_private.training_program,knowledge_private.training_materials,knowledge_private.material_reads,
  knowledge_private.service_clearances,knowledge_private.rp_scenarios,knowledge_private.rp_runs,knowledge_private.management_events from public,anon,authenticated;
revoke all on sequence knowledge_private.management_events_id_seq from public,anon,authenticated;

create function knowledge_private.clearance_state(subject uuid) returns jsonb language plpgsql stable set search_path='' as $$
declare p knowledge_private.training_program; c knowledge_private.service_clearances;
  materials jsonb; exams jsonb; fingerprint jsonb; ready boolean; material_ok boolean; exam_ok boolean;
begin
  select * into p from knowledge_private.training_program where singleton;
  select * into c from knowledge_private.service_clearances where user_id=subject;
  select coalesce(jsonb_agg(jsonb_build_object('id',m.id,'title',m.title,'description',m.description,'href',m.href,'readAt',r.read_at) order by m.position),'[]'),coalesce(bool_and(r.read_at is not null),false)
    into materials,material_ok from knowledge_private.training_materials m
    left join knowledge_private.material_reads r on r.material_id=m.id and r.user_id=subject and r.program_version=p.version;
  select coalesce(jsonb_agg(jsonb_build_object('id',x.id,'title',coalesce(t.title,'Тест недоступен'),'version',t.version,'published',coalesce(t.published,false),'passed',pass.id is not null,'passedAt',pass.finished_at) order by x.n),'[]'),
    coalesce(bool_and(pass.id is not null and t.published),false),
    coalesce(jsonb_agg(jsonb_build_object('id',x.id,'version',t.version,'published',t.published) order by x.n),'[]')
    into exams,exam_ok,fingerprint from unnest(p.required_tests) with ordinality x(id,n)
    left join knowledge_private.tests t on t.id=x.id
    left join lateral(select a.id,a.finished_at from knowledge_private.attempts a where a.user_id=subject and a.test_id=x.id
      and a.mode='exam' and a.test_version=t.version and a.finished_at is not null and a.score*100>=a.total*a.pass_mark
      order by a.finished_at desc limit 1) pass on true;
  ready:=material_ok and exam_ok and cardinality(p.required_tests)>0;
  return jsonb_build_object('programVersion',p.version,'materials',materials,'tests',exams,'ready',ready,'fingerprint',fingerprint,
    'status',case when c.user_id is null then 'preparing' when c.status in ('revoked','rejected') then c.status
      when c.program_version<>p.version or c.test_versions<>fingerprint or (c.status in ('pending','approved') and not ready) then 'outdated' else c.status end,
    'requestedAt',c.requested_at,'decidedAt',c.decided_at,'decidedBy',(select login_key from knowledge_private.logins where user_id=c.decided_by),'note',c.note);
end; $$;

create function knowledge_private.rp_run_json(r knowledge_private.rp_runs) returns jsonb language sql stable set search_path='' as $$
  select jsonb_build_object('id',r.id,'title',r.title,'scenarioId',r.scenario_id,'finishedAt',r.finished_at,'history',r.history,
    'node',case when r.finished_at is null then jsonb_build_object('id',r.node_id,'text',r.graph->'nodes'->r.node_id->>'text',
      'choices',(select jsonb_agg(jsonb_build_object('id',x->>'id','text',x->>'text')) from jsonb_array_elements(r.graph->'nodes'->r.node_id->'choices') x)) else null end);
$$;

create function knowledge_private.management_audit() returns trigger language plpgsql set search_path='' as $$
declare item jsonb; previous jsonb; actor uuid:=auth.uid(); label text; key text; info jsonb:='{}';
begin
  item:=case when tg_op='DELETE' then to_jsonb(old) else to_jsonb(new) end;
  previous:=case when tg_op='INSERT' then '{}'::jsonb else to_jsonb(old) end;
  if tg_op='UPDATE' and to_jsonb(new)=to_jsonb(old) then return new; end if;
  key:=coalesce(item->>'id',item->>'user_id','program');
  label:=coalesce(item->>'title',item->>'test_title',(select login_key from knowledge_private.logins where user_id=nullif(item->>'user_id','')::uuid),'Программа подготовки');
  if tg_table_name='tests' then info:=jsonb_build_object('published',item->'published','version',item->'version','questionsChanged',previous->'questions' is distinct from item->'questions');
  elsif tg_table_name='test_creators' then info:=jsonb_build_object('previousRole',previous->'role','role',case when tg_op='DELETE' then null else item->'role' end);
  elsif tg_table_name='assignments' then
    -- Passing an exam is a learning event, not a management action.
    if tg_op='UPDATE' and previous->'due_at'=item->'due_at' and previous->'cancelled_at'=item->'cancelled_at' then return new; end if;
    info:=jsonb_build_object('employee',item->'employee_login','dueAt',item->'due_at','cancelled',item->'cancelled_at'<>'null'::jsonb);
  elsif tg_table_name='service_clearances' then info:=jsonb_build_object('status',item->'status','note',item->'note');
  elsif tg_table_name='announcements' then info:=jsonb_build_object('version',item->'version','published',item->'published','requiresAck',item->'requires_ack');
  elsif tg_table_name='training_program' then info:=jsonb_build_object('version',item->'version'); end if;
  insert into knowledge_private.management_events(actor_id,actor_login,area,operation,target_id,title,details)
    values(actor,coalesce((select login_key from knowledge_private.logins where user_id=actor),'Системное изменение'),tg_table_name,lower(tg_op),key,label,info);
  return case when tg_op='DELETE' then old else new end;
end; $$;
create trigger audit_tests after insert or update or delete on knowledge_private.tests for each row execute function knowledge_private.management_audit();
create trigger audit_creators after insert or update or delete on knowledge_private.test_creators for each row execute function knowledge_private.management_audit();
create trigger audit_assignments after insert or update or delete on knowledge_private.assignments for each row execute function knowledge_private.management_audit();
create trigger audit_announcements after insert or update or delete on knowledge_private.announcements for each row execute function knowledge_private.management_audit();
create trigger audit_clearances after insert or update or delete on knowledge_private.service_clearances for each row execute function knowledge_private.management_audit();
create trigger audit_program after update on knowledge_private.training_program for each row execute function knowledge_private.management_audit();

create function knowledge_private.training(payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
<<training>>
declare uid uuid:=auth.uid(); op text; leader boolean; p knowledge_private.training_program; state jsonb; subject uuid;
  version integer; ids text[]; note text; status text; r knowledge_private.rp_runs; scenario knowledge_private.rp_scenarios;
  node jsonb; choice jsonb; next_node text; cursor_id bigint; search text; page integer; result jsonb;
begin
  if uid is null or not exists(select 1 from auth.users where id=uid and email_confirmed_at is not null) then raise exception using errcode='PT401',message='Войдите в аккаунт с подтверждённой почтой.'; end if;
  if jsonb_typeof(payload) is distinct from 'object' or octet_length(payload::text)>20000 then raise exception using errcode='PT400',message='Некорректные данные.'; end if;
  op:=coalesce(payload->>'action',payload->>'op','overview');
  select coalesce(role in ('owner','deputy'),false) into leader from knowledge_private.test_creators where user_id=uid for share;
  leader:=coalesce(leader,false);
  if op in ('saveProgram','clearanceTeam','decideClearance','audit') and not leader then raise exception using errcode='PT403',message='Этот раздел доступен владельцу и заместителю.'; end if;
  if op in ('overview','ackMaterial','requestClearance','saveProgram','clearanceTeam','decideClearance') then
    if op='saveProgram' then select * into p from knowledge_private.training_program where singleton for update;
    else select * into p from knowledge_private.training_program where singleton for share; end if;
  end if;
  if op='saveProgram' then
    if (payload->>'version')::integer is distinct from p.version then raise exception using errcode='PT409',message='Программа уже изменена. Обновите страницу.'; end if;
    if jsonb_typeof(payload->'requiredTests') is distinct from 'array' or jsonb_array_length(payload->'requiredTests') not between 1 and 12 then raise exception using errcode='PT400',message='Выберите от 1 до 12 обязательных тестов.'; end if;
    select array_agg(distinct value order by value) into ids from jsonb_array_elements_text(payload->'requiredTests');
    if exists(select 1 from unnest(ids) x left join knowledge_private.tests t on t.id=x where t.id is null or not t.published or t.demo) then raise exception using errcode='PT400',message='Можно выбрать только опубликованные служебные тесты.'; end if;
    if ids is distinct from (select array_agg(x order by x) from unnest(p.required_tests) x) then
      update knowledge_private.training_program set required_tests=ids,version=training_program.version+1,updated_at=now() where singleton;
    end if;
  elsif op='ackMaterial' then
    if (payload->>'version')::integer is distinct from p.version then raise exception using errcode='PT409',message='Программа подготовки изменилась. Обновите страницу.'; end if;
    if not exists(select 1 from knowledge_private.training_materials where id=payload->>'id') then raise exception using errcode='PT404',message='Материал не найден.'; end if;
    insert into knowledge_private.material_reads(user_id,material_id,program_version) values(uid,payload->>'id',p.version) on conflict do nothing;
  elsif op in ('requestClearance','decideClearance') then
    subject:=case when op='requestClearance' then uid else (payload->>'userId')::uuid end;
    if subject is null then raise exception using errcode='PT400',message='Выберите сотрудника.'; end if;
    if op='decideClearance' and subject=uid then raise exception using errcode='PT403',message='Собственный допуск подтверждает другой руководитель.'; end if;
    -- Serialize decisions and protect the program and test editions while checking eligibility.
    perform pg_advisory_xact_lock(hashtextextended('clearance:'||subject::text,0));
    perform 1 from knowledge_private.tests where id=any(p.required_tests) order by id for share;
    perform knowledge_private.finish_expired(subject);
    state:=knowledge_private.clearance_state(subject);
    if op='requestClearance' then
      if not (state->>'ready')::boolean then raise exception using errcode='PT409',message='Изучите материалы и пройдите все обязательные тесты текущей редакции.'; end if;
      if state->>'status' in ('pending','approved') then return state; end if;
      insert into knowledge_private.service_clearances(user_id,status,program_version,test_versions)
        values(uid,'pending',p.version,state->'fingerprint') on conflict(user_id) do update
        set status='pending',program_version=excluded.program_version,test_versions=excluded.test_versions,requested_at=now(),decided_at=null,decided_by=null,note='';
    else
      status:=payload->>'status'; note:=knowledge_private.text_field(coalesce(payload->'note','""'::jsonb),'Комментарий',0,600);
      if status not in ('approved','rejected','revoked') or status is null then raise exception using errcode='PT400',message='Выберите решение.'; end if;
      if status in ('approved','rejected') and state->>'status'<>'pending' then raise exception using errcode='PT409',message='Нет актуальной заявки на рассмотрение.'; end if;
      if status='approved' and not (state->>'ready')::boolean then raise exception using errcode='PT409',message='Подготовка не завершена.'; end if;
      if status='revoked' and state->>'status' not in ('approved','outdated') then raise exception using errcode='PT409',message='Действующий допуск не найден.'; end if;
      if status in ('rejected','revoked') and char_length(note)<3 then raise exception using errcode='PT400',message='Укажите причину решения.'; end if;
      update knowledge_private.service_clearances set status=training.status,note=training.note,decided_at=now(),decided_by=uid where user_id=subject;
      return knowledge_private.clearance_state(subject);
    end if;
  end if;
  if op in ('overview','ackMaterial','requestClearance','saveProgram') then
    perform knowledge_private.finish_expired(uid);
    return knowledge_private.clearance_state(uid)||jsonb_build_object('canManage',leader,'availableTests',case when leader then
      coalesce((select jsonb_agg(jsonb_build_object('id',id,'title',title) order by title) from knowledge_private.tests where published and not demo),'[]'::jsonb) else '[]'::jsonb end);
  elsif op='clearanceTeam' then
    search:=lower(btrim(coalesce(payload->>'search',''))); page:=greatest(0,least(coalesce((payload->>'page')::integer,0),100000));
    return jsonb_build_object('total',(select count(*) from knowledge_private.logins l join auth.users u on u.id=l.user_id where u.email_confirmed_at is not null and position(search in l.login_key)>0),
      'people',coalesce((select jsonb_agg(jsonb_build_object('userId',l.user_id,'login',l.login_key,'state',knowledge_private.clearance_state(l.user_id)) order by l.login_key)
        from (select l.* from knowledge_private.logins l join auth.users u on u.id=l.user_id where u.email_confirmed_at is not null and position(search in l.login_key)>0 order by l.login_key limit 30 offset page*30) l),'[]'::jsonb));
  elsif op='scenarios' then
    return jsonb_build_object('scenarios',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'title',s.title,'description',s.description,
      'activeRunId',(select id from knowledge_private.rp_runs where user_id=uid and scenario_id=s.id and finished_at is null),
      'completed',(select count(*) from knowledge_private.rp_runs where user_id=uid and scenario_id=s.id and finished_at is not null)) order by s.id)
      from knowledge_private.rp_scenarios s where s.published),'[]'::jsonb));
  elsif op='startScenario' then
    select * into scenario from knowledge_private.rp_scenarios where id=payload->>'scenarioId' and published for share;
    if not found then raise exception using errcode='PT404',message='Ситуация недоступна.'; end if;
    perform pg_advisory_xact_lock(hashtextextended('scenario:'||uid::text||':'||scenario.id,0));
    select * into r from knowledge_private.rp_runs where user_id=uid and scenario_id=scenario.id and finished_at is null;
    if not found then insert into knowledge_private.rp_runs(user_id,scenario_id,title,graph,node_id)
      values(uid,scenario.id,scenario.title,scenario.graph,scenario.graph->>'start') returning * into r; end if;
    return knowledge_private.rp_run_json(r);
  elsif op in ('scenarioRun','chooseScenario') then
    select * into r from knowledge_private.rp_runs where id=(payload->>'id')::uuid and user_id=uid for update;
    if not found then raise exception using errcode='PT404',message='Прохождение не найдено.'; end if;
    if op='chooseScenario' then
      if r.finished_at is not null or (payload->>'nodeId') is distinct from r.node_id then raise exception using errcode='PT409',message='Этот шаг уже завершён. Обновите ситуацию.'; end if;
      node:=r.graph->'nodes'->r.node_id;
      select x into choice from jsonb_array_elements(node->'choices') x where x->>'id'=payload->>'choiceId';
      if not found then raise exception using errcode='PT400',message='Выберите действие из списка.'; end if;
      next_node:=nullif(choice->>'next','');
      if next_node is not null and not (r.graph->'nodes'?next_node) then raise exception using errcode='PT409',message='Сценарий требует исправления. Сообщите руководителю.'; end if;
      if jsonb_array_length(r.history)>=30 then raise exception using errcode='PT409',message='Достигнут предел шагов ситуации.'; end if;
      update knowledge_private.rp_runs set node_id=next_node,finished_at=case when next_node is null then now() end,
        history=history||jsonb_build_array(jsonb_build_object('nodeId',r.node_id,'question',node->>'text','choice',choice->>'text',
          'correct',choice->'correct','feedback',choice->>'feedback','reference',choice->'reference')) where id=r.id returning * into r;
    end if;
    return knowledge_private.rp_run_json(r);
  elsif op='audit' then
    if payload?'before' and payload->>'before' is not null then cursor_id:=(payload->>'before')::bigint; end if;
    return jsonb_build_object('events',coalesce((select jsonb_agg(jsonb_build_object('id',id::text,'createdAt',created_at,'actor',actor_login,'area',area,'operation',operation,'title',title,'details',details) order by id desc)
      from (select * from knowledge_private.management_events where (cursor_id is null or id<cursor_id) and (coalesce(payload->>'area','')='' or area=payload->>'area') order by id desc limit 50) e),'[]'::jsonb));
  end if;
  raise exception using errcode='PT400',message='Неизвестная операция.';
exception when invalid_text_representation or numeric_value_out_of_range then raise exception using errcode='PT400',message='Проверьте данные формы.';
end; $$;
-- Every new helper remains inaccessible even with direct RPC calls in a private schema.
revoke all on function knowledge_private.random_questions(jsonb,boolean,boolean),knowledge_private.test_revision(),
  knowledge_private.assignment_settings(),knowledge_private.attempt_settings(),knowledge_private.test_json_before_training(knowledge_private.tests,uuid,boolean),
  knowledge_private.test_json(knowledge_private.tests,uuid,boolean),knowledge_private.attempt_json_before_training(knowledge_private.attempts,boolean),
  knowledge_private.attempt_json(knowledge_private.attempts,boolean),knowledge_private.finish_expired(uuid),knowledge_private.clearance_state(uuid),
  knowledge_private.rp_run_json(knowledge_private.rp_runs),knowledge_private.management_audit(),knowledge_private.training(jsonb) from public,anon,authenticated;
grant execute on function knowledge_private.training(jsonb) to authenticated;
create function public.knowledge_training(payload jsonb default '{}'::jsonb)
returns jsonb language sql security invoker set search_path='' as $$ select knowledge_private.training(payload); $$;
revoke all on function public.knowledge_training(jsonb) from public,anon,authenticated;
grant execute on function public.knowledge_training(jsonb) to authenticated;
comment on function public.knowledge_training(jsonb) is 'Confirmed users access their own study records and RP runs. Owner/deputy review clearance and audit records. Clearance never grants application permissions.';
