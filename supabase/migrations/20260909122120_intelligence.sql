-- Durable intelligence. Run after core; no business tables are exposed directly.
create table private.processing_jobs (
 id uuid primary key default gen_random_uuid(), kind text not null check(kind in ('review_analysis','forecast')),
 payload jsonb not null, deduplication_key text not null unique, actor_id uuid references private.profiles(id),
 status text not null default 'queued' check(status in ('queued','running','completed','failed')),
 attempts integer not null default 0 check(attempts>=0), max_attempts integer not null default 5 check(max_attempts between 1 and 10),
 available_at timestamptz not null default now(), lease_expires_at timestamptz, owner_token uuid,
 last_error_code text, result jsonb, created_at timestamptz not null default now(), completed_at timestamptz
);
create index jobs_ready_idx on private.processing_jobs(status,available_at) where status in ('queued','running');
create index jobs_actor_idx on private.processing_jobs(actor_id);
create table private.history_imports (
 id uuid primary key default gen_random_uuid(), source_name text not null, actor_id uuid not null references private.profiles(id),
 row_count integer not null,created_at timestamptz not null default now()
);
create index history_imports_actor_idx on private.history_imports(actor_id);
create table private.historical_sales (
 day date not null,menu_item_id uuid not null references private.menu_items(id),quantity integer not null check(quantity>=0),
 day_status text not null check(day_status in ('complete','closed')),import_id uuid not null references private.history_imports(id),
 primary key(day,menu_item_id), check(day_status<>'closed' or quantity=0)
);
create index historical_sales_item_idx on private.historical_sales(menu_item_id,day);
create index historical_sales_import_idx on private.historical_sales(import_id);
create table private.daily_coverage (
 day date primary key, source text not null check(source in ('live','historical')),
 status text not null check(status in ('complete','closed')),note text not null,
 closed_by uuid not null references private.profiles(id),closed_at timestamptz not null default now()
);
create index daily_coverage_actor_idx on private.daily_coverage(closed_by);
create table private.forecast_runs (
 id uuid primary key default gen_random_uuid(), job_id uuid not null unique references private.processing_jobs(id),
 menu_item_id uuid not null references private.menu_items(id),as_of date not null,status text not null,
 result jsonb not null,created_at timestamptz not null default now()
);
create index forecast_runs_item_idx on private.forecast_runs(menu_item_id,created_at desc);
create table private.review_analyses (
 review_id uuid primary key references private.reviews(id),job_id uuid not null unique references private.processing_jobs(id),
 result jsonb not null,model text not null,prompt_version text not null,created_at timestamptz not null default now()
);
create table private.assistant_runs (
 id uuid primary key,actor_id uuid not null references private.profiles(id),question text not null,period jsonb not null,
 model text not null,prompt_version text not null,status text not null default 'running' check(status in ('running','completed','failed')),
 result jsonb,error_code text,created_at timestamptz not null default now(),completed_at timestamptz
);
create index assistant_runs_actor_idx on private.assistant_runs(actor_id,created_at desc);
create table private.assistant_evidence (
 run_id uuid not null references private.assistant_runs(id),evidence_id text not null,tool text not null,
 arguments jsonb not null,result jsonb not null,primary key(run_id,evidence_id)
);
alter table private.processing_jobs enable row level security;
alter table private.history_imports enable row level security;
alter table private.historical_sales enable row level security;
alter table private.daily_coverage enable row level security;
alter table private.forecast_runs enable row level security;
alter table private.review_analyses enable row level security;
alter table private.assistant_runs enable row level security;
alter table private.assistant_evidence enable row level security;
revoke all on private.processing_jobs,private.history_imports,private.historical_sales,private.daily_coverage,
 private.forecast_runs,private.review_analyses,private.assistant_runs,private.assistant_evidence from public,anon,authenticated;

create or replace function private.enqueue_job(p_kind text,p_payload jsonb,p_dedup_key text,p_actor uuid)
returns uuid language plpgsql set search_path='' as $$
declare v_id uuid;
begin
 if p_kind not in ('review_analysis','forecast') or length(p_dedup_key)>200 then
  raise exception using errcode='22023',message='Invalid job';
 end if;
 insert into private.processing_jobs(kind,payload,deduplication_key,actor_id)
 values(p_kind,p_payload,p_dedup_key,p_actor) on conflict(deduplication_key) do nothing returning id into v_id;
 if v_id is null then select id into v_id from private.processing_jobs where deduplication_key=p_dedup_key; end if;
 return v_id;
end $$;

create or replace function private.read_intelligence(p_resource text,p_params jsonb)
returns jsonb language plpgsql set search_path='' as $$
declare v_limit integer:=coalesce((p_params->>'limit')::integer,50);v_offset integer:=coalesce((p_params->>'offset')::integer,0);
 v_items jsonb;v_total bigint;v_item uuid:=nullif(p_params->>'menu_item_id','')::uuid;
begin
 perform private.require_actor(true);
 if v_limit not between 1 and 100 or v_offset<0 then raise exception using errcode='22023',message='Invalid pagination';end if;
 case p_resource
 when 'forecasts' then
  select count(*) into v_total from private.forecast_runs where v_item is null or menu_item_id=v_item;
  select coalesce(jsonb_agg(to_jsonb(q)),'[]') into v_items from
   (select * from private.forecast_runs where v_item is null or menu_item_id=v_item order by created_at desc,id limit v_limit offset v_offset) q;
 when 'jobs' then
  select count(*) into v_total from private.processing_jobs;
  select coalesce(jsonb_agg(to_jsonb(q)),'[]') into v_items from
   (select id,kind,payload,status,attempts,max_attempts,last_error_code,available_at,created_at,completed_at
    from private.processing_jobs order by created_at desc,id limit v_limit offset v_offset) q;
 when 'review_analyses' then
  select count(*) into v_total from private.review_analyses where p_params->>'review_id' is null or review_id=(p_params->>'review_id')::uuid;
  select coalesce(jsonb_agg(to_jsonb(q)),'[]') into v_items from
   (select * from private.review_analyses where p_params->>'review_id' is null or review_id=(p_params->>'review_id')::uuid
    order by created_at desc,review_id limit v_limit offset v_offset) q;
 when 'assistant_runs' then
  select count(*) into v_total from private.assistant_runs;
  select coalesce(jsonb_agg(to_jsonb(q)),'[]') into v_items from
   (select * from private.assistant_runs order by created_at desc,id limit v_limit offset v_offset) q;
 else raise exception using errcode='22023',message='Unknown read resource';
 end case;
 return jsonb_build_object('items',v_items,'total',v_total,'limit',v_limit,'offset',v_offset);
end $$;

create or replace function private.command_intelligence(p_operation text,p_payload jsonb,p_actor uuid)
returns jsonb language plpgsql set search_path='' as $$
declare v_actor uuid;v_today date:=(now() at time zone 'Asia/Karachi')::date;v_day date;
 v_id uuid;v_item uuid;v_jobs jsonb:='[]';v_row jsonb;v_existing private.historical_sales%rowtype;
 v_count integer;v_status text;v_job private.processing_jobs%rowtype;
begin
 v_actor:=private.require_actor(true);
 if v_actor is distinct from p_actor then raise exception using errcode='42501',message='Actor mismatch';end if;
 case p_operation
 when 'forecast_enqueue' then
  if jsonb_typeof(p_payload->'menu_item_ids') is distinct from 'array' or jsonb_array_length(p_payload->'menu_item_ids') not between 1 and 100 then
   raise exception using errcode='22023',message='Choose 1 to 100 menu items';end if;
  for v_item in select distinct value::uuid from jsonb_array_elements_text(p_payload->'menu_item_ids') loop
   if not exists(select 1 from private.menu_items where id=v_item) then raise exception using errcode='P0002',message='Menu item not found';end if;
   v_id:=private.enqueue_job('forecast',jsonb_build_object('menu_item_id',v_item,'as_of',v_today),'forecast:'||v_item||':'||v_today,v_actor);
   v_jobs:=v_jobs||jsonb_build_array(jsonb_build_object('job_id',v_id,'menu_item_id',v_item));
  end loop;
  return jsonb_build_object('jobs',v_jobs,'status','accepted');
 when 'job_retry' then
  select * into v_job from private.processing_jobs where id=(p_payload->>'job_id')::uuid for update;
  if not found then raise exception using errcode='P0002',message='Job not found';end if;
  if v_job.status<>'failed' then raise exception using errcode='40001',message='Only failed jobs can be retried';end if;
  update private.processing_jobs set status='queued',attempts=0,owner_token=null,lease_expires_at=null,available_at=now(),last_error_code=null where id=v_job.id;
  if v_job.kind='review_analysis' then update private.reviews set analysis_status='pending' where id=(v_job.payload->>'review_id')::uuid;end if;
  perform private.audit(v_actor,'job_retry','processing_jobs',v_job.id,to_jsonb(v_job),jsonb_build_object('status','queued'));
  return jsonb_build_object('job_id',v_job.id,'status','queued');
 when 'day_close' then
  v_day:=(p_payload->>'day')::date;v_status:=p_payload->>'status';
  if v_day is null or v_day>=v_today or v_status not in ('complete','closed') or length(btrim(coalesce(p_payload->>'note',''))) not between 1 and 500 then
   raise exception using errcode='22023',message='Close only past days with an explicit status and note';end if;
  perform pg_advisory_xact_lock(hashtextextended('coverage:'||v_day,0));
  if exists(select 1 from private.daily_coverage where day=v_day) then raise exception using errcode='40001',message='Day is already covered';end if;
  if v_status='closed' and exists(select 1 from private.orders where status='completed' and (completed_at at time zone 'Asia/Karachi')::date=v_day) then
   raise exception using errcode='22023',message='A day with completed sales cannot be marked closed';end if;
  insert into private.daily_coverage(day,source,status,note,closed_by) values(v_day,'live',v_status,p_payload->>'note',v_actor);
  perform private.audit(v_actor,'day_close','daily_coverage',null,null,jsonb_build_object('day',v_day,'status',v_status));
  return jsonb_build_object('day',v_day,'status',v_status,'source','live');
 when 'history_import' then
  if jsonb_typeof(p_payload->'rows') is distinct from 'array' or jsonb_array_length(p_payload->'rows') not between 1 and 10000
   or length(btrim(coalesce(p_payload->>'source_name',''))) not between 1 and 120 then
   raise exception using errcode='22023',message='Import needs a source and 1 to 10000 explicit item/day rows';end if;
  insert into private.history_imports(source_name,actor_id,row_count) values(p_payload->>'source_name',v_actor,jsonb_array_length(p_payload->'rows')) returning id into v_id;
  -- All imports acquire day locks in chronological order before checking overlap.
  for v_day in select distinct (value->>'day')::date from jsonb_array_elements(p_payload->'rows') order by 1 loop
   if v_day is null or v_day>=v_today then raise exception using errcode='22023',message='Historical observations must precede today';end if;
   perform pg_advisory_xact_lock(hashtextextended('coverage:'||v_day,0));
   if exists(select 1 from private.daily_coverage where day=v_day and source='live') or
    exists(select 1 from private.orders where status='completed' and (completed_at at time zone 'Asia/Karachi')::date=v_day) then
    raise exception using errcode='40001',message='Imported observations cannot overlap live sales or live coverage';end if;
  end loop;
  for v_row in select value from jsonb_array_elements(p_payload->'rows') loop
   v_day:=(v_row->>'day')::date;v_item:=(v_row->>'menu_item_id')::uuid;v_count:=(v_row->>'quantity')::integer;v_status:=v_row->>'day_status';
   if v_item is null or v_count is null or v_count not between 0 and 1000000 or v_status is null or v_status not in ('complete','closed') or (v_status='closed' and v_count<>0) then
    raise exception using errcode='22023',message='Invalid historical observation';end if;
   select * into v_existing from private.historical_sales where day=v_day and menu_item_id=v_item;
   if found and (v_existing.quantity<>v_count or v_existing.day_status<>v_status) then
    raise exception using errcode='40001',message='Conflicting duplicate historical observation';end if;
   if exists(select 1 from private.daily_coverage where day=v_day and status<>v_status) then
    raise exception using errcode='40001',message='Day status conflicts with existing coverage';end if;
   insert into private.historical_sales(day,menu_item_id,quantity,day_status,import_id) values(v_day,v_item,v_count,v_status,v_id) on conflict(day,menu_item_id) do nothing;
   insert into private.daily_coverage(day,source,status,note,closed_by) values(v_day,'historical',v_status,p_payload->>'source_name',v_actor) on conflict(day) do nothing;
  end loop;
  perform private.audit(v_actor,'history_import','history_imports',v_id,null,jsonb_build_object('row_count',jsonb_array_length(p_payload->'rows')));
  return jsonb_build_object('import_id',v_id,'observations',jsonb_array_length(p_payload->'rows'));
 else raise exception using errcode='22023',message='Unknown command';
 end case;
end $$;
