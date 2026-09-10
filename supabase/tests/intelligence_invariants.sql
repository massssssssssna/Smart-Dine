-- Run only in an isolated test database; all fixtures are rolled back.
begin;
do $$
<<intelligence_invariants>>
declare
 manager_id uuid:=gen_random_uuid(); staff_id uuid:=gen_random_uuid(); item_id uuid:=gen_random_uuid();
 order_id uuid:=gen_random_uuid();review_id uuid:=gen_random_uuid();job_id uuid;result jsonb;claimed jsonb;
 old_token uuid;new_token uuid;past_day date:=(now() at time zone 'Asia/Karachi')::date-200;
begin
 insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data) values
  (manager_id,'intelligence-manager-'||manager_id||'@example.test','{"managed_account":true}','{}'),
  (staff_id,'intelligence-staff-'||staff_id||'@example.test','{"managed_account":true}','{}');
 update private.profiles set is_active=true,role='manager' where id=manager_id;
 update private.profiles set is_active=true,role='staff' where id=staff_id;
 insert into private.menu_items(id,name,selling_price) values(item_id,'Intelligence fixture '||item_id,100);
 insert into private.orders(id,status,created_by,completed_at) values(order_id,'completed',manager_id,now());
 insert into private.reviews(id,order_id,rating,comment) values(review_id,order_id,4,'Khana acha tha lekin service slow thi');

 perform set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',staff_id)::text,true);
 begin
  perform private.read_intelligence('jobs','{}');
  raise exception 'FAIL staff can inspect intelligence jobs';
 exception when insufficient_privilege then null;end;
 begin
  perform private.service_intelligence('job_claim','{}');
  raise exception 'FAIL authenticated user can claim jobs';
 exception when insufficient_privilege then null;end;

 perform set_config('request.jwt.claims','{"role":"service_role"}',true);
 job_id:=private.enqueue_job('review_analysis',jsonb_build_object('review_id',review_id),'test-review:'||review_id,null);
 -- Position this fixture before unrelated queue entries in an isolated database.
 update private.processing_jobs set available_at='2000-01-01' where id=job_id;
 claimed:=private.service_intelligence('job_claim','{"lease_seconds":30}');
 assert (claimed->>'id')::uuid=job_id,'Fixture was not claimed';
 old_token:=(claimed->>'owner_token')::uuid;
 result:=private.service_intelligence('job_heartbeat',jsonb_build_object('job_id',job_id,'owner_token',gen_random_uuid(),'lease_seconds',30));
 assert not (result->>'renewed')::boolean,'Wrong owner renewed lease';
 update private.processing_jobs set lease_expires_at=now()-interval '1 second' where id=job_id;
 claimed:=private.service_intelligence('job_claim','{"lease_seconds":30}');
 new_token:=(claimed->>'owner_token')::uuid;
 assert new_token<>old_token,'Reclaimed lease did not rotate fencing token';
 begin
  perform private.service_intelligence('job_complete',jsonb_build_object('job_id',job_id,'owner_token',old_token,'result','{}'::jsonb));
  raise exception 'FAIL stale owner completed job';
 exception when serialization_failure then null;end;

 begin
  perform private.service_intelligence('job_complete',jsonb_build_object('job_id',job_id,'owner_token',new_token,'result',
   '{"model":"test","prompt_version":"test","aspects":[{"aspect":"taste","sentiment":"positive","evidence":"invented","start":0,"end":8}]}'::jsonb));
  raise exception 'FAIL fabricated evidence accepted';
 exception when invalid_parameter_value then null;end;
 assert not exists(select 1 from private.review_analyses a where a.review_id=intelligence_invariants.review_id),'Invalid result partially persisted';
 assert (select status from private.processing_jobs where id=job_id)='running','Failed validation completed job';

 result:=private.service_intelligence('job_complete',jsonb_build_object('job_id',job_id,'owner_token',new_token,'result',
  '{"model":"test","prompt_version":"test","aspects":[{"aspect":"taste","sentiment":"positive","evidence":"acha","start":6,"end":10}]}'::jsonb));
 assert result->>'status'='completed','Valid result did not complete';
 assert (select analysis_status from private.reviews where id=review_id)='completed','Review status not atomic with result';
 begin
  perform private.service_intelligence('job_complete',jsonb_build_object('job_id',job_id,'owner_token',new_token,'result','{}'::jsonb));
  raise exception 'FAIL completed job applied twice';
 exception when serialization_failure then null;end;

 -- Max attempts plus lease loss must terminate without leaving a stuck running job.
 job_id:=private.enqueue_job('forecast',jsonb_build_object('menu_item_id',item_id,'as_of',current_date),'test-max-attempts:'||item_id,manager_id);
 update private.processing_jobs set status='running',attempts=max_attempts,lease_expires_at=now()-interval '1 second',owner_token=gen_random_uuid() where id=job_id;
 perform private.service_intelligence('job_claim','{"lease_seconds":30}');
 assert (select status from private.processing_jobs where id=job_id)='failed','Expired last attempt remained running';

 perform set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',manager_id)::text,true);
 result:=private.command_intelligence('history_import',jsonb_build_object('source_name','test','rows',jsonb_build_array(
  jsonb_build_object('day',past_day,'menu_item_id',item_id,'quantity',0,'day_status','complete'))),manager_id);
 assert result->>'observations'='1','Zero observation was not imported';
 begin
  perform private.command_intelligence('history_import',jsonb_build_object('source_name','conflict','rows',jsonb_build_array(
   jsonb_build_object('day',past_day,'menu_item_id',item_id,'quantity',2,'day_status','complete'))),manager_id);
  raise exception 'FAIL conflicting duplicate import accepted';
 exception when serialization_failure then null;end;
 begin
  perform private.command_intelligence('day_close',jsonb_build_object('day',past_day,'status','closed','note','conflict'),manager_id);
  raise exception 'FAIL historical coverage converted to live';
 exception when serialization_failure then null;end;
 perform set_config('request.jwt.claims','{"role":"service_role"}',true);
 result:=private.service_intelligence('forecast_input',jsonb_build_object('menu_item_id',item_id,'as_of',past_day+1));
 assert jsonb_array_length(result->'rows')=1,'Missing historical days incorrectly zero-filled';
 assert result->'rows'->0->>'quantity'='0','Explicit historical zero disappeared';
 raise notice 'PASS: intelligence authorization, fencing, evidence, job expiry, import conflicts and coverage';
end $$;
rollback;
