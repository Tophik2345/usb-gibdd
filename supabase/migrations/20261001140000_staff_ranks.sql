-- Ranks authorize promotions only; they do not grant editorial or owner permissions.
create table knowledge_private.staff_ranks (
  name text primary key,
  level smallint not null unique check(level between 1 and 16),
  rank_group text not null
);
insert into knowledge_private.staff_ranks(name,level,rank_group) values
  ('Рядовой',1,'Начальный состав'),
  ('Младший сержант',2,'Начальный состав'),
  ('Сержант',3,'Начальный состав'),
  ('Старший сержант',4,'Младший состав'),
  ('Старшина',5,'Младший состав'),
  ('Младший лейтенант',6,'Младший офицерский состав'),
  ('Лейтенант',7,'Младший офицерский состав'),
  ('Старший лейтенант',8,'Младший офицерский состав'),
  ('Капитан',9,'Младший офицерский состав'),
  ('Майор',10,'Старший офицерский состав'),
  ('Подполковник',11,'Старший офицерский состав'),
  ('Полковник',12,'Старший офицерский состав'),
  ('Генерал-майор',13,'Старший офицерский состав'),
  ('Генерал-лейтенант',14,'Высшее руководство ГИБДД'),
  ('Генерал-полковник',15,'Высшее руководство ГИБДД'),
  ('Генерал',16,'Высшее руководство ГИБДД');
alter table knowledge_private.staff_ranks enable row level security;
revoke all on knowledge_private.staff_ranks from public,anon,authenticated;

update knowledge_private.department_members set rank='Рядовой',version=version+1,updated_at=now() where rank='';
alter table knowledge_private.department_members alter column rank set default 'Рядовой';
alter table knowledge_private.department_members add constraint department_member_rank
  foreign key(rank) references knowledge_private.staff_ranks(name);

create function knowledge_private.ensure_staff_member(subject uuid)
returns void language plpgsql security definer set search_path='' as $$
declare login text; profile_name text;
begin
  select l.login_key into login from auth.users u join knowledge_private.logins l on l.user_id=u.id
    where u.id=subject and u.email_confirmed_at is not null and (u.banned_until is null or u.banned_until<=now())
    for share of u;
  if not found then raise exception using errcode='PT401',message='Войдите в аккаунт с подтверждённой почтой.'; end if;
  profile_name:=initcap(regexp_replace(login,' [0-9]+$',''));
  if char_length(profile_name)<2 then profile_name:=initcap(login); end if;
  insert into knowledge_private.department_members(user_id,display_name,static_id,rank,position)
    values(subject,profile_name,
      coalesce((regexp_match(login,' ([0-9]{1,20})$'))[1],''),'Рядовой','Сотрудник УСБ')
    on conflict(user_id) do nothing;
end; $$;

create function knowledge_private.staff_rank(subject uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object('userId',m.user_id,'rank',r.name,'rankLevel',r.level,'rankGroup',r.rank_group,'version',m.version,'active',m.active)
    from knowledge_private.department_members m join knowledge_private.staff_ranks r on r.name=m.rank where m.user_id=subject;
$$;
revoke all on function knowledge_private.ensure_staff_member(uuid),knowledge_private.staff_rank(uuid) from public,anon,authenticated;

alter function knowledge_private.workspace(jsonb) rename to workspace_before_ranks;
alter function knowledge_private.department(jsonb) rename to department_before_ranks;
revoke all on function knowledge_private.workspace_before_ranks(jsonb),knowledge_private.department_before_ranks(jsonb) from public,anon,authenticated;

create function knowledge_private.workspace(payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  perform knowledge_private.require_active_account();
  perform knowledge_private.ensure_staff_member(auth.uid());
  return knowledge_private.workspace_before_ranks(payload);
end; $$;

create function knowledge_private.department(payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  uid uuid:=auth.uid(); op text; result jsonb; target uuid; current_rank text;
  actor knowledge_private.department_members; recipient knowledge_private.department_members;
  actor_level integer; recipient_level integer; requested_level integer; requested_rank text;
  target_version integer; actor_version integer; actor_login text;
begin
  perform knowledge_private.require_active_account();
  if jsonb_typeof(payload) is distinct from 'object' or octet_length(payload::text)>80000 then
    raise exception using errcode='PT400',message='Некорректные данные.';
  end if;
  perform knowledge_private.ensure_staff_member(uid);
  op:=coalesce(payload->>'action',payload->>'op','staff');
  if op='myRank' then return knowledge_private.staff_rank(uid); end if;

  if op='promoteMember' then
    target:=nullif(payload->>'userId','')::uuid;
    requested_rank:=knowledge_private.text_field(payload->'rank','Звание',1,100);
    if target is null or coalesce(payload->>'version','') !~ '^[0-9]{1,10}$'
      or coalesce(payload->>'actorVersion','') !~ '^[0-9]{1,10}$' then
      raise exception using errcode='PT400',message='Обновите состав и выберите сотрудника для повышения.';
    end if;
    target_version:=(payload->>'version')::integer; actor_version:=(payload->>'actorVersion')::integer;
    if target=uid then raise exception using errcode='PT403',message='Нельзя повышать собственное звание.'; end if;
    perform 1 from auth.users where id=target and email_confirmed_at is not null
      and (banned_until is null or banned_until<=now()) for share;
    if not found then raise exception using errcode='PT404',message='Аккаунт сотрудника недоступен для повышения.'; end if;
    -- Lock both profiles in a deterministic order. A simultaneous promotion,
    -- archive or profile edit cannot change either rank between check and write.
    perform 1 from knowledge_private.department_members where user_id in (uid,target) order by user_id for update;
    select * into actor from knowledge_private.department_members where user_id=uid;
    select * into recipient from knowledge_private.department_members where user_id=target;
    if not found then raise exception using errcode='PT404',message='Сотрудник не найден в составе.'; end if;
    if not actor.active or not recipient.active then
      raise exception using errcode='PT403',message='Повышение доступно только сотрудникам действующего состава.';
    end if;
    if actor.version<>actor_version or recipient.version<>target_version then
      raise exception using errcode='PT409',message='Звания или карточки изменились. Обновите состав и повторите повышение.';
    end if;
    select level into actor_level from knowledge_private.staff_ranks where name=actor.rank;
    select level into recipient_level from knowledge_private.staff_ranks where name=recipient.rank;
    select level into requested_level from knowledge_private.staff_ranks where name=requested_rank;
    if requested_level is null then raise exception using errcode='PT400',message='Выберите звание из списка.'; end if;
    if recipient_level>=actor_level or requested_level>=actor_level then
      raise exception using errcode='PT403',message='Можно повышать только младших сотрудников до звания ниже своего.';
    end if;
    if requested_level<=recipient_level then
      raise exception using errcode='PT400',message='Новое звание должно быть выше текущего. Понижение здесь недоступно.';
    end if;
    update knowledge_private.department_members set rank=requested_rank,version=version+1,updated_at=now() where user_id=target;
    select login_key into actor_login from knowledge_private.logins where user_id=uid;
    insert into knowledge_private.management_events(actor_id,actor_login,area,operation,target_id,title,details)
      values(uid,actor_login,'department_members','update',target::text,recipient.display_name,
        jsonb_build_object('previousRank',recipient.rank,'rank',requested_rank,'actorRank',actor.rank,'version',recipient.version+1));
    return knowledge_private.staff_rank(target);
  end if;

  if op='saveMember' then
    target:=nullif(payload->>'userId','')::uuid;
    if target is null then
      select user_id into target from knowledge_private.logins where login_key=knowledge_private.login_key(payload->>'login');
    end if;
    -- The legacy card editor cannot bypass promotion rules, including for owners.
    select rank,version into current_rank,target_version from knowledge_private.department_members where user_id=target for update;
    current_rank:=coalesce(current_rank,'Рядовой');
    if payload ? 'rank' and payload->>'rank' is distinct from current_rank then
      if payload->>'userId' is not null and (payload->>'version')::integer is distinct from target_version then
        raise exception using errcode='PT409',message='Карточка уже изменена. Обновите состав и откройте её заново.';
      end if;
      raise exception using errcode='PT403',message='Звание меняется только через действие «Повысить в звании».';
    end if;
    payload:=payload||jsonb_build_object('rank',current_rank);
  end if;

  result:=knowledge_private.department_before_ranks(payload);
  if op in ('staff','manageStaff') then
    select * into actor from knowledge_private.department_members where user_id=uid;
    select level into actor_level from knowledge_private.staff_ranks where name=actor.rank;
    return result||jsonb_build_object('viewer',knowledge_private.staff_rank(uid),'members',coalesce((
      select jsonb_agg(item||jsonb_build_object('rankLevel',r.level,'rankGroup',r.rank_group,'promotionRanks',
        case when actor.active and m.active and m.user_id<>uid and r.level<actor_level
          and u.email_confirmed_at is not null and (u.banned_until is null or u.banned_until<=now())
        then coalesce((select jsonb_agg(jsonb_build_object('name',option.name,'level',option.level,'group',option.rank_group) order by option.level)
          from knowledge_private.staff_ranks option where option.level>r.level and option.level<actor_level),'[]'::jsonb)
        else '[]'::jsonb end) order by m.sort_order,m.display_name,m.user_id)
      from jsonb_array_elements(result->'members') item
      join knowledge_private.department_members m on m.user_id=(item->>'userId')::uuid
      join knowledge_private.staff_ranks r on r.name=m.rank join auth.users u on u.id=m.user_id),'[]'::jsonb));
  end if;
  return result;
exception when invalid_text_representation or numeric_value_out_of_range then
  raise exception using errcode='PT400',message='Проверьте данные формы.';
end; $$;

revoke all on function knowledge_private.workspace(jsonb),knowledge_private.department(jsonb) from public,anon,authenticated;
grant execute on function knowledge_private.workspace(jsonb),knowledge_private.department(jsonb) to authenticated;
create or replace function public.knowledge_workspace(payload jsonb default '{}'::jsonb)
returns jsonb language sql security invoker set search_path='' as $$ select knowledge_private.workspace(payload); $$;
create or replace function public.knowledge_department(payload jsonb default '{}'::jsonb)
returns jsonb language sql security invoker set search_path='' as $$ select knowledge_private.department(payload); $$;
comment on function public.knowledge_department(jsonb) is 'Rank hierarchy 20261001140000';
