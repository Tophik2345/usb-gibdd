-- Personal notifications are derived from existing records; only read marks are stored.
create table knowledge_private.notification_reads (
  user_id uuid not null references auth.users(id) on delete cascade,
  event_key text not null check (char_length(event_key) between 1 and 300),
  read_at timestamptz not null default now(),
  primary key(user_id,event_key)
);
alter table knowledge_private.notification_reads enable row level security;
revoke all on knowledge_private.notification_reads from public,anon,authenticated;

create index management_events_assignment_notification
  on knowledge_private.management_events(target_id,created_at desc) where area='assignments';

create function knowledge_private.notification_feed(subject uuid, at_time timestamptz)
returns table(event_key text,kind text,title text,summary text,target_id text,occurred_at timestamptz)
language sql stable set search_path='' as $$
  with active as (
    select a.* from knowledge_private.assignments a where a.user_id=$1
      and a.completed_at is null and a.cancelled_at is null and a.reset_to_id is null
  ), clearance as (
    select knowledge_private.clearance_state($1) state,extract(epoch from c.decided_at)::text decision_key,
      greatest(c.decided_at,c.requested_at,p.updated_at,
        (select max(t.updated_at) from knowledge_private.tests t where t.id=any(p.required_tests))) changed_at
    from knowledge_private.service_clearances c cross join knowledge_private.training_program p
    where c.user_id=$1 and p.singleton
  )
  select 'assignment:'||a.id||':'||a.version,'assignment',
    case when a.version=1 then 'Назначен тест' else 'Назначение обновлено' end,a.test_title,a.id,
    case when a.version=1 then a.assigned_at else coalesce(
      (select max(e.created_at) from knowledge_private.management_events e where e.area='assignments' and e.target_id=a.id),a.assigned_at) end
  from active a
  union all
  select 'deadline:'||a.id||':'||md5(extract(epoch from a.due_at)::text),'deadline','Срок сдачи приближается',a.test_title,a.id,a.due_at-interval '24 hours'
    from active a where a.due_at>$2 and a.due_at<=$2+interval '24 hours'
  union all
  select 'overdue:'||a.id||':'||md5(extract(epoch from a.due_at)::text),'overdue','Срок сдачи прошёл',a.test_title,a.id,a.due_at
    from active a where a.due_at<=$2
  union all
  select 'appeal:'||a.id||':'||a.version,'appeal','Ответ на обращение',a.subject,a.id::text,a.updated_at
    from knowledge_private.department_appeals a where a.author_id=$1 and a.response<>''
  union all
  select 'clearance:'||md5(coalesce(c.decision_key,'')||':'||(c.state->>'status')||':'||(c.state->>'programVersion')||':'||(c.state->'fingerprint')::text),
    'clearance',case c.state->>'status' when 'approved' then 'Допуск подтверждён'
      when 'rejected' then 'Подготовка возвращена на доработку' when 'revoked' then 'Допуск отозван'
      else 'Допуск нужно подтвердить заново' end,
    left(coalesce(nullif(c.state->>'note',''),'Откройте подготовку, чтобы посмотреть решение.'),200),null,c.changed_at
    from clearance c where c.state->>'status' in ('approved','rejected','revoked','outdated');
$$;
revoke all on function knowledge_private.notification_feed(uuid,timestamptz) from public,anon,authenticated;

create function public.knowledge_notifications(payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  uid uuid:=auth.uid(); op text; stamp timestamptz:=clock_timestamp();
  cursor_at timestamptz; cursor_id text; ids jsonb; rows jsonb; count_all integer; unread integer;
begin
  perform knowledge_private.require_active_account();
  if not exists(select 1 from auth.users where id=uid and email_confirmed_at is not null) then
    raise exception using errcode='PT401',message='Подтвердите почту, чтобы открыть уведомления.';
  end if;
  if jsonb_typeof(payload) is distinct from 'object' or octet_length(payload::text)>20000 then
    raise exception using errcode='PT400',message='Некорректные данные.';
  end if;
  op:=coalesce(payload->>'action','list');
  if op not in ('list','markRead','markAll') then raise exception using errcode='PT400',message='Неизвестное действие.'; end if;
  if op='markRead' then
    ids:=payload->'ids';
    if jsonb_typeof(ids) is distinct from 'array' then raise exception using errcode='PT400',message='Выберите уведомления.'; end if;
    if jsonb_array_length(ids) not between 1 and 100 or exists(
      select 1 from jsonb_array_elements(ids) x where jsonb_typeof(x)<>'string' or char_length(x#>>'{}') not between 1 and 300
    ) then raise exception using errcode='PT400',message='Некорректные уведомления.'; end if;
    insert into knowledge_private.notification_reads(user_id,event_key)
      select uid,n.event_key from knowledge_private.notification_feed(uid,stamp) n
      where n.event_key in (select jsonb_array_elements_text(ids)) on conflict do nothing;
  elsif op='markAll' then
    insert into knowledge_private.notification_reads(user_id,event_key)
      select uid,n.event_key from knowledge_private.notification_feed(uid,stamp) n on conflict do nothing;
  end if;
  select count(*)::integer,count(*) filter(where r.event_key is null)::integer into count_all,unread
    from knowledge_private.notification_feed(uid,stamp) n
    left join knowledge_private.notification_reads r on r.user_id=uid and r.event_key=n.event_key;
  if op<>'list' then return jsonb_build_object('unreadCount',unread,'total',count_all); end if;
  if payload->'cursor' is not null and payload->'cursor'<>'null'::jsonb then
    if jsonb_typeof(payload->'cursor')<>'object' or jsonb_typeof(payload->'cursor'->'at') is distinct from 'string'
      or jsonb_typeof(payload->'cursor'->'id') is distinct from 'string'
      or char_length(payload->'cursor'->>'id') not between 1 and 300 then
      raise exception using errcode='PT400',message='Некорректная страница уведомлений.';
    end if;
    begin cursor_at:=(payload->'cursor'->>'at')::timestamptz;
    exception when others then raise exception using errcode='PT400',message='Некорректная дата страницы.'; end;
    if not isfinite(cursor_at) then raise exception using errcode='PT400',message='Некорректная дата страницы.'; end if;
    cursor_id:=payload->'cursor'->>'id';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',n.event_key,'kind',n.kind,'title',n.title,
    'summary',n.summary,'targetId',n.target_id,'createdAt',n.occurred_at,'read',n.is_read)
    order by n.occurred_at desc,n.event_key desc),'[]'::jsonb) into rows
    from (
      select f.*,r.event_key is not null is_read from knowledge_private.notification_feed(uid,stamp) f
      left join knowledge_private.notification_reads r on r.user_id=uid and r.event_key=f.event_key
      where cursor_at is null or (f.occurred_at,f.event_key)<(cursor_at,cursor_id)
      order by f.occurred_at desc,f.event_key desc limit 21
    ) n;
  return jsonb_build_object('items',(select coalesce(jsonb_agg(x order by pos),'[]'::jsonb)
    from jsonb_array_elements(rows) with ordinality t(x,pos) where pos<=20),
    'total',count_all,'unreadCount',unread,'serverNow',stamp,
    'nextCursor',case when jsonb_array_length(rows)>20 then jsonb_build_object('at',rows->19->>'createdAt','id',rows->19->>'id') else null end);
end; $$;
revoke all on function public.knowledge_notifications(jsonb) from public,anon,authenticated;
grant execute on function public.knowledge_notifications(jsonb) to authenticated;
comment on function public.knowledge_notifications(jsonb) is 'Private notifications 20261002000100';
