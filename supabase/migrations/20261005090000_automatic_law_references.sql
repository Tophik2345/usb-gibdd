-- Keep bookmark identities when official articles are edited or removed.
alter table knowledge_private.law_article_refs add column active boolean not null default true;

create function public.sync_law_article_references(refs jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  if coalesce(auth.jwt()->>'role','')<>'service_role' then raise exception using errcode='42501',message='Синхронизация доступна только серверу.'; end if;
  if jsonb_typeof(refs) is distinct from 'array' then raise exception using errcode='PT400',message='Некорректные ссылки законов.'; end if;
  if jsonb_array_length(refs)<500 or jsonb_array_length(refs)>5000 or octet_length(refs::text)>400000 then
    raise exception using errcode='PT400',message='Неполный список статей.';
  end if;
  if exists(select 1 from jsonb_array_elements(refs) item where jsonb_typeof(item) is distinct from 'object'
    or coalesce(item->>'document','') not in ('charter','criminal','labour','procedure','police','traffic-police','administrative','traffic-rules')
    or coalesce(item->>'article','') !~ '^article-[1-9][0-9]{0,7}$')
    or (select count(distinct item->>'document') from jsonb_array_elements(refs) item)<>8
    or (select count(distinct (item->>'document',item->>'article')) from jsonb_array_elements(refs) item)<>jsonb_array_length(refs) then
    raise exception using errcode='PT400',message='Некорректные или повторяющиеся ссылки законов.';
  end if;
  update knowledge_private.law_article_refs set active=false where active;
  insert into knowledge_private.law_article_refs(document_id,article_id,active)
    select item->>'document',item->>'article',true from jsonb_array_elements(refs) item
    on conflict(document_id,article_id) do update set active=true;
  return jsonb_build_object('activeReferences',jsonb_array_length(refs));
end; $$;
revoke all on function public.sync_law_article_references(jsonb) from public,anon,authenticated;
grant execute on function public.sync_law_article_references(jsonb) to service_role;

create or replace function knowledge_private.portal(payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  perform knowledge_private.require_active_account(false);
  if auth.uid() is not null and coalesce(payload->>'action',payload->>'op')='setBookmark' and payload->'saved'='true'::jsonb
    and not exists(select 1 from knowledge_private.law_article_refs where document_id=payload->>'document' and article_id=payload->>'article' and active) then
    raise exception using errcode='PT404',message='Статья не найдена в текущей редакции.';
  end if;
  return knowledge_private.portal_before_accounts(payload);
end; $$;
