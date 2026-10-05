-- Private reports and read markers; identities and question context come from the server.
create table knowledge_private.content_reports (
  id uuid primary key, author_id uuid not null references auth.users(id) on delete cascade,
  author_login text not null, kind text not null check(kind in ('question','law')),
  context jsonb not null, description text not null,
  status text not null default 'new' check(status in ('new','in_review','resolved','rejected')),
  response text not null default '', version integer not null default 1,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index content_reports_author on knowledge_private.content_reports(author_id,created_at desc);
create index content_reports_queue on knowledge_private.content_reports(status,created_at desc);
create table knowledge_private.rule_update_reads (
  user_id uuid not null references auth.users(id) on delete cascade,
  revision_id text not null, read_at timestamptz not null default now(), primary key(user_id,revision_id)
);
alter table knowledge_private.content_reports enable row level security;
alter table knowledge_private.rule_update_reads enable row level security;
revoke all on knowledge_private.content_reports,knowledge_private.rule_update_reads from public,anon,authenticated;

create function knowledge_private.support(payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
<<support_request>>
declare uid uuid:=auth.uid(); op text:=coalesce(payload->>'action','list'); leader boolean; item knowledge_private.content_reports;
  key uuid; kind text; description text; context jsonb; a knowledge_private.attempts; question jsonb;
  document text; article text; scope text; status text; offset_value integer; ids text[]; response text; expected integer;
begin
  perform knowledge_private.require_active_account();
  if not exists(select 1 from auth.users where id=uid and email_confirmed_at is not null) then
    raise exception using errcode='PT401',message='Войдите в аккаунт с подтверждённой почтой.';
  end if;
  if jsonb_typeof(payload) is distinct from 'object' or octet_length(payload::text)>30000 then raise exception using errcode='PT400',message='Некорректные данные.'; end if;
  select coalesce(role in ('owner','deputy'),false) into leader from knowledge_private.test_creators where user_id=uid for share;
  leader:=coalesce(leader,false);
  if op in ('ruleReads','markRules') then
    if op='markRules' then
      if jsonb_typeof(payload->'ids') is distinct from 'array' then raise exception using errcode='PT400',message='Проверьте список обновлений.'; end if;
      if jsonb_array_length(payload->'ids') not between 1 and 100 or exists(select 1 from jsonb_array_elements(payload->'ids') x where jsonb_typeof(x)<>'string' or (x#>>'{}') !~ '^(charter|criminal|labour|procedure|police|traffic-police|administrative|traffic-rules|state-organizations)-[a-f0-9]{24}$') then
        raise exception using errcode='PT400',message='Проверьте список обновлений.';
      end if;
      select array_agg(distinct value) into ids from jsonb_array_elements_text(payload->'ids');
      perform pg_advisory_xact_lock(hashtextextended('rule-read:'||uid::text,0));
      if (select count(*) from knowledge_private.rule_update_reads where user_id=uid)+(select count(*) from unnest(ids) x where not exists(select 1 from knowledge_private.rule_update_reads where user_id=uid and revision_id=x))>20000 then
        raise exception using errcode='PT429',message='Достигнут предел отметок обновлений.';
      end if;
      insert into knowledge_private.rule_update_reads(user_id,revision_id) select uid,x from unnest(ids) x on conflict do nothing;
    end if;
    return jsonb_build_object('ids',coalesce((select jsonb_agg(revision_id) from knowledge_private.rule_update_reads where user_id=uid),'[]'::jsonb));
  elsif op='create' then
    key:=(payload->>'id')::uuid;
    if key is null then raise exception using errcode='PT400',message='Обновите форму сообщения.'; end if;
    perform pg_advisory_xact_lock(hashtextextended('content-report:'||uid::text,0));
    select * into item from knowledge_private.content_reports where id=key;
    if found then
      if item.author_id<>uid then raise exception using errcode='PT404',message='Сообщение не найдено.'; end if;
      return jsonb_build_object('id',key);
    end if;
    kind:=knowledge_private.text_field(payload->'kind','Тип сообщения',1,20);
    description:=knowledge_private.text_field(payload->'description','Описание ошибки',10,4000);
    if kind='question' then
      select * into a from knowledge_private.attempts where id=payload->>'attemptId' and user_id=uid;
      if not found then raise exception using errcode='PT404',message='Вопрос не найден.'; end if;
      select x into question from jsonb_array_elements(a.questions) x where x->>'id'=payload->>'questionId';
      if question is null then raise exception using errcode='PT404',message='Вопрос не найден.'; end if;
      context:=jsonb_build_object('attemptId',a.id,'testId',a.test_id,'testTitle',a.test_title,'testVersion',a.test_version,'questionId',question->>'id','text',question->>'text');
    elsif kind='law' then
      document:=payload->>'document'; article:=payload->>'article';
      if document='state-organizations' then
        if coalesce(article,'') !~ '^point-[0-9]{1,3}(\.[0-9]{1,3}){1,4}$' then raise exception using errcode='PT400',message='Пункт правил не найден.'; end if;
      elsif not exists(select 1 from knowledge_private.law_article_refs where document_id=document and article_id=article and active) then
        raise exception using errcode='PT404',message='Статья не найдена.';
      end if;
      context:=jsonb_build_object('document',document,'article',article);
    else raise exception using errcode='PT400',message='Выберите вопрос или статью.';
    end if;
    if (select count(*) from knowledge_private.content_reports where author_id=uid and created_at>now()-interval '1 hour')>=10 then
      raise exception using errcode='PT429',message='За час можно отправить до 10 сообщений. Повторите позже.';
    end if;
    insert into knowledge_private.content_reports(id,author_id,author_login,kind,context,description)
      values(key,uid,coalesce((select login_key from knowledge_private.logins where user_id=uid),'Сотрудник'),kind,context,description);
    return jsonb_build_object('id',key);
  elsif op='review' then
    if not leader then raise exception using errcode='PT403',message='Рассмотрение доступно владельцу и заместителю.'; end if;
    key:=(payload->>'id')::uuid;
    select * into item from knowledge_private.content_reports where id=key for update;
    if not found then raise exception using errcode='PT404',message='Сообщение не найдено.'; end if;
    status:=knowledge_private.text_field(payload->'status','Статус',1,20);
    response:=knowledge_private.text_field(coalesce(payload->'response','""'::jsonb),'Ответ',0,4000);
    if jsonb_typeof(payload->'version') is distinct from 'number' or coalesce(payload->>'version','') !~ '^[0-9]{1,9}$' then raise exception using errcode='PT400',message='Обновите сообщение.'; end if;
    expected:=(payload->>'version')::integer;
    if expected<>item.version then raise exception using errcode='PT409',message='Сообщение изменилось. Обновите список.'; end if;
    if status not in ('in_review','resolved','rejected') or (status in ('resolved','rejected') and char_length(response)<10) then raise exception using errcode='PT400',message='Выберите статус и напишите ответ: минимум 10 символов.'; end if;
    update knowledge_private.content_reports set status=support_request.status,response=support_request.response,version=version+1,updated_at=now() where id=key;
    return jsonb_build_object('id',key);
  elsif op='list' then
    scope:=coalesce(payload->>'scope','mine'); status:=coalesce(payload->>'status','all');
    if scope not in ('mine','team') or status not in ('all','new','in_review','resolved','rejected') or coalesce(payload->>'offset','0') !~ '^[0-9]{1,6}$' then raise exception using errcode='PT400',message='Проверьте фильтры.'; end if;
    if scope='team' and not leader then raise exception using errcode='PT403',message='Общая очередь доступна владельцу и заместителю.'; end if;
    offset_value:=coalesce((payload->>'offset')::integer,0);
    return jsonb_build_object('total',(select count(*) from knowledge_private.content_reports r where (scope='team' or r.author_id=uid) and (support_request.status='all' or r.status=support_request.status)),
      'items',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'authorLogin',r.author_login,'kind',r.kind,'context',r.context,'description',r.description,'status',r.status,'response',r.response,'version',r.version,'createdAt',r.created_at,'updatedAt',r.updated_at) order by r.created_at desc,r.id)
      from (select * from knowledge_private.content_reports r where (scope='team' or r.author_id=uid) and (support_request.status='all' or r.status=support_request.status) order by r.created_at desc,r.id limit 20 offset offset_value) r),'[]'::jsonb));
  end if;
  raise exception using errcode='PT400',message='Неизвестное действие.';
exception when invalid_text_representation or numeric_value_out_of_range then raise exception using errcode='PT400',message='Проверьте данные формы.';
end; $$;
revoke all on function knowledge_private.support(jsonb) from public,anon,authenticated;
grant execute on function knowledge_private.support(jsonb) to authenticated;
create function public.knowledge_support(payload jsonb default '{}'::jsonb)
returns jsonb language sql security invoker set search_path='' as $$ select knowledge_private.support(payload); $$;
revoke all on function public.knowledge_support(jsonb) from public,anon,authenticated;
grant execute on function public.knowledge_support(jsonb) to authenticated;
comment on function public.knowledge_support(jsonb) is 'Account-scoped feedback and rule update read state; only owner/deputy review reports. No answer keys or account privileges are changed.';
