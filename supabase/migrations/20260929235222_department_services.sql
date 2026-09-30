-- Service profiles contain roleplay information only. Roster positions never grant privileges.
create table knowledge_private.department_members (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check(char_length(display_name) between 2 and 100),
  static_id text not null default '' check(static_id='' or static_id ~ '^[0-9]{1,20}$'),
  rank text not null default '' check(char_length(rank)<=100),
  position text not null check(char_length(position) between 2 and 100),
  bio text not null default '' check(char_length(bio)<=1500),
  active boolean not null default true,
  sort_order integer not null default 100 check(sort_order between 0 and 1000),
  version integer not null default 1,
  updated_at timestamptz not null default now()
);
create table knowledge_private.department_appeals (
  id uuid primary key,
  author_id uuid not null references auth.users(id) on delete cascade,
  author_login text not null,
  kind text not null check(kind in ('complaint','question','proposal')),
  subject text not null check(char_length(subject) between 5 and 160),
  body text not null check(char_length(body) between 30 and 12000),
  evidence jsonb not null default '[]'::jsonb check(jsonb_typeof(evidence)='array' and jsonb_array_length(evidence)<=5),
  status text not null default 'new' check(status in ('new','in_review','resolved','rejected')),
  response text not null default '' check(char_length(response)<=6000),
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index department_appeals_author on knowledge_private.department_appeals(author_id,created_at desc,id);
create index department_appeals_queue on knowledge_private.department_appeals(status,created_at desc,id);
create table knowledge_private.department_appeal_events (
  id uuid primary key default gen_random_uuid(),
  appeal_id uuid not null references knowledge_private.department_appeals(id) on delete cascade,
  actor_login text not null,
  status text not null check(status in ('new','in_review','resolved','rejected')),
  response text not null default '',
  version integer not null,
  created_at timestamptz not null default now(),
  unique(appeal_id,version)
);
alter table knowledge_private.department_members enable row level security;
alter table knowledge_private.department_appeals enable row level security;
alter table knowledge_private.department_appeal_events enable row level security;
revoke all on knowledge_private.department_members,knowledge_private.department_appeals,knowledge_private.department_appeal_events from public,anon,authenticated;

-- Populate only the existing, confirmed leadership accounts. Do not invent ranks.
insert into knowledge_private.department_members(user_id,display_name,static_id,position,sort_order)
select c.user_id,initcap(regexp_replace(l.login_key,' [0-9]+$','')),
  coalesce((regexp_match(l.login_key,' ([0-9]+)$'))[1],''),
  case when c.role='owner' then 'Владелец сайта' else 'Заместитель' end,
  case when c.role='owner' then 0 else 10 end
from knowledge_private.test_creators c join knowledge_private.logins l on l.user_id=c.user_id
join auth.users u on u.id=c.user_id
where c.role in ('owner','deputy') and u.email_confirmed_at is not null
on conflict(user_id) do nothing;

create function knowledge_private.department(payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_uid uuid := auth.uid(); v_role text; v_manager boolean; v_login text;
  v_op text; v_id uuid; v_target uuid; v_version integer; v_offset integer;
  v_name text; v_static text; v_rank text; v_position text; v_bio text; v_order integer; v_active boolean;
  v_kind text; v_subject text; v_body text; v_status text; v_response text; v_scope text;
  v_evidence jsonb; v_item jsonb; v_url text; v_count integer;
  v_member knowledge_private.department_members; v_appeal knowledge_private.department_appeals;
begin
  if jsonb_typeof(payload) is distinct from 'object' or octet_length(payload::text)>80000 then
    raise exception using errcode='PT400',message='Некорректные данные.';
  end if;
  if v_uid is null or not exists(select 1 from auth.users where id=v_uid and email_confirmed_at is not null) then
    raise exception using errcode='PT401',message='Войдите в аккаунт с подтверждённой почтой.';
  end if;
  select login_key into v_login from knowledge_private.logins where user_id=v_uid;
  select role into v_role from knowledge_private.test_creators where user_id=v_uid for share;
  v_manager:=coalesce(v_role in ('owner','deputy'),false);
  v_op:=coalesce(payload->>'action',payload->>'op','staff');
  if v_op in ('manageStaff','saveMember','reviewAppeal') and not v_manager then
    raise exception using errcode='PT403',message='Это действие доступно владельцу и заместителю.';
  end if;

  if v_op='saveMember' then
    v_id:=nullif(payload->>'userId','')::uuid;
    if v_id is null then
      select l.user_id into v_target from knowledge_private.logins l join auth.users u on u.id=l.user_id
        where l.login_key=knowledge_private.login_key(payload->>'login') and u.email_confirmed_at is not null;
      if v_target is null then raise exception using errcode='PT404',message='Аккаунт с подтверждённой почтой и таким логином не найден.'; end if;
    else
      v_target:=v_id;
    end if;
    v_name:=knowledge_private.text_field(payload->'displayName','Имя сотрудника',2,100);
    v_static:=knowledge_private.text_field(coalesce(payload->'staticId','""'::jsonb),'Статик',0,20);
    if v_static<>'' and v_static !~ '^[0-9]{1,20}$' then raise exception using errcode='PT400',message='Статик должен содержать только цифры.'; end if;
    v_rank:=knowledge_private.text_field(coalesce(payload->'rank','""'::jsonb),'Звание',0,100);
    v_position:=knowledge_private.text_field(payload->'position','Должность',2,100);
    v_bio:=knowledge_private.text_field(coalesce(payload->'bio','""'::jsonb),'О сотруднике',0,1500);
    if jsonb_typeof(payload->'active') is distinct from 'boolean' or coalesce(payload->>'sortOrder','') !~ '^[0-9]{1,4}$' then
      raise exception using errcode='PT400',message='Проверьте статус и порядок сотрудника.';
    end if;
    v_active:=(payload->>'active')::boolean; v_order:=(payload->>'sortOrder')::integer;
    if v_order>1000 then raise exception using errcode='PT400',message='Порядок должен быть от 0 до 1000.'; end if;
    if v_id is null then
      insert into knowledge_private.department_members(user_id,display_name,static_id,rank,position,bio,active,sort_order)
        values(v_target,v_name,v_static,v_rank,v_position,v_bio,v_active,v_order)
        on conflict(user_id) do nothing returning * into v_member;
      if not found then raise exception using errcode='PT409',message='Сотрудник уже добавлен. Откройте его карточку в управлении составом.'; end if;
    else
      v_version:=(payload->>'version')::integer;
      update knowledge_private.department_members set display_name=v_name,static_id=v_static,rank=v_rank,position=v_position,
        bio=v_bio,active=v_active,sort_order=v_order,version=version+1,updated_at=now()
        where user_id=v_target and version=v_version returning * into v_member;
      if not found then raise exception using errcode='PT409',message='Карточка уже изменена. Обновите список и откройте её заново.'; end if;
    end if;
    return jsonb_build_object('userId',v_target,'version',v_member.version);
  end if;
  if v_op in ('staff','manageStaff') then
    return jsonb_build_object('members',coalesce((select jsonb_agg(jsonb_build_object(
      'userId',user_id,'displayName',display_name,'staticId',static_id,'rank',rank,'position',position,
      'bio',bio,'active',active,'sortOrder',sort_order,'version',version,'updatedAt',updated_at)
      order by sort_order,display_name,user_id) from knowledge_private.department_members
      where active or v_op='manageStaff'),'[]'::jsonb));
  end if;

  if v_op='createAppeal' then
    v_id:=(payload->>'id')::uuid;
    if v_id is null then raise exception using errcode='PT400',message='Обновите форму обращения.'; end if;
    -- Serialize this user's submissions to make retries idempotent and limits atomic.
    perform pg_advisory_xact_lock(hashtextextended(v_uid::text,55));
    select * into v_appeal from knowledge_private.department_appeals where id=v_id;
    if found then
      if v_appeal.author_id<>v_uid then raise exception using errcode='PT404',message='Обращение не найдено.'; end if;
      return jsonb_build_object('id',v_id);
    end if;
    v_kind:=knowledge_private.text_field(payload->'kind','Тип обращения',1,20);
    if v_kind not in ('complaint','question','proposal') then raise exception using errcode='PT400',message='Выберите тип обращения.'; end if;
    v_subject:=knowledge_private.text_field(payload->'subject','Тема',5,160);
    v_body:=knowledge_private.text_field(payload->'body','Описание',30,12000);
    v_evidence:=coalesce(payload->'evidence','[]'::jsonb);
    if jsonb_typeof(v_evidence) is distinct from 'array' then raise exception using errcode='PT400',message='Доказательства должны быть списком ссылок.'; end if;
    if jsonb_array_length(v_evidence)>5 or (v_kind='complaint' and jsonb_array_length(v_evidence)=0) then
      raise exception using errcode='PT400',message='Для жалобы нужна хотя бы одна ссылка на доказательства. Максимум — пять ссылок.';
    end if;
    for v_item in select value from jsonb_array_elements(v_evidence) loop
      v_url:=knowledge_private.text_field(v_item,'Ссылка',8,1500);
      if v_url !~ '^https://[A-Za-z0-9.-]+\.[A-Za-z]{2,}(:[0-9]{1,5})?([/?#][^[:space:]<>\\]*)?$'
        or v_url ~ '[[:cntrl:]]' or (regexp_match(v_url,'^https://[^/?#]+:([0-9]+)'))[1]::integer not between 1 and 65535 then
        raise exception using errcode='PT400',message='Укажите полный адрес HTTPS без пробелов, логина и пароля в ссылке.';
      end if;
    end loop;
    select count(*) into v_count from knowledge_private.department_appeals where author_id=v_uid and created_at>now()-interval '1 hour';
    if v_count>=10 then raise exception using errcode='PT429',message='За час можно отправить до 10 обращений. Повторите позже.'; end if;
    insert into knowledge_private.department_appeals(id,author_id,author_login,kind,subject,body,evidence)
      values(v_id,v_uid,v_login,v_kind,v_subject,v_body,v_evidence);
    insert into knowledge_private.department_appeal_events(appeal_id,actor_login,status,version) values(v_id,v_login,'new',1);
    return jsonb_build_object('id',v_id);
  end if;
  if v_op='appeals' then
    v_scope:=coalesce(payload->>'scope','mine'); v_status:=coalesce(payload->>'status','all');
    if v_scope not in ('mine','team') or v_status not in ('all','new','in_review','resolved','rejected') then
      raise exception using errcode='PT400',message='Проверьте фильтры обращений.';
    end if;
    if v_scope='team' and not v_manager then raise exception using errcode='PT403',message='Общая очередь доступна владельцу и заместителю.'; end if;
    if coalesce(payload->>'offset','0') !~ '^[0-9]{1,6}$' then raise exception using errcode='PT400',message='Некорректная страница.'; end if;
    v_offset:=coalesce((payload->>'offset')::integer,0);
    return jsonb_build_object('total',(select count(*) from knowledge_private.department_appeals where (v_scope='team' or author_id=v_uid) and (v_status='all' or status=v_status)),
      'appeals',coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'subject',a.subject,'kind',a.kind,'status',a.status,
        'authorLogin',a.author_login,'createdAt',a.created_at,'updatedAt',a.updated_at) order by a.created_at desc,a.id)
        from (select * from knowledge_private.department_appeals where (v_scope='team' or author_id=v_uid) and (v_status='all' or status=v_status)
          order by created_at desc,id limit 20 offset v_offset) a),'[]'::jsonb));
  end if;
  if v_op in ('appeal','reviewAppeal') then
    v_id:=(payload->>'id')::uuid;
    select * into v_appeal from knowledge_private.department_appeals where id=v_id and (author_id=v_uid or v_manager) for update;
    if not found then raise exception using errcode='PT404',message='Обращение не найдено.'; end if;
    if v_op='reviewAppeal' then
      v_status:=knowledge_private.text_field(payload->'status','Статус',1,20);
      v_response:=knowledge_private.text_field(coalesce(payload->'response','""'::jsonb),'Ответ',0,6000);
      v_version:=(payload->>'version')::integer;
      if v_version is distinct from v_appeal.version then raise exception using errcode='PT409',message='Обращение уже изменено. Обновите его перед сохранением.'; end if;
      if v_status not in ('in_review','resolved','rejected') or (v_appeal.status in ('resolved','rejected') and v_status<>'in_review') then
        raise exception using errcode='PT400',message='Закрытое обращение сначала нужно вернуть на рассмотрение.';
      end if;
      if v_status in ('resolved','rejected') and char_length(v_response)<10 then raise exception using errcode='PT400',message='Напишите обоснованный ответ: минимум 10 символов.'; end if;
      update knowledge_private.department_appeals set status=v_status,response=v_response,version=version+1,updated_at=now() where id=v_id returning * into v_appeal;
      insert into knowledge_private.department_appeal_events(appeal_id,actor_login,status,response,version)
        values(v_id,v_login,v_status,v_response,v_appeal.version);
    end if;
    return jsonb_build_object('id',v_appeal.id,'authorLogin',v_appeal.author_login,'kind',v_appeal.kind,'subject',v_appeal.subject,
      'body',v_appeal.body,'evidence',v_appeal.evidence,'status',v_appeal.status,'response',v_appeal.response,'version',v_appeal.version,
      'createdAt',v_appeal.created_at,'updatedAt',v_appeal.updated_at,
      'history',coalesce((select jsonb_agg(jsonb_build_object('status',status,'response',response,'actorLogin',actor_login,'createdAt',created_at,'version',version) order by version)
        from knowledge_private.department_appeal_events where appeal_id=v_id),'[]'::jsonb));
  end if;
  raise exception using errcode='PT400',message='Неизвестная операция.';
exception when invalid_text_representation or numeric_value_out_of_range then
  raise exception using errcode='PT400',message='Проверьте данные формы.';
end;
$$;
revoke all on function knowledge_private.department(jsonb) from public,anon,authenticated;
grant execute on function knowledge_private.department(jsonb) to authenticated;
create function public.knowledge_department(payload jsonb default '{}'::jsonb)
returns jsonb language sql security invoker set search_path='' as $$ select knowledge_private.department(payload) $$;
revoke all on function public.knowledge_department(jsonb) from public,anon,authenticated;
grant execute on function public.knowledge_department(jsonb) to authenticated;
comment on function public.knowledge_department(jsonb) is 'Confirmed accounts see active roleplay profiles and their own appeals. Only live owner/deputy roles manage staff and review all appeals. No email addresses or private test results are returned.';
