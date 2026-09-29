-- Usernames are immutable identifiers. User-editable metadata is only read at signup.
create table knowledge_private.logins (
  login_key text primary key check (char_length(login_key) between 2 and 100),
  user_id uuid not null unique references auth.users(id) on delete cascade
);
create table knowledge_private.login_limits (
  bucket text primary key,
  expires_at timestamptz not null,
  attempts integer not null
);
alter table knowledge_private.logins enable row level security;
alter table knowledge_private.login_limits enable row level security;
revoke all on knowledge_private.logins, knowledge_private.login_limits from public, anon, authenticated;

create function knowledge_private.login_key(value text) returns text
language sql immutable strict set search_path = ''
as $$ select lower(btrim(regexp_replace(value, '\s+', ' ', 'g'))) $$;
revoke all on function knowledge_private.login_key(text) from public, anon, authenticated;

-- Preserve existing users, passwords, sessions and test results.
insert into knowledge_private.logins(login_key,user_id)
select knowledge_private.login_key(coalesce(nullif(raw_user_meta_data->>'login',''),nullif(raw_user_meta_data->>'full_name',''),split_part(email,'@',1))),id
from auth.users;

-- Signup has no authenticated uid yet. This trigger is not a callable user API.
create function knowledge_private.register_login() returns trigger
language plpgsql security definer set search_path = '' as $$
declare name text;
begin
  name := knowledge_private.login_key(new.raw_user_meta_data->>'login');
  -- Keep the previous client working during deployment, using its name field.
  if name is null then name := knowledge_private.login_key(new.raw_user_meta_data->>'full_name'); end if;
  if name is null or char_length(name) not between 2 and 100 then
    raise exception 'Login must contain 2 to 100 characters' using errcode='23514';
  end if;
  insert into knowledge_private.logins(login_key,user_id) values(name,new.id);
  return new;
end;
$$;
revoke all on function knowledge_private.register_login() from public, anon, authenticated;
create trigger register_username after insert on auth.users
for each row execute function knowledge_private.register_login();

-- Only the password-login Edge Function may resolve a login to an email.
-- Atomic, expiring counters apply even to unknown usernames. No client IP is trusted.
create function knowledge_private.resolve_login(value text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare key text; n integer; email_address text;
begin
  if coalesce(auth.jwt()->>'role','') <> 'service_role' then
    raise exception 'Forbidden' using errcode='42501';
  end if;
  key := knowledge_private.login_key(value);
  if key is null or char_length(key) not between 2 and 100 then
    return jsonb_build_object('allowed',false);
  end if;
  delete from knowledge_private.login_limits where expires_at < now();
  insert into knowledge_private.login_limits as limits(bucket,expires_at,attempts)
    values('global',now()+interval '1 minute',1)
    on conflict(bucket) do update set attempts=limits.attempts+1
    returning attempts into n;
  if n > 120 then return jsonb_build_object('allowed',false); end if;
  insert into knowledge_private.login_limits as limits(bucket,expires_at,attempts)
    values('login:'||key,now()+interval '15 minutes',1)
    on conflict(bucket) do update set attempts=limits.attempts+1
    returning attempts into n;
  if n > 10 then return jsonb_build_object('allowed',false); end if;
  select u.email into email_address from knowledge_private.logins l
    join auth.users u on u.id=l.user_id where l.login_key=key;
  return jsonb_build_object('allowed',true,'email',email_address);
end;
$$;
revoke all on function knowledge_private.resolve_login(text) from public, anon, authenticated;
grant usage on schema knowledge_private to service_role;
grant execute on function knowledge_private.resolve_login(text) to service_role;
create function public.resolve_username_login(value text) returns jsonb
language sql security invoker set search_path = ''
as $$ select knowledge_private.resolve_login(value) $$;
revoke all on function public.resolve_username_login(text) from public, anon, authenticated;
grant execute on function public.resolve_username_login(text) to service_role;
