-- Incremental account management; installing this migration does not change any account.
-- Every protected RPC checks the live Auth row, so a blocked/deleted user's old JWT
-- cannot keep accessing private records until token expiry.
create function knowledge_private.require_active_account(required boolean default true)
returns void language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); ban timestamptz;
begin
  if uid is null then
    if required then raise exception using errcode='PT401',message='Войдите в аккаунт, чтобы продолжить.'; end if;
    return;
  end if;
  select banned_until into ban from auth.users where id=uid for share;
  if not found then raise exception using errcode='PT401',message='Аккаунт больше не существует. Войдите заново.'; end if;
  if ban>now() then raise exception using errcode='PT403',message='Аккаунт заблокирован. Обратитесь к владельцу сайта.'; end if;
end; $$;
revoke all on function knowledge_private.require_active_account(boolean) from public,anon,authenticated;

alter function knowledge_private.workspace(jsonb) rename to workspace_before_accounts;
alter function knowledge_private.portal(jsonb) rename to portal_before_accounts;
alter function knowledge_private.department(jsonb) rename to department_before_accounts;
alter function knowledge_private.training(jsonb) rename to training_before_accounts;
revoke all on function knowledge_private.workspace_before_accounts(jsonb),knowledge_private.portal_before_accounts(jsonb),knowledge_private.department_before_accounts(jsonb),knowledge_private.training_before_accounts(jsonb) from public,anon,authenticated;
create function knowledge_private.workspace(payload jsonb default '{}'::jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
begin perform knowledge_private.require_active_account(); return knowledge_private.workspace_before_accounts(payload); end; $$;
create function knowledge_private.portal(payload jsonb default '{}'::jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
begin perform knowledge_private.require_active_account(false); return knowledge_private.portal_before_accounts(payload); end; $$;
create function knowledge_private.department(payload jsonb default '{}'::jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
begin perform knowledge_private.require_active_account(); return knowledge_private.department_before_accounts(payload); end; $$;
create function knowledge_private.training(payload jsonb default '{}'::jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
begin perform knowledge_private.require_active_account(); return knowledge_private.training_before_accounts(payload); end; $$;
revoke all on function knowledge_private.workspace(jsonb),knowledge_private.portal(jsonb),knowledge_private.department(jsonb),knowledge_private.training(jsonb) from public,anon,authenticated;
grant execute on function knowledge_private.workspace(jsonb),knowledge_private.department(jsonb),knowledge_private.training(jsonb) to authenticated;
grant execute on function knowledge_private.portal(jsonb) to anon,authenticated;
-- Rebind SQL wrappers after renaming their implementations.
create or replace function public.knowledge_workspace(payload jsonb default '{}'::jsonb) returns jsonb language sql security invoker set search_path='' as $$ select knowledge_private.workspace(payload); $$;
create or replace function public.knowledge_portal(payload jsonb default '{}'::jsonb) returns jsonb language sql security invoker set search_path='' as $$ select knowledge_private.portal(payload); $$;
create or replace function public.knowledge_department(payload jsonb default '{}'::jsonb) returns jsonb language sql security invoker set search_path='' as $$ select knowledge_private.department(payload); $$;
create or replace function public.knowledge_training(payload jsonb default '{}'::jsonb) returns jsonb language sql security invoker set search_path='' as $$ select knowledge_private.training(payload); $$;

create function knowledge_private.accounts(payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); member_role text; op text; target uuid; target_role text; target_login text;
  q text; page integer; rows jsonb; total bigint; authored bigint; results bigint; has_objects boolean;
begin
  perform knowledge_private.require_active_account();
  if not exists(select 1 from auth.users where id=uid and email_confirmed_at is not null) then raise exception using errcode='PT403',message='Сначала подтвердите почту.'; end if;
  select role into member_role from knowledge_private.test_creators where user_id=uid for share;
  if member_role is distinct from 'owner' then raise exception using errcode='PT403',message='Управлять аккаунтами может только владелец сайта.'; end if;
  if jsonb_typeof(payload) is distinct from 'object' or octet_length(payload::text)>2048 then raise exception using errcode='PT400',message='Некорректные данные.'; end if;
  op:=coalesce(payload->>'action','list');
  if op='list' then
    q:=lower(btrim(coalesce(payload->>'search','')));
    if char_length(q)>100 then raise exception using errcode='PT400',message='Поиск: не более 100 символов.'; end if;
    page:=coalesce((payload->>'page')::integer,0);
    if page<0 or page>100000 then raise exception using errcode='PT400',message='Некорректная страница.'; end if;
    select count(*) into total from auth.users u left join knowledge_private.logins l on l.user_id=u.id
      where q='' or strpos(l.login_key,q)>0 or strpos(lower(u.email),q)>0;
    select coalesce(jsonb_agg(item order by login,id),'[]'::jsonb) into rows from (
      select l.login_key login,u.id, jsonb_build_object('userId',u.id,'login',coalesce(l.login_key,'Без логина'),'email',u.email,
        'role',coalesce(c.role,'employee'),'confirmed',u.email_confirmed_at is not null,'createdAt',u.created_at,
        'blocked',coalesce(u.banned_until>now(),false),'protected',u.id=uid or coalesce(c.role in ('owner','deputy'),false),
        'authoredTests',(select count(*) from knowledge_private.tests t where t.owner_id=u.id),
        'results',(select count(*) from knowledge_private.attempts a where a.user_id=u.id)) item
      from auth.users u left join knowledge_private.logins l on l.user_id=u.id left join knowledge_private.test_creators c on c.user_id=u.id
      where q='' or strpos(l.login_key,q)>0 or strpos(lower(u.email),q)>0
      order by l.login_key nulls last,u.id limit 25 offset page*25
    ) items;
    return jsonb_build_object('accounts',rows,'total',total,'page',page,'pageSize',25);
  end if;
  if op not in ('block','unblock','delete') then raise exception using errcode='PT400',message='Неизвестная операция.'; end if;
  target:=(payload->>'userId')::uuid;
  if target is null then raise exception using errcode='PT400',message='Выберите аккаунт.'; end if;
  -- Serialize account actions and FK inserts (including authorship grants) for this UUID.
  perform 1 from auth.users where id=target for update;
  if not found then raise exception using errcode='PT404',message='Аккаунт не найден. Обновите список.'; end if;
  select role into target_role from knowledge_private.test_creators where user_id=target for share;
  if target=uid or target_role in ('owner','deputy') then raise exception using errcode='PT403',message='Владельца, заместителя и свой аккаунт нельзя блокировать или удалять.'; end if;
  select login_key into target_login from knowledge_private.logins where user_id=target;
  select count(*) into authored from knowledge_private.tests where owner_id=target;
  select count(*) into results from knowledge_private.attempts where user_id=target;
  if op='delete' then
    if authored>0 then raise exception using errcode='PT409',message='У аккаунта есть авторские тесты. Используйте блокировку, чтобы сохранить тесты и чужие результаты.'; end if;
    -- Match Auth Admin's protection of accounts owning Storage objects. Do not orphan uploads.
    if to_regclass('storage.objects') is not null then
      execute 'select exists(select 1 from storage.objects where owner_id=$1)' into has_objects using target::text;
      if has_objects then raise exception using errcode='PT409',message='У аккаунта есть загруженные файлы. Используйте блокировку.'; end if;
    end if;
  end if;
  insert into knowledge_private.management_events(actor_id,actor_login,area,operation,target_id,title,details)
    values(uid,(select login_key from knowledge_private.logins where user_id=uid),'accounts',op,target::text,coalesce(target_login,'Без логина'),jsonb_build_object('results',results));
  if op='delete' then
    -- The existing FK constraints remove only this account's own records and sessions.
    delete from auth.users where id=target;
  else
    update auth.users set banned_until=case when op='block' then now()+interval '100 years' else null end where id=target;
    if op='block' and to_regclass('auth.sessions') is not null then
      execute 'delete from auth.sessions where user_id=$1' using target;
    end if;
  end if;
  return jsonb_build_object('success',true);
exception when invalid_text_representation or numeric_value_out_of_range then raise exception using errcode='PT400',message='Проверьте выбранный аккаунт и страницу.';
end; $$;
revoke all on function knowledge_private.accounts(jsonb) from public,anon,authenticated;
grant execute on function knowledge_private.accounts(jsonb) to authenticated;
create function public.knowledge_accounts(payload jsonb default '{}'::jsonb) returns jsonb language sql security invoker set search_path='' as $$ select knowledge_private.accounts(payload); $$;
revoke all on function public.knowledge_accounts(jsonb) from public,anon,authenticated;
grant execute on function public.knowledge_accounts(jsonb) to authenticated;
comment on function public.knowledge_accounts(jsonb) is 'Account management 20261001110000';

-- Public username availability exposes one boolean, never account IDs, email or roles.
-- Independent counters prevent this check from consuming password-login attempts.
create function knowledge_private.signup_check(payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare name text; n integer;
begin
  if jsonb_typeof(payload) is distinct from 'object' or octet_length(payload::text)>2048 then raise exception using errcode='PT400',message='Некорректный логин.'; end if;
  name:=knowledge_private.login_key(payload->>'login');
  if name is null or char_length(name) not between 2 and 100 then raise exception using errcode='PT400',message='Логин: от 2 до 100 символов.'; end if;
  delete from knowledge_private.login_limits where expires_at<now();
  insert into knowledge_private.login_limits as limits(bucket,expires_at,attempts) values('signup-check-global',now()+interval '1 minute',1)
    on conflict(bucket) do update set attempts=limits.attempts+1 returning attempts into n;
  if n>120 then return jsonb_build_object('limited',true); end if;
  return jsonb_build_object('available',not exists(select 1 from knowledge_private.logins where login_key=name));
end; $$;
revoke all on function knowledge_private.signup_check(jsonb) from public,anon,authenticated;
grant execute on function knowledge_private.signup_check(jsonb) to anon,authenticated;
create function public.knowledge_signup_check(payload jsonb) returns jsonb language sql security invoker set search_path='' as $$ select knowledge_private.signup_check(payload); $$;
revoke all on function public.knowledge_signup_check(jsonb) from public,anon,authenticated;
grant execute on function public.knowledge_signup_check(jsonb) to anon,authenticated;
notify pgrst,'reload schema';
