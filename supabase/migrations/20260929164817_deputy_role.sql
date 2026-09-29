-- Deputy has authorship only; owner-only delegation and per-test ownership remain enforced.
alter table knowledge_private.test_creators drop constraint test_creators_role_check;
alter table knowledge_private.test_creators add constraint test_creators_role_check check (role in ('owner','deputy','author'));

create or replace function knowledge_private.workspace(payload jsonb default '{}'::jsonb)
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
      delete from knowledge_private.test_creators where user_id=target_id and role in ('author','deputy');
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
    result := result || jsonb_build_object('role',coalesce(member_role,'employee'),'permissions',jsonb_build_object(
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
