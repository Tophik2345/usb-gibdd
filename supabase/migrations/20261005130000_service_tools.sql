-- Operational records remain private; only explicitly published photographs are public.
create table knowledge_private.service_photos (
  id uuid primary key, author_id uuid not null references auth.users(id) on delete cascade,
  path text not null unique, title text not null, caption text not null default '',
  width integer not null check(width between 1 and 12000), height integer not null check(height between 1 and 12000),
  status text not null default 'draft' check(status in ('draft','published','archived')),
  version integer not null default 1, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table knowledge_private.service_map (
  id boolean primary key default true check(id), pins jsonb not null default '[]', routes jsonb not null default '[]',
  version integer not null default 1, updated_at timestamptz not null default now()
);
insert into knowledge_private.service_map(id) values(true);
create table knowledge_private.service_checklist_catalog(id text primary key, steps text[] not null);
insert into knowledge_private.service_checklist_catalog values
 ('vehicle-stop',array['basis','safety','identity','documents','finish']),
 ('detention',array['basis','procedure','rights','record','release']),
 ('search',array['kind','basis','procedure','record']),
 ('administrative',array['evidence','authority','procedure','decision']);
create table knowledge_private.service_checklist_progress (
  user_id uuid not null references auth.users(id) on delete cascade,
  checklist_id text not null references knowledge_private.service_checklist_catalog(id),
  checked text[] not null default '{}', version integer not null default 1, updated_at timestamptz not null default now(),
  primary key(user_id,checklist_id)
);
create table knowledge_private.service_cases (
  id uuid primary key, creator_id uuid references auth.users(id) on delete set null,
  assigned_id uuid references auth.users(id) on delete set null, subject text not null, body text not null,
  due_at timestamptz, appeal_id uuid references knowledge_private.department_appeals(id) on delete set null,
  status text not null default 'open' check(status in ('open','in_review','closed')),
  decision text not null default '', version integer not null default 1,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table knowledge_private.service_case_events (
  id uuid primary key, case_id uuid not null references knowledge_private.service_cases(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null, actor_login text not null,
  body text not null, evidence jsonb not null default '[]', created_at timestamptz not null default now()
);
create index service_cases_assigned on knowledge_private.service_cases(assigned_id,status,created_at desc);
create index service_case_events_case on knowledge_private.service_case_events(case_id,created_at,id);
create table knowledge_private.service_shifts (
  id uuid primary key, title text not null, location text not null, starts_at timestamptz not null, ends_at timestamptz not null,
  capacity integer not null check(capacity between 1 and 10), cancelled boolean not null default false,
  version integer not null default 1, created_at timestamptz not null default now(),
  check(ends_at>starts_at and ends_at<=starts_at+interval '24 hours')
);
create table knowledge_private.service_shift_members (
  shift_id uuid not null references knowledge_private.service_shifts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade, joined_at timestamptz not null default now(),
  primary key(shift_id,user_id)
);
create index service_shift_members_user on knowledge_private.service_shift_members(user_id);
create table knowledge_private.service_replacements (
  id uuid primary key, shift_id uuid not null references knowledge_private.service_shifts(id) on delete cascade,
  requester_id uuid not null references auth.users(id) on delete cascade, reason text not null,
  replacement_id uuid references auth.users(id) on delete set null,
  status text not null default 'pending' check(status in ('pending','accepted','rejected')), response text not null default '',
  version integer not null default 1, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create unique index service_replacements_pending on knowledge_private.service_replacements(shift_id,requester_id) where status='pending';

do $$ declare name text; begin
 for name in select unnest(array['service_photos','service_map','service_checklist_catalog','service_checklist_progress','service_cases','service_case_events','service_shifts','service_shift_members','service_replacements']) loop
  execute format('alter table knowledge_private.%I enable row level security',name);
  execute format('revoke all on knowledge_private.%I from public,anon,authenticated',name);
 end loop;
end $$;

create function knowledge_private.service_manager() returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from knowledge_private.test_creators c join auth.users u on u.id=c.user_id
 where c.user_id=auth.uid() and c.role in ('owner','deputy') and u.email_confirmed_at is not null and coalesce(u.banned_until<=now(),true));
$$;
revoke all on function knowledge_private.service_manager() from public,anon,authenticated;
create function knowledge_private.service_photo_access(object_path text,writing boolean default false) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from knowledge_private.service_photos p where p.path=object_path and
 case when writing then knowledge_private.service_manager() and p.author_id=auth.uid() and p.status='draft'
 else (p.status='published' and (auth.uid() is null or exists(select 1 from auth.users u where u.id=auth.uid() and coalesce(u.banned_until<=now(),true)))) or knowledge_private.service_manager() end);
$$;
revoke all on function knowledge_private.service_photo_access(text,boolean) from public,anon,authenticated;
grant execute on function knowledge_private.service_photo_access(text,boolean) to anon,authenticated;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
 values('usb-gallery','usb-gallery',false,5242880,array['image/jpeg','image/png','image/webp']);
create policy usb_gallery_read on storage.objects for select to anon,authenticated
 using(bucket_id='usb-gallery' and knowledge_private.service_photo_access(name,false));
create policy usb_gallery_upload on storage.objects for insert to authenticated
 with check(bucket_id='usb-gallery' and knowledge_private.service_photo_access(name,true));
-- Published files cannot be overwritten. Hiding an image changes its publication state.

create function knowledge_private.service_links(input jsonb) returns jsonb language plpgsql immutable set search_path='' as $$
declare entry jsonb; value text; begin
 if jsonb_typeof(input) is distinct from 'array' or jsonb_array_length(input)>10 then raise exception using errcode='PT400',message='Укажите до 10 ссылок на материалы.'; end if;
 for entry in select * from jsonb_array_elements(input) loop
  value:=entry#>>'{}';
  if jsonb_typeof(entry)<>'string' or char_length(value)>2048 or value !~ '^https://[A-Za-z0-9.-]+(:[0-9]{1,5})?([/?#][^[:space:]]*)?$' then
   raise exception using errcode='PT400',message='Материалы должны быть ссылками HTTPS без логина и пароля.';
  end if;
 end loop; return input;
end $$;
create function knowledge_private.service_version(input jsonb) returns integer language plpgsql immutable set search_path='' as $$
begin if jsonb_typeof(input) is distinct from 'number' or (input#>>'{}') !~ '^[0-9]{1,9}$' then raise exception using errcode='PT400',message='Обновите данные перед сохранением.'; end if; return (input#>>'{}')::integer; end $$;
revoke all on function knowledge_private.service_links(jsonb),knowledge_private.service_version(jsonb) from public,anon,authenticated;

create function knowledge_private.service(payload jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' as $$
<<request>>
declare uid uuid:=auth.uid(); manager boolean; member boolean; op text; key uuid; target uuid; expected integer; offset_value integer;
 title text; body text; status text; extension text; login text; start_value timestamptz; end_value timestamptz; due timestamptz;
 photo knowledge_private.service_photos; case_row knowledge_private.service_cases; shift_row knowledge_private.service_shifts;
 replacement knowledge_private.service_replacements; progress knowledge_private.service_checklist_progress; map_row knowledge_private.service_map;
 checked text[]; step_ids text[]; entry jsonb; point jsonb; pins jsonb; routes jsonb; dimensions integer[]; managed boolean; capacity_value integer;
begin
 if jsonb_typeof(payload) is distinct from 'object' or octet_length(payload::text)>120000 then raise exception using errcode='PT400',message='Некорректные данные.'; end if;
 op:=coalesce(payload->>'action','context');
 perform knowledge_private.require_active_account(op<>'photos');
 manager:=knowledge_private.service_manager();
 if op<>'photos' and not exists(select 1 from auth.users where id=uid and email_confirmed_at is not null) then raise exception using errcode='PT401',message='Подтвердите почту и войдите в аккаунт.'; end if;
 member:=manager or exists(select 1 from knowledge_private.department_members where user_id=uid and active);
 select coalesce(login_key,'Сотрудник') into login from knowledge_private.logins where user_id=uid;
 if coalesce(payload->>'offset','0') !~ '^[0-9]{1,6}$' then raise exception using errcode='PT400',message='Проверьте номер страницы.'; end if;
 offset_value:=coalesce((payload->>'offset')::integer,0);
 if op='context' then
  return jsonb_build_object('userId',uid,'canManage',manager,'isMember',member,'members',case when member then coalesce((select jsonb_agg(jsonb_build_object('id',m.user_id,'name',m.display_name) order by m.sort_order,m.display_name) from knowledge_private.department_members m join auth.users u on u.id=m.user_id where m.active and u.email_confirmed_at is not null and coalesce(u.banned_until<=now(),true)),'[]') else '[]'::jsonb end);
 elsif op='photos' then
  managed:=coalesce(payload->>'manage','false')='true';
  if managed and not manager then raise exception using errcode='PT403',message='Управление галереей доступно руководству.'; end if;
  return jsonb_build_object('total',(select count(*) from knowledge_private.service_photos p where managed or p.status='published'),'items',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'path',p.path,'title',p.title,'caption',p.caption,'width',p.width,'height',p.height,'status',p.status,'version',p.version,'createdAt',p.created_at) order by p.created_at desc,p.id) from (select * from knowledge_private.service_photos p where managed or p.status='published' order by p.created_at desc,p.id limit 20 offset offset_value) p),'[]'));
 elsif op in ('photoPrepare','photoSave','photoArchive') then
  if not manager then raise exception using errcode='PT403',message='Публиковать фото может руководство.'; end if;
  key:=(payload->>'id')::uuid; if key is null then raise exception using errcode='PT400',message='Укажите фотографию.'; end if;
  perform pg_advisory_xact_lock(hashtextextended('photo:'||key::text,0));
  select * into photo from knowledge_private.service_photos where id=key for update;
  if op='photoPrepare' then
   if found then
    if photo.author_id<>uid or photo.status<>'draft' then raise exception using errcode='PT409',message='Фото уже сохранено. Обновите список.'; end if;
    return jsonb_build_object('id',photo.id,'path',photo.path,'version',photo.version);
   end if;
   if (select count(*) from knowledge_private.service_photos where author_id=uid and created_at>now()-interval '1 hour')>=30 then raise exception using errcode='PT429',message='За час можно добавить до 30 фото.'; end if;
   extension:=payload->>'extension'; if extension not in ('jpg','png','webp') then raise exception using errcode='PT400',message='Выберите JPEG, PNG или WebP.'; end if;
   dimensions:=array[knowledge_private.service_version(payload->'width'),knowledge_private.service_version(payload->'height')];
   if dimensions[1] not between 1 and 12000 or dimensions[2] not between 1 and 12000 then raise exception using errcode='PT400',message='Размер изображения должен быть не больше 12000 пикселей.'; end if;
   insert into knowledge_private.service_photos(id,author_id,path,title,caption,width,height) values(key,uid,uid::text||'/'||key::text||'.'||extension,knowledge_private.text_field(payload->'title','Подпись',3,140),knowledge_private.text_field(coalesce(payload->'caption','""'),'Описание',0,1500),dimensions[1],dimensions[2]) returning * into photo;
   return jsonb_build_object('id',photo.id,'path',photo.path,'version',photo.version);
  end if;
  if not found then raise exception using errcode='PT404',message='Фото не найдено.'; end if;
  if knowledge_private.service_version(payload->'version')<>photo.version then raise exception using errcode='PT409',message='Фото изменилось. Обновите список.'; end if;
  if op='photoSave' then
   if not exists(select 1 from storage.objects where bucket_id='usb-gallery' and name=photo.path) then raise exception using errcode='PT400',message='Сначала загрузите изображение.'; end if;
   update knowledge_private.service_photos set title=knowledge_private.text_field(payload->'title','Подпись',3,140),caption=knowledge_private.text_field(coalesce(payload->'caption','""'),'Описание',0,1500),status='published',version=version+1,updated_at=now() where id=key;
  else update knowledge_private.service_photos set status='archived',version=version+1,updated_at=now() where id=key;
  end if; return jsonb_build_object('id',key);
 elsif op in ('map','mapSave') then
  if not member then raise exception using errcode='PT403',message='Карта службы доступна действующему составу.'; end if;
  select * into map_row from knowledge_private.service_map where id for update;
  if op='mapSave' then
   if not manager then raise exception using errcode='PT403',message='Изменять карту может руководство.'; end if;
   if knowledge_private.service_version(payload->'version')<>map_row.version then raise exception using errcode='PT409',message='Карта изменилась. Обновите её.'; end if;
   pins:=payload->'pins'; routes:=payload->'routes';
   if jsonb_typeof(pins) is distinct from 'array' or jsonb_typeof(routes) is distinct from 'array' or jsonb_array_length(pins)>100 or jsonb_array_length(routes)>30 then raise exception using errcode='PT400',message='На карте допустимо до 100 меток и 30 маршрутов.'; end if;
   for entry in select * from jsonb_array_elements(pins||routes) loop
    perform knowledge_private.text_field(entry->'id','Идентификатор',1,80); perform knowledge_private.text_field(entry->'title','Название',3,100); perform knowledge_private.text_field(coalesce(entry->'description','""'),'Описание',0,1000);
    if coalesce(entry->>'kind','') not in ('post','object','route') then raise exception using errcode='PT400',message='Выберите тип метки.'; end if;
   end loop;
   if exists(select 1 from jsonb_array_elements(pins||routes) e group by e->>'id' having count(*)>1) then raise exception using errcode='PT400',message='Идентификаторы меток повторяются.'; end if;
   for entry in select * from jsonb_array_elements(pins) loop
    if coalesce(entry->>'kind','') not in ('post','object') then raise exception using errcode='PT400',message='Неверный тип метки.'; end if;
    if jsonb_typeof(entry->'x') is distinct from 'number' or jsonb_typeof(entry->'y') is distinct from 'number' or (entry->>'x')::numeric not between 0 and 1000 or (entry->>'y')::numeric not between 0 and 1000 then raise exception using errcode='PT400',message='Метка вне карты.'; end if;
   end loop;
   for entry in select * from jsonb_array_elements(routes) loop
    if entry->>'kind' is distinct from 'route' or jsonb_typeof(entry->'points') is distinct from 'array' or jsonb_array_length(entry->'points') not between 2 and 50 then raise exception using errcode='PT400',message='Маршрут должен содержать от 2 до 50 точек.'; end if;
    for point in select * from jsonb_array_elements(entry->'points') loop
     if jsonb_typeof(point->'x') is distinct from 'number' or jsonb_typeof(point->'y') is distinct from 'number' or (point->>'x')::numeric not between 0 and 1000 or (point->>'y')::numeric not between 0 and 1000 then raise exception using errcode='PT400',message='Маршрут выходит за карту.'; end if;
    end loop;
   end loop;
   update knowledge_private.service_map set pins=request.pins,routes=request.routes,version=version+1,updated_at=now() where id returning * into map_row;
  end if;
  return jsonb_build_object('pins',map_row.pins,'routes',map_row.routes,'version',map_row.version,'updatedAt',map_row.updated_at);
 elsif op in ('checklist','checklistSave') then
  title:=payload->>'id'; select steps into step_ids from knowledge_private.service_checklist_catalog where id=title;
  if not found then raise exception using errcode='PT404',message='Чек-лист не найден.'; end if;
  perform pg_advisory_xact_lock(hashtextextended('checklist:'||uid::text||title,0));
  select * into progress from knowledge_private.service_checklist_progress where user_id=uid and checklist_id=title for update;
  if op='checklistSave' then
   if knowledge_private.service_version(payload->'version')<>coalesce(progress.version,0) then raise exception using errcode='PT409',message='Отметки изменились. Обновите чек-лист.'; end if;
   if jsonb_typeof(payload->'checked') is distinct from 'array' or jsonb_array_length(payload->'checked')>20 or exists(select 1 from jsonb_array_elements(payload->'checked') e where jsonb_typeof(e)<>'string' or not (e#>>'{}')=any(step_ids)) then raise exception using errcode='PT400',message='Проверьте пункты чек-листа.'; end if;
   select coalesce(array_agg(distinct value order by value),'{}') into checked from jsonb_array_elements_text(payload->'checked');
   insert into knowledge_private.service_checklist_progress(user_id,checklist_id,checked) values(uid,title,checked) on conflict(user_id,checklist_id) do update set checked=excluded.checked,version=knowledge_private.service_checklist_progress.version+1,updated_at=now() returning * into progress;
  end if;
  return jsonb_build_object('id',title,'checked',coalesce(progress.checked,'{}'),'version',coalesce(progress.version,0),'updatedAt',progress.updated_at);
 end if;
 if not member then raise exception using errcode='PT403',message='Раздел доступен действующему составу.'; end if;
 if op='cases' then
  status:=coalesce(payload->>'status','all'); if status not in ('all','open','in_review','closed') then raise exception using errcode='PT400',message='Проверьте фильтр.'; end if;
  return jsonb_build_object('total',(select count(*) from knowledge_private.service_cases c where (manager or c.assigned_id=uid) and (request.status='all' or c.status=request.status)),'items',coalesce((select jsonb_agg(to_jsonb(c) order by c.created_at desc,c.id) from (select c.*,m.display_name as assigned_name from knowledge_private.service_cases c left join knowledge_private.department_members m on m.user_id=c.assigned_id where (manager or c.assigned_id=uid) and (request.status='all' or c.status=request.status) order by c.created_at desc,c.id limit 20 offset offset_value) c),'[]'));
 elsif op in ('case','caseSave','caseNote') then
  key:=(payload->>'id')::uuid; if key is null then raise exception using errcode='PT400',message='Укажите дело.'; end if;
  perform pg_advisory_xact_lock(hashtextextended('case:'||key::text,0));
  select * into case_row from knowledge_private.service_cases where id=key for update;
  if op='caseSave' then
   if not manager then raise exception using errcode='PT403',message='Создавать и завершать проверку может руководство.'; end if;
   if knowledge_private.service_version(payload->'version')<>coalesce(case_row.version,0) then raise exception using errcode='PT409',message='Дело изменилось. Обновите его.'; end if;
   target:=nullif(payload->>'assignedId','')::uuid;
   if target is null or not exists(select 1 from knowledge_private.department_members m join auth.users u on u.id=m.user_id where m.user_id=target and m.active and u.email_confirmed_at is not null and coalesce(u.banned_until<=now(),true)) then raise exception using errcode='PT400',message='Выберите действующего сотрудника.'; end if;
   title:=knowledge_private.text_field(payload->'subject','Тема',5,160);body:=knowledge_private.text_field(payload->'body','Описание',20,12000);
   status:=coalesce(payload->>'status','open'); if status not in ('open','in_review','closed') then raise exception using errcode='PT400',message='Выберите статус проверки.'; end if;
   extension:=knowledge_private.text_field(coalesce(payload->'decision','""'),'Решение',0,6000);
   if status='closed' and char_length(extension)<20 then raise exception using errcode='PT400',message='Для завершения проверки напишите решение: минимум 20 символов.'; end if;
   due:=nullif(payload->>'dueAt','')::timestamptz;
   if due is not null and (due<'2020-01-01'::timestamptz or due>now()+interval '2 years') then raise exception using errcode='PT400',message='Проверьте срок проверки.'; end if;
   if nullif(payload->>'appealId','') is not null and not exists(select 1 from knowledge_private.department_appeals where id=(payload->>'appealId')::uuid) then raise exception using errcode='PT404',message='Обращение не найдено.'; end if;
   insert into knowledge_private.service_cases(id,creator_id,assigned_id,subject,body,due_at,appeal_id,status,decision) values(key,uid,target,title,body,due,nullif(payload->>'appealId','')::uuid,status,extension)
    on conflict(id) do update set assigned_id=excluded.assigned_id,subject=excluded.subject,body=excluded.body,due_at=excluded.due_at,appeal_id=excluded.appeal_id,status=excluded.status,decision=excluded.decision,version=knowledge_private.service_cases.version+1,updated_at=now() returning * into case_row;
   insert into knowledge_private.service_case_events(id,case_id,actor_id,actor_login,body) values(gen_random_uuid(),key,uid,coalesce(login,'Руководство'),'Сохранена проверка · '||case status when 'open' then 'Открыта' when 'in_review' then 'На рассмотрении' else 'Завершена' end||case when extension<>'' then E'\nРешение: '||extension else '' end);
  else
   if case_row.id is null or (not manager and case_row.assigned_id is distinct from uid) then raise exception using errcode='PT404',message='Дело не найдено.'; end if;
   if op='caseNote' then
    if case_row.status='closed' then raise exception using errcode='PT409',message='Проверка завершена. Для новых материалов руководство должно открыть её снова.'; end if;
    target:=(payload->>'noteId')::uuid; if target is null then raise exception using errcode='PT400',message='Обновите форму материала.'; end if;
    if exists(select 1 from knowledge_private.service_case_events where id=target and case_id=key and actor_id=uid) then return jsonb_build_object('id',key); end if;
    if (select count(*) from knowledge_private.service_case_events where actor_id=uid and created_at>now()-interval '1 hour')>=60 then raise exception using errcode='PT429',message='За час можно добавить до 60 материалов.'; end if;
    insert into knowledge_private.service_case_events(id,case_id,actor_id,actor_login,body,evidence) values(target,key,uid,coalesce(login,'Сотрудник'),knowledge_private.text_field(payload->'body','Материал',10,6000),knowledge_private.service_links(coalesce(payload->'evidence','[]')));
   end if;
  end if;
  return to_jsonb(case_row)||jsonb_build_object('assigned_name',(select display_name from knowledge_private.department_members where user_id=case_row.assigned_id),'events',coalesce((select jsonb_agg(to_jsonb(e) order by e.created_at,e.id) from knowledge_private.service_case_events e where case_id=key),'[]'));
 elsif op='shifts' then
  start_value:=(payload->>'from')::timestamptz; end_value:=(payload->>'to')::timestamptz;
  if start_value is null or end_value is null or end_value<=start_value or end_value>start_value+interval '62 days' then raise exception using errcode='PT400',message='Выберите период до 62 дней.'; end if;
  return jsonb_build_object('items',coalesce((select jsonb_agg(to_jsonb(s)||jsonb_build_object('members',coalesce((select jsonb_agg(jsonb_build_object('id',p.user_id,'name',m.display_name) order by p.joined_at) from knowledge_private.service_shift_members p join knowledge_private.department_members m on m.user_id=p.user_id where p.shift_id=s.id),'[]')) order by s.starts_at,s.id) from knowledge_private.service_shifts s where s.starts_at<end_value and s.ends_at>start_value),'[]'),
   'requests',coalesce((select jsonb_agg(to_jsonb(r)||jsonb_build_object('requesterName',m.display_name,'shiftTitle',s.title,'startsAt',s.starts_at) order by r.created_at desc) from knowledge_private.service_replacements r join knowledge_private.service_shifts s on s.id=r.shift_id left join knowledge_private.department_members m on m.user_id=r.requester_id where (manager or r.requester_id=uid) and s.starts_at<end_value and s.ends_at>start_value),'[]'));
 elsif op in ('shiftSave','shiftCancel','shiftJoin','shiftAssign','shiftLeave','replacement','replacementReview') then
  -- A single scheduling lock covers joins, capacity, overlap checks and replacements.
  perform pg_advisory_xact_lock(hashtextextended('usb-service-schedule',0));
  key:=(payload->>'id')::uuid; if key is null then raise exception using errcode='PT400',message='Укажите смену.'; end if;
  if op='replacementReview' then
   if not manager then raise exception using errcode='PT403',message='Рассмотрение замен доступно руководству.'; end if;
   select * into replacement from knowledge_private.service_replacements where id=key for update;
   if not found then raise exception using errcode='PT404',message='Заявка не найдена.'; end if;
   if knowledge_private.service_version(payload->'version')<>replacement.version or replacement.status<>'pending' then raise exception using errcode='PT409',message='Заявка уже рассмотрена. Обновите график.'; end if;
   key:=replacement.shift_id;
  end if;
  select * into shift_row from knowledge_private.service_shifts where id=key for update;
  if op='shiftSave' then
   if not manager then raise exception using errcode='PT403',message='Создавать смены может руководство.'; end if;
   if knowledge_private.service_version(payload->'version')<>coalesce(shift_row.version,0) then raise exception using errcode='PT409',message='Смена изменилась. Обновите график.'; end if;
   start_value:=(payload->>'startsAt')::timestamptz;end_value:=(payload->>'endsAt')::timestamptz;capacity_value:=knowledge_private.service_version(payload->'capacity');
   if start_value is null or end_value is null or start_value<=now() or start_value>now()+interval '1 year' or end_value<=start_value or end_value>start_value+interval '24 hours' or capacity_value not between 1 and 10 then raise exception using errcode='PT400',message='Проверьте время смены (до 24 часов) и число мест (1–10).'; end if;
   if shift_row.id is not null and exists(select 1 from knowledge_private.service_shift_members where shift_id=key) then raise exception using errcode='PT409',message='На смену уже записались. Отмените её и создайте новую, чтобы изменить время или место.'; end if;
   insert into knowledge_private.service_shifts(id,title,location,starts_at,ends_at,capacity) values(key,knowledge_private.text_field(payload->'title','Название',3,140),knowledge_private.text_field(payload->'location','Место',3,160),start_value,end_value,capacity_value)
    on conflict(id) do update set title=excluded.title,location=excluded.location,starts_at=excluded.starts_at,ends_at=excluded.ends_at,capacity=excluded.capacity,version=knowledge_private.service_shifts.version+1 returning * into shift_row;
   return jsonb_build_object('id',shift_row.id);
  end if;
  if shift_row.id is null then raise exception using errcode='PT404',message='Смена не найдена.'; end if;
  if shift_row.cancelled or shift_row.starts_at<=now() then raise exception using errcode='PT409',message='Смена началась или отменена.'; end if;
  if op='shiftCancel' then
   if not manager then raise exception using errcode='PT403',message='Отменять смены может руководство.'; end if;
   if knowledge_private.service_version(payload->'version')<>shift_row.version then raise exception using errcode='PT409',message='Смена изменилась. Обновите график.'; end if;
   update knowledge_private.service_shifts set cancelled=true,version=version+1 where id=key;
   update knowledge_private.service_replacements r set status='rejected',response='Смена отменена',version=version+1,updated_at=now() where r.shift_id=key and r.status='pending';
  elsif op in ('shiftJoin','shiftAssign') then
   target:=uid;
   if op='shiftAssign' then
    if not manager then raise exception using errcode='PT403',message='Назначать сотрудников может руководство.'; end if;
    target:=(payload->>'userId')::uuid;
    if target is null or not exists(select 1 from knowledge_private.department_members m join auth.users u on u.id=m.user_id where m.user_id=target and m.active and u.email_confirmed_at is not null and coalesce(u.banned_until<=now(),true)) then raise exception using errcode='PT400',message='Выберите действующего сотрудника.'; end if;
   end if;
   if not exists(select 1 from knowledge_private.service_shift_members where shift_id=key and user_id=target) then
    if (select count(*) from knowledge_private.service_shift_members where shift_id=key)>=shift_row.capacity then raise exception using errcode='PT409',message='Свободных мест нет.'; end if;
    if exists(select 1 from knowledge_private.service_shift_members p join knowledge_private.service_shifts s on s.id=p.shift_id where p.user_id=target and not s.cancelled and s.starts_at<shift_row.ends_at and s.ends_at>shift_row.starts_at) then raise exception using errcode='PT409',message='У сотрудника уже есть смена в это время.'; end if;
    insert into knowledge_private.service_shift_members(shift_id,user_id) values(key,target);
   end if;
  elsif op='shiftLeave' then
   delete from knowledge_private.service_shift_members where shift_id=key and user_id=uid;
   update knowledge_private.service_replacements r set status='rejected',response='Сотрудник отменил запись',version=version+1,updated_at=now() where r.shift_id=key and r.requester_id=uid and r.status='pending';
  elsif op='replacement' then
   if not exists(select 1 from knowledge_private.service_shift_members where shift_id=key and user_id=uid) then raise exception using errcode='PT403',message='Сначала запишитесь на эту смену.'; end if;
   select * into replacement from knowledge_private.service_replacements r where r.shift_id=key and r.requester_id=uid and r.status='pending';
   if replacement.id is null then insert into knowledge_private.service_replacements(id,shift_id,requester_id,reason) values(gen_random_uuid(),key,uid,knowledge_private.text_field(payload->'reason','Причина замены',10,2000)) returning * into replacement; end if;
   return jsonb_build_object('id',replacement.id);
  elsif op='replacementReview' then
   status:=payload->>'status';body:=knowledge_private.text_field(coalesce(payload->'response','""'),'Ответ',0,2000);
   if status not in ('accepted','rejected') then raise exception using errcode='PT400',message='Выберите решение по замене.'; end if;
   target:=nullif(payload->>'replacementId','')::uuid;
   if status='accepted' then
    if target is null or target=replacement.requester_id or not exists(select 1 from knowledge_private.department_members m join auth.users u on u.id=m.user_id where m.user_id=target and m.active and u.email_confirmed_at is not null and coalesce(u.banned_until<=now(),true)) then raise exception using errcode='PT400',message='Выберите другого действующего сотрудника.'; end if;
    if not exists(select 1 from knowledge_private.service_shift_members where shift_id=key and user_id=replacement.requester_id) then raise exception using errcode='PT409',message='Сотрудник больше не записан на смену.'; end if;
    if exists(select 1 from knowledge_private.service_shift_members p join knowledge_private.service_shifts s on s.id=p.shift_id where p.user_id=target and not s.cancelled and s.starts_at<shift_row.ends_at and s.ends_at>shift_row.starts_at) then raise exception using errcode='PT409',message='У выбранного сотрудника уже есть смена в это время.'; end if;
    delete from knowledge_private.service_shift_members where shift_id=key and user_id=replacement.requester_id;
    insert into knowledge_private.service_shift_members(shift_id,user_id) values(key,target);
   end if;
   update knowledge_private.service_replacements set status=request.status,response=request.body,replacement_id=case when request.status='accepted' then target else null end,version=version+1,updated_at=now() where id=replacement.id;
  end if; return jsonb_build_object('id',key);
 end if;
 raise exception using errcode='PT400',message='Неизвестное действие.';
exception when invalid_text_representation or numeric_value_out_of_range or datetime_field_overflow or check_violation or not_null_violation then raise exception using errcode='PT400',message='Проверьте данные формы.';
end $$;
revoke all on function knowledge_private.service(jsonb) from public,anon,authenticated;
grant execute on function knowledge_private.service(jsonb) to anon,authenticated;
create function public.knowledge_service(payload jsonb default '{}') returns jsonb language sql security invoker set search_path='' as $$ select knowledge_private.service(payload); $$;
revoke all on function public.knowledge_service(jsonb) from public,anon,authenticated;
grant execute on function public.knowledge_service(jsonb) to anon,authenticated;
comment on function public.knowledge_service(jsonb) is 'Public published gallery; role-checked map, own checklists, assigned investigations and transactional duty scheduling. No private data is returned to guests.';
