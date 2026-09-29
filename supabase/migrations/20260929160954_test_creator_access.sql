-- Fail closed: account registration, a display name and JWT metadata never grant authorship.
-- The initial owner is assigned separately to a verified account, not inferred by this migration.
create table knowledge_private.test_creators (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('owner','author')),
  granted_by uuid references auth.users(id) on delete set null,
  granted_at timestamptz not null default now()
);
alter table knowledge_private.test_creators enable row level security;
revoke all on knowledge_private.test_creators from public, anon, authenticated;

alter function knowledge_private.workspace(jsonb) rename to workspace_core;
revoke all on function knowledge_private.workspace_core(jsonb) from public, anon, authenticated;

create function knowledge_private.workspace(payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  operation text;
  member_role text;
  target_id uuid;
  target_role text;
  login_name text;
  result jsonb;
begin
  if uid is null then raise exception using errcode='PT401',message='Войдите в аккаунт, чтобы продолжить.'; end if;
  if jsonb_typeof(payload) is distinct from 'object' or octet_length(payload::text)>200000 then
    raise exception using errcode='PT400',message='Некорректные данные.';
  end if;
  operation := coalesce(payload->>'action',payload->>'op','workspace');
  -- Lock an existing grant for this request: revocation takes effect for subsequent requests.
  select role into member_role from knowledge_private.test_creators where user_id=uid for share;

  if operation in ('creatorAccess','grantCreator','revokeCreator') then
    if member_role is distinct from 'owner' then
      raise exception using errcode='PT403',message='Управлять списком авторов может только владелец сайта.';
    end if;
    if operation='grantCreator' then
      login_name := knowledge_private.login_key(knowledge_private.text_field(payload->'login','Логин',2,100));
      select l.user_id into target_id from knowledge_private.logins l
        join auth.users u on u.id=l.user_id
        where l.login_key=login_name and u.email_confirmed_at is not null;
      if target_id is null then
        raise exception using errcode='PT404',message='Пользователь не найден или ещё не подтвердил почту. Проверьте логин.';
      end if;
      insert into knowledge_private.test_creators(user_id,role,granted_by)
        values(target_id,'author',uid) on conflict(user_id) do nothing;
    elsif operation='revokeCreator' then
      target_id := (payload->>'userId')::uuid;
      if target_id is null then raise exception using errcode='PT400',message='Выберите пользователя.'; end if;
      select role into target_role from knowledge_private.test_creators where user_id=target_id for update;
      if target_role='owner' then
        raise exception using errcode='PT403',message='Владельца сайта нельзя удалить из списка авторов.';
      end if;
      delete from knowledge_private.test_creators where user_id=target_id and role='author';
    end if;
    return jsonb_build_object('creators',coalesce((
      select jsonb_agg(jsonb_build_object('userId',c.user_id,'login',l.login_key,
        'role',c.role,'grantedAt',c.granted_at) order by c.role desc,c.granted_at)
      from knowledge_private.test_creators c join knowledge_private.logins l on l.user_id=c.user_id
    ),'[]'::jsonb));
  end if;

  if operation in ('saveTest','test') and member_role is null then
    raise exception using errcode='PT403',message='Создавать и редактировать тесты могут только авторы, добавленные владельцем сайта.';
  end if;
  result := knowledge_private.workspace_core(payload);
  if operation='workspace' then
    result := result || jsonb_build_object('permissions',jsonb_build_object(
      'canCreateTests',member_role is not null,'canManageCreators',coalesce(member_role='owner',false)));
    if member_role is null then result := result || jsonb_build_object('managed','[]'::jsonb); end if;
  end if;
  return result;
exception when invalid_text_representation then
  raise exception using errcode='PT400',message='Некорректный идентификатор пользователя.';
end;
$$;
revoke all on function knowledge_private.workspace(jsonb) from public, anon, authenticated;
grant execute on function knowledge_private.workspace(jsonb) to authenticated;
-- Explicitly replace the public wrapper so no cached dependency can call the old core.
create or replace function public.knowledge_workspace(payload jsonb default '{}'::jsonb)
returns jsonb language sql security invoker set search_path = '' as $$
  select knowledge_private.workspace(payload);
$$;
revoke all on function public.knowledge_workspace(jsonb) from public, anon, authenticated;
grant execute on function public.knowledge_workspace(jsonb) to authenticated;
