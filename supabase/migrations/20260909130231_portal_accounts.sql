-- Portal assignments preserve the existing manager/staff permission boundary.
alter table private.profiles add column staff_type text not null default 'waiter' check(staff_type in ('waiter','kitchen'));
alter table private.user_provisioning add column staff_type text not null default 'waiter' check(staff_type in ('waiter','kitchen'));
create or replace function private.command_core(p_operation text,p_payload jsonb,p_actor uuid) returns jsonb
language plpgsql set search_path='' as $$
#variable_conflict use_variable
declare actor uuid:=private.require_actor(false); id uuid:=(p_payload->>'id')::uuid; expected integer:=(p_payload->>'expected_version')::int;
 mgr boolean; m private.menu_items; ing private.ingredients; o private.orders; ex private.expenses; prof private.profiles; rec private.recommendations;
 before_data jsonb; item record; qty numeric; cost numeric; delta numeric; token text; result jsonb; newstatus text; target uuid;
begin
 if actor<>p_actor then raise exception using errcode='42501',message='Actor mismatch'; end if;
 select role='manager' into mgr from private.profiles where profiles.id=actor;
 if p_operation in ('menu_create','menu_update','recipe_set','ingredient_create','ingredient_update','expense_void','user_update','recommendation_create','recommendation_approve','recommendation_reject','recommendation_apply') then perform private.require_actor(true); end if;
 if p_operation='menu_create' then
 insert into private.menu_items(name,category,selling_price,packaging_cost,is_active) values(p_payload->>'name',coalesce(p_payload->>'category','General'),(p_payload->>'selling_price')::numeric,coalesce((p_payload->>'packaging_cost')::numeric,0),coalesce((p_payload->>'is_active')::boolean,true)) returning menu_items.id into id;
 result:=private.read_core('menu',jsonb_build_object('id',id));
 elsif p_operation='menu_update' then
 select * into m from private.menu_items where menu_items.id=id for update; if not found then raise exception using errcode='P0002',message='Menu item not found'; end if;
 perform private.expect_version(m.version,expected); before_data:=to_jsonb(m);
 update private.menu_items set name=coalesce(p_payload->>'name',name),category=coalesce(p_payload->>'category',category),selling_price=coalesce((p_payload->>'selling_price')::numeric,selling_price),packaging_cost=coalesce((p_payload->>'packaging_cost')::numeric,packaging_cost),is_active=coalesce((p_payload->>'is_active')::boolean,is_active),version=version+1,updated_at=now() where menu_items.id=id;
 result:=private.read_core('menu',jsonb_build_object('id',id));
 elsif p_operation='recipe_set' then
 perform private.set_recipe(id,p_payload->'ingredients',expected,actor); return private.read_core('recipes',jsonb_build_object('id',id));
 elsif p_operation='ingredient_create' then
 insert into private.ingredients(name,unit,reorder_level) values(p_payload->>'name',p_payload->>'unit',coalesce((p_payload->>'reorder_level')::numeric,0)) returning ingredients.id into id;
 result:=private.read_core('inventory',jsonb_build_object('id',id));
 elsif p_operation='ingredient_update' then
 select * into ing from private.ingredients where ingredients.id=id for update; if not found then raise exception using errcode='P0002',message='Ingredient not found'; end if;
 perform private.expect_version(ing.version,expected); before_data:=to_jsonb(ing);
 if p_payload ? 'unit' and p_payload->>'unit'<>ing.unit then raise exception using errcode='22023',message='Canonical unit is immutable; create a new ingredient'; end if;
 update private.ingredients set name=coalesce(p_payload->>'name',name),reorder_level=coalesce((p_payload->>'reorder_level')::numeric,reorder_level),is_active=coalesce((p_payload->>'is_active')::boolean,is_active),version=version+1,updated_at=now() where ingredients.id=id;
 result:=private.read_core('inventory',jsonb_build_object('id',id));
 elsif p_operation='inventory_record' then
 select * into ing from private.ingredients where ingredients.id=(p_payload->>'ingredient_id')::uuid for update;
 if not found then raise exception using errcode='P0002',message='Ingredient not found'; end if;
 qty:=(p_payload->>'quantity')::numeric;
 if qty is null or qty=0 or length(btrim(coalesce(p_payload->>'reason','')))=0 then raise exception using errcode='22023',message='Nonzero quantity and reason required'; end if;
 before_data:=to_jsonb(ing); cost:=ing.average_unit_cost;
 if p_payload->>'kind'='purchase' then
 if qty<=0 or p_payload->>'unit_cost' is null or (p_payload->>'unit_cost')::numeric<0 then raise exception using errcode='22023',message='Purchase requires positive quantity and nonnegative unit_cost'; end if;
 cost:=(p_payload->>'unit_cost')::numeric; delta:=qty;
 update private.ingredients set average_unit_cost=(stock_quantity*average_unit_cost+qty*cost)/(stock_quantity+qty) where ingredients.id=ing.id;
 elsif p_payload->>'kind'='wastage' then
 if qty<=0 then raise exception using errcode='22023',message='Wastage quantity must be positive'; end if; delta:=-qty;
 elsif p_payload->>'kind'='adjustment' then delta:=qty;
 else raise exception using errcode='22023',message='Invalid inventory transaction kind'; end if;
 if ing.stock_quantity+delta<0 then raise exception using errcode='40001',message='Insufficient stock'; end if;
 update private.ingredients set stock_quantity=stock_quantity+delta,version=version+1,updated_at=now() where ingredients.id=ing.id;
 insert into private.inventory_transactions(ingredient_id,kind,quantity,unit_cost,value,reason,created_by) values(ing.id,p_payload->>'kind',delta,cost,delta*cost,p_payload->>'reason',actor) returning inventory_transactions.id into id;
 result:=private.read_core('inventory_transactions',jsonb_build_object('id',id));
 elsif p_operation in ('order_create','order_update') then
 if p_operation='order_create' then
 insert into private.orders(discount,platform_fee,delivery_cost,tax,notes,created_by) values(coalesce((p_payload->>'discount')::numeric,0),coalesce((p_payload->>'platform_fee')::numeric,0),coalesce((p_payload->>'delivery_cost')::numeric,0),coalesce((p_payload->>'tax')::numeric,0),coalesce(p_payload->>'notes',''),actor) returning orders.id into id;
 else
 select * into o from private.orders where orders.id=id for update; if not found then raise exception using errcode='P0002',message='Order not found'; end if;
 perform private.expect_version(o.version,expected); if o.status<>'pending' then raise exception using errcode='40001',message='Only pending orders can be edited'; end if; before_data:=to_jsonb(o);
 update private.orders set discount=coalesce((p_payload->>'discount')::numeric,discount),platform_fee=coalesce((p_payload->>'platform_fee')::numeric,platform_fee),delivery_cost=coalesce((p_payload->>'delivery_cost')::numeric,delivery_cost),tax=coalesce((p_payload->>'tax')::numeric,tax),notes=coalesce(p_payload->>'notes',notes),version=version+1,updated_at=now() where orders.id=id;
 end if;
 if p_payload ? 'items' then perform private.set_order_items(id,p_payload->'items'); elsif p_operation='order_create' then raise exception using errcode='22023',message='Order items required'; end if;
 perform private.allocate_order(id); result:=private.order_json(id,mgr);
 elsif p_operation='order_transition' then
 select * into o from private.orders where orders.id=id for update; if not found then raise exception using errcode='P0002',message='Order not found'; end if;
 perform private.expect_version(o.version,expected); before_data:=to_jsonb(o); newstatus:=p_payload->>'status';
 if not ((o.status='pending' and newstatus='preparing') or (o.status='preparing' and newstatus='ready') or (o.status='ready' and newstatus='completed') or (o.status in ('pending','preparing','ready') and newstatus='cancelled')) then raise exception using errcode='40001',message='Invalid order transition'; end if;
 if newstatus='cancelled' and length(btrim(coalesce(p_payload->>'reason','')))=0 then raise exception using errcode='22023',message='Cancellation reason required'; end if;
 if newstatus='preparing' then
 -- Lock menu versions before recipes; menu changes take the same row lock.
 perform 1 from private.menu_items mi join private.order_items oi on oi.menu_item_id=mi.id where oi.order_id=id order by mi.id for share of mi;
 if exists(select 1 from private.order_items oi where oi.order_id=id and not exists(select 1 from private.recipes r where r.menu_item_id=oi.menu_item_id)) then raise exception using errcode='22023',message='Every item needs a recipe before preparation'; end if;
 perform 1 from private.ingredients i where i.id in(select r.ingredient_id from private.recipes r join private.order_items oi on oi.menu_item_id=r.menu_item_id where oi.order_id=id) order by i.id for update;
 for item in select r.ingredient_id,sum(r.quantity*oi.quantity) needed from private.recipes r join private.order_items oi on oi.menu_item_id=r.menu_item_id where oi.order_id=id group by r.ingredient_id order by r.ingredient_id loop
 select * into ing from private.ingredients where ingredients.id=item.ingredient_id;
 if not ing.is_active or ing.stock_quantity<item.needed then raise exception using errcode='40001',message='Insufficient or inactive ingredient stock'; end if;
 update private.ingredients set stock_quantity=stock_quantity-item.needed,version=version+1,updated_at=now() where ingredients.id=ing.id;
 insert into private.inventory_transactions(ingredient_id,order_id,kind,quantity,unit_cost,value,reason,created_by) values(ing.id,id,'consumption',-item.needed,ing.average_unit_cost,-item.needed*ing.average_unit_cost,'Order preparation',actor);
 end loop;
 insert into private.order_consumptions(order_id,order_item_id,ingredient_id,quantity,unit_cost,cost)
 select id,oi.id,r.ingredient_id,r.quantity*oi.quantity,i.average_unit_cost,r.quantity*oi.quantity*i.average_unit_cost from private.order_items oi join private.recipes r on r.menu_item_id=oi.menu_item_id join private.ingredients i on i.id=r.ingredient_id where oi.order_id=id;
 update private.order_items oi set ingredient_cost_snapshot=(select sum(c.cost) from private.order_consumptions c where c.order_item_id=oi.id),packaging_cost_snapshot=menu_row.packaging_cost,recipe_version=menu_row.version from private.menu_items menu_row where oi.order_id=id and menu_row.id=oi.menu_item_id;
 end if;
 update private.orders set status=newstatus,version=version+1,updated_at=now(),prepared_at=case when newstatus='preparing' then now() else prepared_at end,completed_at=case when newstatus='completed' then now() else completed_at end,cancelled_at=case when newstatus='cancelled' then now() else cancelled_at end,cancellation_reason=case when newstatus='cancelled' then p_payload->>'reason' else cancellation_reason end where orders.id=id;
 result:=private.order_json(id,mgr);
 elsif p_operation='expense_create' then
 if (p_payload->>'incurred_on')::date>(now() at time zone 'Asia/Karachi')::date then raise exception using errcode='22023',message='Expense cannot be future dated'; end if;
 if lower(p_payload->>'category') in ('inventory','ingredients','purchase') then raise exception using errcode='22023',message='Ingredient purchases must use inventory purchases'; end if;
 insert into private.expenses(category,amount,incurred_on,description,created_by) values(p_payload->>'category',(p_payload->>'amount')::numeric,(p_payload->>'incurred_on')::date,coalesce(p_payload->>'description',''),actor) returning expenses.id into id;
 result:=private.read_core('expenses',jsonb_build_object('id',id));
 elsif p_operation='expense_void' then
 select * into ex from private.expenses where expenses.id=id for update; if not found then raise exception using errcode='P0002',message='Expense not found'; end if;
 perform private.expect_version(ex.version,expected); if ex.voided_at is not null then raise exception using errcode='40001',message='Expense already voided'; end if;
 if length(btrim(coalesce(p_payload->>'reason','')))=0 then raise exception using errcode='22023',message='Void reason required'; end if;
 before_data:=to_jsonb(ex); update private.expenses set voided_at=now(),void_reason=p_payload->>'reason',version=version+1 where expenses.id=id; result:=private.read_core('expenses',jsonb_build_object('id',id));
 elsif p_operation='user_update' then
 perform pg_advisory_xact_lock(hashtextextended('smartdine:managers',0));
 select * into prof from private.profiles where profiles.id=id for update; if not found then raise exception using errcode='P0002',message='User not found'; end if;
 perform private.expect_version(prof.version,expected); before_data:=to_jsonb(prof);
 if prof.is_active and prof.role='manager' and (coalesce(p_payload->>'role',prof.role)<>'manager' or not coalesce((p_payload->>'is_active')::boolean,prof.is_active)) and (select count(*) from private.profiles where role='manager' and is_active)=1 then raise exception using errcode='40001',message='Cannot remove last active manager'; end if;
 update private.profiles set staff_type=coalesce(p_payload->>'staff_type',staff_type),full_name=coalesce(p_payload->>'full_name',full_name),role=coalesce(p_payload->>'role',role),is_active=coalesce((p_payload->>'is_active')::boolean,is_active),version=version+1,updated_at=now() where profiles.id=id; result:=private.read_core('users',jsonb_build_object('id',id));
 elsif p_operation='review_token_create' then
 id:=coalesce(id,(p_payload->>'order_id')::uuid);
 select * into o from private.orders where orders.id=id for update;
 if not found or o.status<>'completed' then raise exception using errcode='22023',message='Completed order required'; end if;
 if exists(select 1 from private.review_tokens where order_id=id) then raise exception using errcode='40001',message='Review token already issued; retry the original idempotency key'; end if;
 token:=encode(extensions.gen_random_bytes(32),'hex');
 insert into private.review_tokens(order_id,token_hash,expires_at) values(id,encode(extensions.digest(token,'sha256'),'hex'),now()+interval '7 days');
 result:=jsonb_build_object('order_id',id,'token',token,'expires_at',now()+interval '7 days');
 elsif p_operation='recommendation_generate' then
 perform private.require_actor(true);
 perform pg_advisory_xact_lock(hashtextextended('smartdine:recommendation-generation',0));
 before_data:=private.analytics(p_payload-'report'); result:='[]';
 for item in select value from jsonb_array_elements(before_data->'items') loop
 if item.value->>'matrix'='low_volume/high_margin' and not exists(select 1 from private.recommendations where target_id=(item.value->>'menu_item_id')::uuid and action_type='marketing' and status in ('proposed','approved')) then
 result:=result||jsonb_build_array(private.command_core('recommendation_create',jsonb_build_object(
 'action_type','marketing','target_id',item.value->>'menu_item_id','title','Consider a promotion for '||(item.value->>'name'),
 'description','Low recorded volume and above-threshold contribution margin. Test a limited promotion and measure the result.',
 'proposed_change',jsonb_build_object('instructions','Manager to choose a limited promotion; no discount or price change is applied automatically.'),
 'evidence',jsonb_build_array(jsonb_build_object('source','analytics','reference',(before_data->>'start_date')||'/'||(before_data->>'end_date'),
 'summary','Units: '||(item.value->>'quantity')||'; contribution PKR: '||(item.value->>'contribution_margin')))),actor));
 end if;
 end loop;
 for item in select * from private.ingredients where is_active and reorder_level>0 and stock_quantity<=reorder_level order by id loop
 if not exists(select 1 from private.recommendations where target_id=item.id and action_type='reorder' and status in ('proposed','approved')) then
 result:=result||jsonb_build_array(private.command_core('recommendation_create',jsonb_build_object(
 'action_type','reorder','target_id',item.id,'title','Review replenishment for '||item.name,
 'description','Current stock has reached or fallen below the configured reorder level.',
 'proposed_change',jsonb_build_object('instructions','Manager to review quantity and supplier. Record inventory purchase only after goods arrive.'),
 'evidence',jsonb_build_array(jsonb_build_object('source','inventory','reference',item.id::text,
 'summary','Stock: '||item.stock_quantity::text||' '||item.unit||'; reorder level: '||item.reorder_level::text))),actor));
 end if;
 end loop;
 return jsonb_build_object('generator','rules-v1','items',result,'total',jsonb_array_length(result),'period',jsonb_build_object('start_date',before_data->'start_date','end_date',before_data->'end_date'));
 elsif p_operation='recommendation_create' then
 if coalesce(jsonb_typeof(p_payload->'evidence'),'null') not in ('array','object') or p_payload->'evidence' in ('[]'::jsonb,'{}'::jsonb) then raise exception using errcode='22023',message='Evidence is required'; end if;
 if jsonb_typeof(p_payload->'proposed_change') is distinct from 'object' then raise exception using errcode='22023',message='Proposed change object required'; end if;
 if p_payload->>'action_type'='price_update' and (not ((p_payload->'proposed_change') ? 'selling_price') or ((p_payload->'proposed_change')-'selling_price')<>'{}'::jsonb) then raise exception using errcode='22023',message='Price recommendation may only change selling_price'; end if;
 if p_payload->>'action_type'='recipe_update' and (jsonb_typeof(p_payload->'proposed_change'->'ingredients') is distinct from 'array' or ((p_payload->'proposed_change')-'ingredients')<>'{}'::jsonb) then raise exception using errcode='22023',message='Recipe recommendation requires ingredients only'; end if;
 if p_payload->>'action_type'='menu_update' and (p_payload->'proposed_change'='{}'::jsonb or ((p_payload->'proposed_change')-array['name','category','is_active','packaging_cost'])<>'{}'::jsonb) then raise exception using errcode='22023',message='Invalid menu recommendation fields'; end if;
 if p_payload->>'action_type' in ('marketing','reorder') and length(btrim(coalesce(p_payload->'proposed_change'->>'instructions','')))=0 then raise exception using errcode='22023',message='Manual task instructions required'; end if;
 if p_payload->>'action_type' in ('price_update','recipe_update','menu_update') and (p_payload->>'target_id' is null or p_payload->>'expected_target_version' is null) then raise exception using errcode='22023',message='Target and expected version required'; end if;
 insert into private.recommendations(action_type,title,description,target_id,expected_target_version,proposed_change,evidence,created_by) values(p_payload->>'action_type',p_payload->>'title',coalesce(p_payload->>'description',''),(p_payload->>'target_id')::uuid,(p_payload->>'expected_target_version')::int,p_payload->'proposed_change',p_payload->'evidence',actor) returning recommendations.id into id;
 result:=private.read_core('recommendations',jsonb_build_object('id',id));
 elsif p_operation in ('recommendation_approve','recommendation_reject','recommendation_apply') then
 select * into rec from private.recommendations where recommendations.id=id for update; if not found then raise exception using errcode='P0002',message='Recommendation not found'; end if;
 perform private.expect_version(rec.version,expected); before_data:=to_jsonb(rec);
 if p_operation='recommendation_approve' then
 if rec.status<>'proposed' then raise exception using errcode='40001',message='Only proposed recommendations can be approved'; end if;
 update private.recommendations set status='approved',approved_by=actor,approved_at=now(),version=version+1 where recommendations.id=id;
 elsif p_operation='recommendation_reject' then
 if rec.status not in ('proposed','approved') then raise exception using errcode='40001',message='Recommendation cannot be rejected'; end if;
 update private.recommendations set status='rejected',version=version+1 where recommendations.id=id;
 else
 if rec.status<>'approved' then raise exception using errcode='40001',message='Approved recommendation required'; end if;
 if rec.action_type in ('marketing','reorder') then raise exception using errcode='22023',message='This recommendation is an approved manual task; stock receipt uses inventory purchase'; end if;
 if rec.action_type='recipe_update' then perform private.set_recipe(rec.target_id,rec.proposed_change->'ingredients',rec.expected_target_version,actor);
 else
 result:=private.command_core('menu_update',rec.proposed_change||jsonb_build_object('id',rec.target_id,'expected_version',rec.expected_target_version),actor);
 end if;
 update private.recommendations set status='applied',applied_at=now(),version=version+1 where recommendations.id=id;
 end if; result:=private.read_core('recommendations',jsonb_build_object('id',id));
 else return private.command_intelligence(p_operation,p_payload,actor); end if;
 perform private.audit(actor,p_operation,p_operation,id,before_data,case when p_operation='review_token_create' then result-'token' else result end);
 return private.json_decimals(result);
end $$;
create or replace function private.service_core(p_operation text,p_payload jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
#variable_conflict use_variable
declare actor uuid:=(p_payload->>'actor_id')::uuid; uid uuid:=(p_payload->>'user_id')::uuid; id uuid; prov private.user_provisioning;
 tok private.review_tokens; prof private.profiles; result jsonb; email text; fullname text;
begin
 perform private.require_service();
 if p_operation='health' then return jsonb_build_object('schema','smartdine','version',1,'ready',true); end if;
 if p_operation='bootstrap_manager' then
 perform pg_advisory_xact_lock(hashtextextended('smartdine:managers',0));
 if exists(select 1 from private.bootstrap_state) or exists(select 1 from private.profiles where role='manager' and is_active) then raise exception using errcode='40001',message='Manager has already been bootstrapped'; end if;
 select * into prof from private.profiles where profiles.id=uid for update;
 if not found then raise exception using errcode='22023',message='Provision the managed Auth user first'; end if;
 update private.profiles set role='manager',is_active=true,full_name=coalesce(nullif(p_payload->>'full_name',''),full_name),version=version+1,updated_at=now() where profiles.id=uid;
 insert into private.bootstrap_state(singleton) values(true);
 perform private.audit(uid,'bootstrap_manager','profiles',uid,to_jsonb(prof),(select to_jsonb(p) from private.profiles p where p.id=uid));
 return (select to_jsonb(p) from private.profiles p where p.id=uid);
 elsif p_operation in ('reserve_user','activate_user') then
 if actor is null or not exists(select 1 from private.profiles where profiles.id=actor and role='manager' and is_active) then raise exception using errcode='42501',message='Active manager required'; end if;
 if p_operation='reserve_user' then
 email:=lower(btrim(p_payload->>'email')); fullname:=btrim(p_payload->>'full_name');
 if email is null or position('@' in email)<2 or fullname is null or length(fullname)=0 or length(coalesce(p_payload->>'request_key','')) not between 1 and 200 then raise exception using errcode='22023',message='Valid email, name and request key required'; end if;
 perform pg_advisory_xact_lock(hashtextextended('provision:'||email,0));
 select * into prov from private.user_provisioning where requested_by=actor and request_key=p_payload->>'request_key';
 if found then
 if prov.email<>email or prov.full_name<>fullname or prov.role<>p_payload->>'role' or prov.staff_type<>coalesce(p_payload->>'staff_type','waiter') then raise exception using errcode='23505',message='Provisioning key payload conflict'; end if;
 return to_jsonb(prov);
 end if;
 if exists(select 1 from private.user_provisioning where user_provisioning.email=email) or exists(select 1 from private.profiles where profiles.email=email) then raise exception using errcode='23505',message='Email already exists or is being provisioned'; end if;
 insert into private.user_provisioning(email,full_name,role,requested_by,request_key,staff_type) values(email,fullname,p_payload->>'role',actor,p_payload->>'request_key',coalesce(p_payload->>'staff_type','waiter')) returning * into prov;
 return to_jsonb(prov);
 else
 select * into prov from private.user_provisioning where user_provisioning.id=(p_payload->>'provision_id')::uuid for update;
 if not found or prov.requested_by<>actor then raise exception using errcode='P0002',message='Provisioning request not found'; end if;
 if prov.status='active' then if prov.user_id<>uid then raise exception using errcode='23505',message='Provisioning user conflict'; end if; return (select to_jsonb(p) from private.profiles p where p.id=uid); end if;
 select * into prof from private.profiles where profiles.id=uid for update;
 if not found or lower(prof.email)<>prov.email then raise exception using errcode='22023',message='Auth user must match provisioning email'; end if;
 update private.profiles set role=prov.role,staff_type=prov.staff_type,full_name=prov.full_name,is_active=true,version=version+1,updated_at=now() where profiles.id=uid;
 update private.user_provisioning set status='active',user_id=uid where user_provisioning.id=prov.id;
 result:=(select to_jsonb(p) from private.profiles p where p.id=uid); perform private.audit(actor,'activate_user','profiles',uid,to_jsonb(prof),result); return result;
 end if;
 elsif p_operation='review_submit' then
 select * into tok from private.review_tokens where token_hash=encode(extensions.digest(p_payload->>'token','sha256'),'hex') for update;
 if not found or tok.used_at is not null or tok.expires_at<=now() then raise exception using errcode='22023',message='Review token is invalid, expired or already used'; end if;
 if p_payload->>'menu_item_id' is not null and not exists(select 1 from private.order_items where order_id=tok.order_id and menu_item_id=(p_payload->>'menu_item_id')::uuid) then raise exception using errcode='22023',message='Review item was not purchased in this order'; end if;
 insert into private.reviews(order_id,menu_item_id,rating,comment) values(tok.order_id,(p_payload->>'menu_item_id')::uuid,(p_payload->>'rating')::int,p_payload->>'comment') returning reviews.id into id;
 update private.review_tokens set used_at=now() where review_tokens.id=tok.id;
 perform private.enqueue_job('review_analysis',jsonb_build_object('review_id',id),'review:'||id::text,null);
 perform private.audit(null,'review_submit','reviews',id,null,jsonb_build_object('id',id,'order_id',tok.order_id));
 return jsonb_build_object('id',id,'analysis_status','pending');
 else return private.json_decimals(private.service_intelligence(p_operation,p_payload)); end if;
end $$;
create function private.sync_auth_account() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.email is distinct from old.email or new.encrypted_password is distinct from old.encrypted_password then
   update private.profiles set email=lower(new.email),version=version+1,updated_at=now() where id=new.id;
   delete from auth.sessions where user_id=new.id;
   perform private.audit(null,'account_credentials_changed','profiles',new.id,null,
     jsonb_build_object('email_changed',new.email is distinct from old.email,'password_changed',new.encrypted_password is distinct from old.encrypted_password));
 end if;
 return new;
end $$;
revoke all on function private.sync_auth_account() from public,anon,authenticated;
create trigger sd_auth_account_updated after update of email,encrypted_password on auth.users for each row execute function private.sync_auth_account();