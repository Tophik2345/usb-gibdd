-- Read-only paginated results; every request is bound to the live authenticated user.
create index attempts_results_user on knowledge_private.attempts(user_id,finished_at desc,id desc) where finished_at is not null;
create index attempts_results_author on knowledge_private.attempts(author_id,finished_at desc,id desc) where finished_at is not null;
create function knowledge_private.results(payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); scope text; test_key text; employee text; status text;
  day_from text; day_to text; date_from timestamptz; date_to timestamptz; min_score integer; max_score integer;
  snap timestamptz; cursor_time timestamptz; cursor_id text; result jsonb;
begin
  perform knowledge_private.require_active_account();
  if not exists(select 1 from auth.users where id=uid and email_confirmed_at is not null) then raise exception using errcode='PT401',message='Подтвердите почту и войдите в аккаунт.'; end if;
  if jsonb_typeof(payload) is distinct from 'object' or octet_length(payload::text)>4096 then raise exception using errcode='PT400',message='Некорректные фильтры.'; end if;
  scope:=coalesce(payload->>'scope','mine');
  if scope not in ('mine','practice','team') then raise exception using errcode='PT400',message='Выберите раздел результатов.'; end if;
  test_key:=nullif(payload->>'testId',''); employee:=lower(btrim(regexp_replace(coalesce(payload->>'employee',''),'\s+',' ','g')));
  if char_length(employee)>100 then raise exception using errcode='PT400',message='Поиск сотрудника: не более 100 символов.'; end if;
  status:=coalesce(nullif(payload->>'status',''),'all');
  if status not in ('all','passed','failed') then raise exception using errcode='PT400',message='Выберите статус результата.'; end if;
  day_from:=nullif(payload->>'from',''); day_to:=nullif(payload->>'to','');
  if day_from is not null then
    if day_from !~ '^\d{4}-\d{2}-\d{2}$' or to_char(day_from::date,'YYYY-MM-DD')<>day_from then raise exception using errcode='PT400',message='Проверьте начальную дату.'; end if;
    date_from:=day_from::timestamp at time zone 'Europe/Moscow';
  end if;
  if day_to is not null then
    if day_to !~ '^\d{4}-\d{2}-\d{2}$' or to_char(day_to::date,'YYYY-MM-DD')<>day_to then raise exception using errcode='PT400',message='Проверьте конечную дату.'; end if;
    date_to:=(day_to::date+1)::timestamp at time zone 'Europe/Moscow';
  end if;
  if date_from>=date_to then raise exception using errcode='PT400',message='Начальная дата должна быть не позже конечной.'; end if;
  if payload->>'minScore' is not null then
    if payload->>'minScore' !~ '^[0-9]{1,3}$' then raise exception using errcode='PT400',message='Оценка: от 0 до 100%.'; end if;
    min_score:=(payload->>'minScore')::integer;
  end if;
  if payload->>'maxScore' is not null then
    if payload->>'maxScore' !~ '^[0-9]{1,3}$' then raise exception using errcode='PT400',message='Оценка: от 0 до 100%.'; end if;
    max_score:=(payload->>'maxScore')::integer;
  end if;
  if min_score not between 0 and 100 or max_score not between 0 and 100 or min_score>max_score then raise exception using errcode='PT400',message='Проверьте диапазон оценки: от 0 до 100%.'; end if;
  snap:=coalesce((payload->>'snapshot')::timestamptz,statement_timestamp());
  if not isfinite(snap) then raise exception using errcode='PT400',message='Обновите результаты.'; end if;
  if payload->'cursor' is not null and payload->'cursor'<>'null'::jsonb then
    cursor_time:=(payload->'cursor'->>'finishedAt')::timestamptz; cursor_id:=payload->'cursor'->>'id';
    if cursor_time is null or not isfinite(cursor_time) or cursor_id is null or char_length(cursor_id)>100 then raise exception using errcode='PT400',message='Обновите страницу результатов.'; end if;
  end if;
  with visible as materialized (
    select a.* from knowledge_private.attempts a where a.finished_at is not null and a.finished_at<=snap
      and case when scope='team' then a.author_id=uid else a.user_id=uid and (a.mode='practice')=(scope='practice') end
  ), filtered as materialized (
    select a.* from visible a where (test_key is null or a.test_id=test_key)
      and (employee='' or strpos(lower(regexp_replace(a.employee_name,'\s+',' ','g')),employee)>0)
      and (date_from is null or a.finished_at>=date_from) and (date_to is null or a.finished_at<date_to)
      and (min_score is null or a.score*100>=min_score*a.total) and (max_score is null or a.score*100<=max_score*a.total)
      and (status='all' or (a.score*100>=a.pass_mark*a.total)=(status='passed'))
  ), page as materialized (
    select a.* from filtered a where cursor_time is null or (a.finished_at,a.id)<(cursor_time,cursor_id)
    order by a.finished_at desc,a.id desc limit 101
  ), shown as materialized (select * from page order by finished_at desc,id desc limit 100)
  select jsonb_build_object('rows',coalesce((select jsonb_agg(knowledge_private.attempt_json(a,false) order by a.finished_at desc,a.id desc) from shown a),'[]'::jsonb),
    'total',(select count(*) from filtered),'snapshot',snap,
    'nextCursor',case when (select count(*) from page)>100 then (select jsonb_build_object('finishedAt',finished_at,'id',id) from shown order by finished_at,id limit 1) else null end,
    'tests',coalesce((select jsonb_agg(jsonb_build_object('id',test_id,'title',test_title) order by test_title,test_id)
      from (select distinct on(test_id) test_id,test_title from visible order by test_id,finished_at desc,id desc) t),'[]'::jsonb)) into result;
  return result;
exception when invalid_text_representation or datetime_field_overflow or numeric_value_out_of_range then raise exception using errcode='PT400',message='Проверьте даты и диапазон оценки.';
end; $$;
revoke all on function knowledge_private.results(jsonb) from public,anon,authenticated;
grant execute on function knowledge_private.results(jsonb) to authenticated;
create function public.knowledge_results(payload jsonb default '{}'::jsonb) returns jsonb language sql security invoker set search_path='' as $$ select knowledge_private.results(payload); $$;
revoke all on function public.knowledge_results(jsonb) from public,anon,authenticated;
grant execute on function public.knowledge_results(jsonb) to authenticated;
comment on function public.knowledge_results(jsonb) is 'Scoped result export 20261001120000';
notify pgrst,'reload schema';
