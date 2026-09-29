-- All application data is private. Only the authenticated RPC is exposed.
create schema if not exists knowledge_private;
revoke all on schema knowledge_private from public, anon, authenticated;

create table knowledge_private.tests (
  id text primary key,
  owner_id uuid references auth.users(id) on delete cascade,
  title text not null,
  description text not null default '',
  category text not null,
  pass_mark integer not null check (pass_mark between 1 and 100),
  questions jsonb not null check (jsonb_typeof(questions) = 'array'),
  published boolean not null default false,
  demo boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((demo and owner_id is null) or (not demo and owner_id is not null))
);
create index tests_owner on knowledge_private.tests(owner_id);
create index tests_published on knowledge_private.tests(published, created_at desc);

create table knowledge_private.attempts (
  id text primary key default gen_random_uuid()::text,
  test_id text not null references knowledge_private.tests(id) on delete restrict,
  author_id uuid references auth.users(id) on delete set null,
  user_id uuid not null references auth.users(id) on delete cascade,
  employee_name text not null,
  test_title text not null,
  pass_mark integer not null check (pass_mark between 1 and 100),
  questions jsonb not null,
  answers jsonb not null default '{}'::jsonb,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  score integer,
  total integer not null check (total between 1 and 60),
  check (score is null or score between 0 and total),
  check ((finished_at is null and score is null) or (finished_at is not null and score is not null))
);
create index attempts_user on knowledge_private.attempts(user_id, started_at desc);
create index attempts_author on knowledge_private.attempts(author_id, finished_at desc);
create unique index one_active_attempt on knowledge_private.attempts(user_id, test_id) where finished_at is null;
alter table knowledge_private.tests enable row level security;
alter table knowledge_private.attempts enable row level security;
-- Deliberately no client table policies or grants: direct REST/GraphQL is denied.
revoke all on all tables in schema knowledge_private from public, anon, authenticated;

create function knowledge_private.text_field(value jsonb, label text, lo integer, hi integer)
returns text language plpgsql immutable set search_path = '' as $$
declare result text;
begin
  if jsonb_typeof(value) is distinct from 'string' then
    raise exception using errcode='PT400', message=label || ': требуется текст.';
  end if;
  result := btrim(value #>> '{}');
  if char_length(result) < lo or char_length(result) > hi then
    raise exception using errcode='PT400', message=label || ': от ' || lo || ' до ' || hi || ' символов.';
  end if;
  return result;
end;
$$;

create function knowledge_private.questions_checked(value jsonb)
returns jsonb language plpgsql volatile set search_path = '' as $$
declare q jsonb; option_value jsonb; options jsonb; result jsonb := '[]'; correct integer; n integer := 0;
begin
  if jsonb_typeof(value) is distinct from 'array' then
    raise exception using errcode='PT400', message='Нужен список вопросов.';
  end if;
  if jsonb_array_length(value) not between 1 and 60 then
    raise exception using errcode='PT400', message='В тесте должно быть от 1 до 60 вопросов.';
  end if;
  for q in select x.value from jsonb_array_elements(value) x loop
    n := n + 1;
    if jsonb_typeof(q) is distinct from 'object' or jsonb_typeof(q->'options') is distinct from 'array' then
      raise exception using errcode='PT400', message='Вопрос должен содержать варианты ответов.';
    end if;
    if jsonb_array_length(q->'options') not between 2 and 6 then
      raise exception using errcode='PT400', message='В вопросе должно быть от 2 до 6 вариантов.';
    end if;
    options := '[]';
    for option_value in select x.value from jsonb_array_elements(q->'options') x loop
      options := options || jsonb_build_array(knowledge_private.text_field(option_value,'Вариант ответа',1,350));
    end loop;
    if (select count(distinct lower(x.value)) from jsonb_array_elements_text(options) x) <> jsonb_array_length(options) then
      raise exception using errcode='PT400', message='Варианты ответа должны различаться.';
    end if;
    if jsonb_typeof(q->'correct') is distinct from 'number' or coalesce(q->>'correct','') !~ '^[0-9]+$' then
      raise exception using errcode='PT400', message='Укажите верный ответ.';
    end if;
    correct := (q->>'correct')::integer;
    if correct < 0 or correct >= jsonb_array_length(options) then
      raise exception using errcode='PT400', message='Укажите верный ответ из списка вариантов.';
    end if;
    result := result || jsonb_build_array(jsonb_build_object(
      'id',gen_random_uuid()::text,
      'text',knowledge_private.text_field(q->'text','Вопрос',3,1000),
      'options',options,'correct',correct,
      'explanation',knowledge_private.text_field(coalesce(q->'explanation','""'::jsonb),'Пояснение',0,1000)
    ));
  end loop;
  return result;
end;
$$;

create function knowledge_private.test_json(t knowledge_private.tests, uid uuid, details boolean default false)
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object('id',t.id,'title',t.title,'description',t.description,
    'category',t.category,'passMark',t.pass_mark,'count',jsonb_array_length(t.questions),
    'published',t.published,'mine',coalesce(t.owner_id=uid,false),'demo',t.demo)
    || case when details then jsonb_build_object('questions',t.questions) else '{}'::jsonb end;
$$;

create function knowledge_private.attempt_json(a knowledge_private.attempts, details boolean default false)
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object('id',a.id,'testId',a.test_id,'testTitle',a.test_title,
    'employeeName',a.employee_name,'passMark',a.pass_mark,'startedAt',a.started_at,
    'finishedAt',a.finished_at,'score',a.score,'total',a.total,'demo',a.test_id='demo-information')
    || case when details then jsonb_build_object('answers',a.answers,'questions',
      case when a.finished_at is not null then a.questions else (
        select jsonb_agg(jsonb_build_object('id',q.value->'id','text',q.value->'text','options',q.value->'options') order by q.ordinality)
        from jsonb_array_elements(a.questions) with ordinality q
      ) end
    ) else '{}'::jsonb end;
$$;

create function knowledge_private.workspace(payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
<<api>>
declare
  uid uuid := auth.uid();
  op text;
  t knowledge_private.tests;
  a knowledge_private.attempts;
  questions jsonb;
  question jsonb;
  title text;
  description text;
  category text;
  employee text;
  test_key text;
  pass_mark integer;
  choice integer;
  score_value integer;
  published boolean;
begin
  if uid is null then raise exception using errcode='PT401',message='Войдите в аккаунт, чтобы продолжить.'; end if;
  if jsonb_typeof(payload) is distinct from 'object' or octet_length(payload::text)>200000 then
    raise exception using errcode='PT400',message='Некорректные данные или слишком большой тест.';
  end if;
  op := coalesce(payload->>'action',payload->>'op','workspace');

  if op='test' then
    select * into t from knowledge_private.tests where id=payload->>'id' and owner_id=uid;
    if not found then raise exception using errcode='PT404',message='Тест не найден.'; end if;
    return knowledge_private.test_json(t,uid,true);
  elsif op='attempt' then
    select * into a from knowledge_private.attempts where id=payload->>'id' and user_id=uid;
    if not found then raise exception using errcode='PT404',message='Попытка не найдена.'; end if;
    return knowledge_private.attempt_json(a,true);
  elsif op='workspace' then
    return jsonb_build_object(
      'user',jsonb_build_object('email',coalesce(auth.jwt()->>'email',''),
        'displayName',coalesce(nullif(auth.jwt()->'user_metadata'->>'full_name',''),auth.jwt()->>'email','Сотрудник')),
      'tests',coalesce((select jsonb_agg(knowledge_private.test_json(x,uid) order by x.demo,x.created_at desc)
        from knowledge_private.tests x where x.published),'[]'::jsonb),
      'managed',coalesce((select jsonb_agg(knowledge_private.test_json(x,uid) order by x.created_at desc)
        from knowledge_private.tests x where x.owner_id=uid),'[]'::jsonb),
      'attempts',coalesce((select jsonb_agg(knowledge_private.attempt_json(x) order by x.started_at desc)
        from (select * from knowledge_private.attempts where user_id=uid order by started_at desc limit 500) x),'[]'::jsonb),
      'team',coalesce((select jsonb_agg(knowledge_private.attempt_json(x) order by x.finished_at desc)
        from (select * from knowledge_private.attempts where author_id=uid and finished_at is not null order by finished_at desc limit 500) x),'[]'::jsonb)
    );
  elsif op='saveTest' then
    title := knowledge_private.text_field(payload->'title','Название',3,120);
    description := knowledge_private.text_field(coalesce(payload->'description','""'::jsonb),'Описание',0,600);
    category := knowledge_private.text_field(coalesce(payload->'category','"Общие знания"'::jsonb),'Тема',1,60);
    if jsonb_typeof(payload->'passMark') is distinct from 'number' or coalesce(payload->>'passMark','') !~ '^[0-9]+$' then
      raise exception using errcode='PT400',message='Проходной балл должен быть от 1 до 100%.';
    end if;
    pass_mark := (payload->>'passMark')::integer;
    if pass_mark not between 1 and 100 then raise exception using errcode='PT400',message='Проходной балл должен быть от 1 до 100%.'; end if;
    if jsonb_typeof(payload->'published') is distinct from 'boolean' then raise exception using errcode='PT400',message='Укажите статус публикации.'; end if;
    published := (payload->>'published')::boolean;
    questions := knowledge_private.questions_checked(payload->'questions');
    test_key := nullif(payload->>'id','');
    if test_key is null then
      test_key := gen_random_uuid()::text;
      insert into knowledge_private.tests(id,owner_id,title,description,category,pass_mark,questions,published)
        values(test_key,uid,title,description,category,pass_mark,questions,published);
    else
      -- Column names are qualified to avoid ambiguity with PL/pgSQL variables.
      update knowledge_private.tests x set title=api.title,
        description=api.description,category=api.category,
        pass_mark=api.pass_mark,questions=api.questions,
        published=api.published,updated_at=now()
        where x.id=test_key and x.owner_id=uid and not x.demo;
      if not found then raise exception using errcode='PT403',message='Изменять тест может только его автор.'; end if;
    end if;
    return jsonb_build_object('id',test_key);
  elsif op='start' then
    employee := knowledge_private.text_field(payload->'employeeName','Имя сотрудника',2,100);
    test_key := payload->>'testId';
    select * into t from knowledge_private.tests x where x.id=test_key and x.published for share;
    if not found then raise exception using errcode='PT404',message='Этот тест пока недоступен.'; end if;
    perform pg_advisory_xact_lock(hashtextextended(uid::text||':'||test_key,0));
    select * into a from knowledge_private.attempts x where x.test_id=test_key and x.user_id=uid and x.finished_at is null;
    if found then return knowledge_private.attempt_json(a,true); end if;
    insert into knowledge_private.attempts(test_id,author_id,user_id,employee_name,test_title,pass_mark,questions,total)
      values(t.id,t.owner_id,uid,employee,t.title,t.pass_mark,t.questions,jsonb_array_length(t.questions)) returning * into a;
    return knowledge_private.attempt_json(a,true);
  elsif op='answer' or op='submit' then
    select * into a from knowledge_private.attempts x where x.id=payload->>'id' and x.user_id=uid for update;
    if not found then raise exception using errcode='PT404',message='Попытка не найдена.'; end if;
    if op='answer' then
      if a.finished_at is not null then raise exception using errcode='PT409',message='Тест уже завершён.'; end if;
      select q.value into question from jsonb_array_elements(a.questions) q where q.value->>'id'=payload->>'questionId';
      if not found or jsonb_typeof(payload->'choice') is distinct from 'number' or coalesce(payload->>'choice','') !~ '^[0-9]+$' then
        raise exception using errcode='PT400',message='Некорректный ответ.';
      end if;
      choice := (payload->>'choice')::integer;
      if choice < 0 or choice >= jsonb_array_length(question->'options') then raise exception using errcode='PT400',message='Некорректный ответ.'; end if;
      update knowledge_private.attempts x set answers=jsonb_set(x.answers,array[question->>'id'],to_jsonb(choice),true) where x.id=a.id;
      return jsonb_build_object('saved',true);
    end if;
    if a.finished_at is not null then return knowledge_private.attempt_json(a,true); end if;
    if exists(select 1 from jsonb_array_elements(a.questions) q where not (a.answers ? (q.value->>'id'))) then
      raise exception using errcode='PT400',message='Ответьте на все вопросы перед завершением.';
    end if;
    select count(*)::integer into score_value from jsonb_array_elements(a.questions) q
      where a.answers->(q.value->>'id')=q.value->'correct';
    update knowledge_private.attempts x set score=score_value,finished_at=now() where x.id=a.id returning * into a;
    return knowledge_private.attempt_json(a,true);
  end if;
  raise exception using errcode='PT400',message='Неизвестное действие.';
exception when invalid_text_representation or numeric_value_out_of_range then
  raise exception using errcode='PT400',message='Некорректные значения полей.';
end;
$$;

create function public.knowledge_workspace(payload jsonb default '{}'::jsonb)
returns jsonb language sql security invoker set search_path = '' as $$
  select knowledge_private.workspace(payload);
$$;

revoke all on all functions in schema knowledge_private from public, anon, authenticated;
grant usage on schema knowledge_private to authenticated;
grant execute on function knowledge_private.workspace(jsonb) to authenticated;
revoke all on function public.knowledge_workspace(jsonb) from public, anon, authenticated;
grant execute on function public.knowledge_workspace(jsonb) to authenticated;
comment on function public.knowledge_workspace(jsonb) is 'Authenticated knowledge-testing API. Caller identity is auth.uid(), never a supplied owner/user ID.';
