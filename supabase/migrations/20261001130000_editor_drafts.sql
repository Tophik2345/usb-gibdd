-- Incomplete editor drafts are separate from published tests and their immutable attempts.
create table knowledge_private.test_drafts (
  owner_id uuid not null references auth.users(id) on delete cascade,
  id text not null,
  test_id text references knowledge_private.tests(id) on delete cascade,
  base_version integer,
  form jsonb not null,
  version integer not null default 1,
  updated_at timestamptz not null default now(),
  primary key(owner_id,id)
);
alter table knowledge_private.test_drafts enable row level security;
revoke all on knowledge_private.test_drafts from public,anon,authenticated;

create function knowledge_private.draft_form(value jsonb,test_key text)
returns jsonb language plpgsql set search_path='' as $$
declare item jsonb; option_value jsonb; key text; result jsonb; questions jsonb:='[]'; ids text[]:='{}';
begin
  if jsonb_typeof(value) is distinct from 'object' then raise exception using errcode='PT400',message='Некорректный черновик.'; end if;
  foreach key in array array['title','description','category'] loop
    if jsonb_typeof(value->key) is distinct from 'string' or char_length(value->>key)>(case key when 'title' then 120 when 'description' then 600 else 60 end) then
      raise exception using errcode='PT400',message='Проверьте название, описание и тему черновика.';
    end if;
  end loop;
  if jsonb_typeof(value->'passMark') is distinct from 'number' or (value->>'passMark') !~ '^[0-9]{1,3}$' or (value->>'passMark')::integer>100
    or jsonb_typeof(value->'published') is distinct from 'boolean'
    or jsonb_typeof(value->'shuffleQuestions') is distinct from 'boolean' or jsonb_typeof(value->'shuffleAnswers') is distinct from 'boolean' then
    raise exception using errcode='PT400',message='Проверьте настройки черновика.';
  end if;
  if coalesce(value->'timeLimitMinutes','null'::jsonb)<>'null'::jsonb then
    if jsonb_typeof(value->'timeLimitMinutes') is distinct from 'number' or (value->>'timeLimitMinutes') !~ '^[0-9]{1,3}$' or (value->>'timeLimitMinutes')::integer>180 then
      raise exception using errcode='PT400',message='Таймер: от 0 до 180 минут.';
    end if;
  end if;
  if jsonb_typeof(value->'questions') is distinct from 'array' then raise exception using errcode='PT400',message='Нужен список вопросов.'; end if;
  if jsonb_array_length(value->'questions') not between 1 and 60 then raise exception using errcode='PT400',message='В черновике должно быть от 1 до 60 вопросов.'; end if;
  for item in select x.value from jsonb_array_elements(value->'questions') x loop
    if jsonb_typeof(item) is distinct from 'object' or jsonb_typeof(item->'id') is distinct from 'string' or char_length(item->>'id') not between 1 and 100 or (item->>'id')=any(ids)
      or jsonb_typeof(item->'text') is distinct from 'string' or char_length(item->>'text')>1000
      or jsonb_typeof(item->'explanation') is distinct from 'string' or char_length(item->>'explanation')>1000
      or jsonb_typeof(item->'options') is distinct from 'array' then raise exception using errcode='PT400',message='Проверьте вопрос черновика.'; end if;
    if jsonb_array_length(item->'options') not between 2 and 6 or jsonb_typeof(item->'correct') is distinct from 'number' or (item->>'correct') !~ '^[0-9]$'
      or (item->>'correct')::integer>=jsonb_array_length(item->'options') then raise exception using errcode='PT400',message='Проверьте варианты ответа.'; end if;
    for option_value in select x.value from jsonb_array_elements(item->'options') x loop
      if jsonb_typeof(option_value) is distinct from 'string' or char_length(option_value#>>'{}')>350 then raise exception using errcode='PT400',message='Вариант ответа: не более 350 символов.'; end if;
    end loop;
    ids:=array_append(ids,item->>'id');
    questions:=questions||jsonb_build_array(jsonb_build_object('id',item->'id','text',item->'text','options',item->'options','correct',item->'correct','explanation',item->'explanation'));
  end loop;
  result:=jsonb_build_object('id',coalesce(test_key,''),'title',value->'title','description',value->'description','category',value->'category','passMark',value->'passMark',
    'published',value->'published','shuffleQuestions',value->'shuffleQuestions','shuffleAnswers',value->'shuffleAnswers','timeLimitMinutes',value->'timeLimitMinutes','questions',questions,'count',jsonb_array_length(questions));
  return result;
end; $$;
revoke all on function knowledge_private.draft_form(jsonb,text) from public,anon,authenticated;

create function knowledge_private.editor(payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); op text; draft_key text; test_key text; expected integer; base integer; member_role text;
  t knowledge_private.tests; d knowledge_private.test_drafts; content jsonb; result jsonb; new_key text;
begin
  perform knowledge_private.require_active_account();
  if not exists(select 1 from auth.users where id=uid and email_confirmed_at is not null) then raise exception using errcode='PT401',message='Подтвердите почту и войдите в аккаунт.'; end if;
  select role into member_role from knowledge_private.test_creators where user_id=uid for share;
  if member_role is null then raise exception using errcode='PT403',message='Редактор доступен только авторам, добавленным владельцем сайта.'; end if;
  if jsonb_typeof(payload) is distinct from 'object' or octet_length(payload::text)>200000 then raise exception using errcode='PT400',message='Черновик слишком большой или содержит некорректные данные.'; end if;
  op:=payload->>'action';
  if op='list' then
    return jsonb_build_object('drafts',coalesce((select jsonb_agg(jsonb_build_object('id',id,'testId',test_id,'title',form->>'title','version',version,'baseVersion',base_version,'updatedAt',updated_at) order by updated_at desc)
      from knowledge_private.test_drafts where owner_id=uid),'[]'::jsonb));
  end if;
  if op='copy' then
    select * into t from knowledge_private.tests where id=payload->>'testId' and owner_id=uid and not demo for share;
    if not found then raise exception using errcode='PT403',message='Копировать можно только свои тесты.'; end if;
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
    select * into t from knowledge_private.tests where id=test_key and owner_id=uid and not demo for update;
    if not found then raise exception using errcode='PT403',message='Редактировать можно только свои тесты.'; end if;
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
  result:=knowledge_private.workspace(d.form||jsonb_build_object('action','saveTest','id',coalesce(test_key,'')));
  delete from knowledge_private.test_drafts where owner_id=uid and id=draft_key;
  select * into t from knowledge_private.tests where id=result->>'id';
  return knowledge_private.test_json(t,uid,true);
exception when invalid_text_representation or numeric_value_out_of_range then raise exception using errcode='PT400',message='Проверьте настройки и ID черновика.';
end; $$;
revoke all on function knowledge_private.editor(jsonb) from public,anon,authenticated;
grant execute on function knowledge_private.editor(jsonb) to authenticated;
create function public.knowledge_editor(payload jsonb default '{}'::jsonb) returns jsonb language sql security invoker set search_path='' as $$ select knowledge_private.editor(payload); $$;
revoke all on function public.knowledge_editor(jsonb) from public,anon,authenticated;
grant execute on function public.knowledge_editor(jsonb) to authenticated;
comment on function public.knowledge_editor(jsonb) is 'Private editor drafts 20261001130000';
notify pgrst,'reload schema';
