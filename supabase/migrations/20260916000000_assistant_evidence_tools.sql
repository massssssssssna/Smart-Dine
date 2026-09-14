-- Migration: Support all 9 intelligence tools in assistant evidence whitelist and refine citation requirements
create or replace function private.service_intelligence(p_operation text, p_payload jsonb)
 returns jsonb
 language plpgsql
 set search_path to ''
as $function$
declare v_job private.processing_jobs%rowtype;v_id uuid;v_token uuid;v_lease integer;
 v_result jsonb:=p_payload->'result';v_row jsonb;v_comment text;v_as_of date;v_start date;v_actor uuid;
 v_run private.assistant_runs%rowtype;v_review uuid;v_now timestamptz:=clock_timestamp();
begin
 perform private.require_service();
 case p_operation
 when 'job_claim' then
  v_lease:=coalesce((p_payload->>'lease_seconds')::integer,120);
  if v_lease not between 15 and 3600 then raise exception using errcode='22023',message='Invalid job lease';end if;
  -- Expired final attempts are terminal; they must not stay running forever.
  with expired as (
   update private.processing_jobs set status='failed',owner_token=null,lease_expires_at=null,last_error_code='LeaseExpired'
   where status='running' and lease_expires_at<=v_now and attempts>=max_attempts returning kind,payload
  ) update private.reviews set analysis_status='failed' where id in (select (payload->>'review_id')::uuid from expired where kind='review_analysis');
  select * into v_job from private.processing_jobs
   where attempts<max_attempts and ((status='queued' and available_at<=v_now) or (status='running' and lease_expires_at<=v_now))
   order by available_at,created_at,id for update skip locked limit 1;
  if not found then return null;end if;
  update private.processing_jobs set status='running',attempts=attempts+1,owner_token=gen_random_uuid(),lease_expires_at=v_now+make_interval(secs=>v_lease)
   where id=v_job.id returning * into v_job;
  return to_jsonb(v_job);
 when 'job_heartbeat' then
  v_lease:=coalesce((p_payload->>'lease_seconds')::integer,120);
  if v_lease not between 15 and 3600 then raise exception using errcode='22023',message='Invalid job lease';end if;
  update private.processing_jobs set lease_expires_at=v_now+make_interval(secs=>v_lease)
   where id=(p_payload->>'job_id')::uuid and status='running' and owner_token=(p_payload->>'owner_token')::uuid and lease_expires_at>v_now returning id into v_id;
  return jsonb_build_object('renewed',v_id is not null);
 when 'job_complete','job_fail' then
  select * into v_job from private.processing_jobs where id=(p_payload->>'job_id')::uuid for update;
  if not found or v_job.status<>'running' or v_job.owner_token is distinct from (p_payload->>'owner_token')::uuid or v_job.lease_expires_at<=clock_timestamp() then
   raise exception using errcode='40001',message='Job lease is no longer owned';end if;
  if p_operation='job_fail' then
   update private.processing_jobs set status=case when attempts>=max_attempts then 'failed' else 'queued' end,
    owner_token=null,lease_expires_at=null,last_error_code=left(coalesce(p_payload->>'error_code','ProcessingFailed'),120),
    available_at=clock_timestamp()+make_interval(secs=>least(900,5*(2^attempts)::integer)) where id=v_job.id;
   if v_job.kind='review_analysis' and v_job.attempts>=v_job.max_attempts then
    update private.reviews set analysis_status='failed' where id=(v_job.payload->>'review_id')::uuid;end if;
   return jsonb_build_object('job_id',v_job.id,'retrying',v_job.attempts<v_job.max_attempts);
  end if;
  if v_result is null or jsonb_typeof(v_result)<>'object' then raise exception using errcode='22023',message='Invalid job result';end if;
  if v_job.kind='review_analysis' then
   v_review:=(v_job.payload->>'review_id')::uuid;
   select comment into v_comment from private.reviews where id=v_review;
   if not found then raise exception using errcode='P0002',message='Review not found';end if;
   if jsonb_typeof(v_result->'aspects') is distinct from 'array' or jsonb_array_length(v_result->'aspects')>16
    or v_result->>'model' is null or v_result->>'prompt_version' is null then
    raise exception using errcode='22023',message='Invalid review analysis';end if;
   for v_row in select value from jsonb_array_elements(v_result->'aspects') loop
    if coalesce(v_row->>'aspect','') not in ('taste','price_value','service_speed','cleanliness')
     or coalesce(v_row->>'sentiment','') not in ('positive','neutral','negative','mixed')
     or coalesce(length(v_row->>'evidence'),0)=0 or (v_row->>'start')::integer<0
     or (v_row->>'end')::integer<>(v_row->>'start')::integer+length(v_row->>'evidence')
     or substring(v_comment from (v_row->>'start')::integer+1 for length(v_row->>'evidence')) is distinct from v_row->>'evidence' then
     raise exception using errcode='22023',message='Review evidence is not an exact original-text span';end if;
   end loop;
   insert into private.review_analyses(review_id,job_id,result,model,prompt_version)
    values(v_review,v_job.id,v_result,v_result->>'model',v_result->>'prompt_version');
   update private.reviews set analysis_status='completed' where id=v_review;
  elsif v_job.kind='forecast' then
   if v_result->>'status' not in ('completed','insufficient_history') or v_result->>'menu_item_id' is distinct from v_job.payload->>'menu_item_id' then
    raise exception using errcode='22023',message='Forecast does not match job';end if;
   insert into private.forecast_runs(job_id,menu_item_id,as_of,status,result)
    values(v_job.id,(v_job.payload->>'menu_item_id')::uuid,(v_job.payload->>'as_of')::date,v_result->>'status',v_result);
  end if;
  update private.processing_jobs set status='completed',result=v_result,completed_at=clock_timestamp(),owner_token=null,lease_expires_at=null where id=v_job.id;
  return jsonb_build_object('job_id',v_job.id,'status','completed');
 when 'review_analysis_input' then
  select jsonb_build_object('review_id',id,'comment',comment) into v_result from private.reviews where id=(p_payload->>'review_id')::uuid;
  if not found then raise exception using errcode='P0002',message='Review not found';end if;return v_result;
 when 'forecast_input' then
  v_id:=(p_payload->>'menu_item_id')::uuid;v_as_of:=(p_payload->>'as_of')::date;
  if v_id is null or v_as_of is null or not exists(select 1 from private.menu_items where id=v_id) then raise exception using errcode='22023',message='Invalid forecast input';end if;
  v_start:=(date_trunc('month',v_as_of::timestamp)-interval '6 months')::date;
  select coalesce(jsonb_agg(to_jsonb(q) order by q.day),'[]') into v_result from (
   select c.day,case when c.source='historical' then h.quantity else coalesce(s.quantity,0) end as quantity,true as covered
   from private.daily_coverage c
   left join private.historical_sales h on h.day=c.day and h.menu_item_id=v_id
   left join lateral(select sum(oi.quantity)::bigint as quantity from private.order_items oi join private.orders o on o.id=oi.order_id
    where oi.menu_item_id=v_id and o.status='completed' and (o.completed_at at time zone 'Asia/Karachi')::date=c.day) s on c.source='live'
   where c.day>=v_start and c.day<v_as_of and
    ((c.source='live' and c.day>=(select (created_at at time zone 'Asia/Karachi')::date from private.menu_items where id=v_id))
     or (c.source='historical' and h.menu_item_id is not null))
  ) q;
  return jsonb_build_object('menu_item_id',v_id,'rows',v_result);
 when 'assistant_start' then
  v_actor:=(p_payload->>'actor_id')::uuid;
  if not exists(select 1 from private.profiles where id=v_actor and is_active and role='manager') then raise exception using errcode='42501',message='Manager required';end if;
  insert into private.assistant_runs(id,actor_id,question,period,model,prompt_version)
   values((p_payload->>'run_id')::uuid,v_actor,p_payload->>'question',p_payload->'period',p_payload->>'model',p_payload->>'prompt_version');
  return jsonb_build_object('run_id',p_payload->>'run_id');
 when 'assistant_finish' then
  select * into v_run from private.assistant_runs where id=(p_payload->>'run_id')::uuid for update;
  if not found then raise exception using errcode='P0002',message='Assistant run not found';end if;
  if v_run.status<>'running' then raise exception using errcode='40001',message='Assistant run already finished';end if;
  if v_run.actor_id is distinct from (p_payload->>'actor_id')::uuid then raise exception using errcode='42501',message='Assistant actor mismatch';end if;
  if coalesce(p_payload->>'status','') not in ('completed','failed') then raise exception using errcode='22023',message='Invalid assistant status';end if;
  for v_row in select value from jsonb_array_elements(coalesce(p_payload->'evidence','[]')) loop
   if coalesce(v_row->>'tool','') not in (
     'sales_and_margins','inventory_status','customer_reviews','demand_forecasts','operating_expenses',
     'menu_catalog','recent_orders','manager_recommendations','staff_roster'
   ) then
    raise exception using errcode='22023',message='Unknown assistant evidence tool';end if;
   insert into private.assistant_evidence(run_id,evidence_id,tool,arguments,result)
    values(v_run.id,v_row->>'id',v_row->>'tool',v_row->'period',v_row->'data');
  end loop;
  if p_payload->>'status'='completed' and (v_result is null or jsonb_typeof(v_result->'evidence_ids') is distinct from 'array'
   or (jsonb_array_length(coalesce(p_payload->'evidence','[]')) > 0 and jsonb_array_length(v_result->'evidence_ids') < 1)
   or exists(
    select 1 from jsonb_array_elements_text(v_result->'evidence_ids') e where not exists(
     select 1 from private.assistant_evidence a where a.run_id=v_run.id and a.evidence_id=e.value))) then
   raise exception using errcode='22023',message='Assistant citations must refer to recorded evidence';end if;
  update private.assistant_runs set status=p_payload->>'status',result=v_result,error_code=left(p_payload->>'error_code',120),completed_at=clock_timestamp() where id=v_run.id;
  perform private.audit(v_run.actor_id,'assistant_'||(p_payload->>'status'),'assistant_runs',v_run.id,null,jsonb_build_object('model',v_run.model));
  return jsonb_build_object('run_id',v_run.id,'status',p_payload->>'status');
 else raise exception using errcode='22023',message='Unknown service operation';
 end case;
end $function$;

revoke all on function private.service_intelligence(text,jsonb) from public,anon,authenticated,service_role;
