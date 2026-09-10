-- Cashiers are branch staff with billing-only access.
alter table private.profiles drop constraint profiles_staff_type_check;
alter table private.profiles add constraint profiles_staff_type_check check(staff_type in ('waiter','kitchen','cashier'));
alter table private.user_provisioning drop constraint user_provisioning_staff_type_check;
alter table private.user_provisioning add constraint user_provisioning_staff_type_check check(staff_type in ('waiter','kitchen','cashier'));
alter table private.orders add column paid_by uuid references private.profiles(id) on delete set null;
alter table private.orders add column cash_received numeric(14,2) check(cash_received>=0);
alter table private.orders add column change_given numeric(14,2) check(change_given>=0);
alter table private.orders add constraint paid_by_branch_fk foreign key(branch_id,paid_by) references private.profiles(branch_id,id);
create index orders_paid_by_idx on private.orders(paid_by);
create index orders_branch_status_date_idx on private.orders(branch_id,status,created_at desc);
do $$ declare s text;begin
 s:=pg_get_functiondef('private.json_decimals(jsonb)'::regprocedure);
 s:=replace(s,'or k=''subtotal''','or k in (''subtotal'',''cash_received'',''change_given'')');execute s;
end $$;

alter function private.execute_command(text,jsonb,text) rename to execute_command_before_cashier;
do $$ declare s text;begin
 s:=pg_get_functiondef('private.execute_command_before_cashier(text,jsonb,text)'::regprocedure);
 s:=replace(s,'array[''inventory_record''','array[''order_pay'',''inventory_record''');execute s;
end $$;
create function private.execute_command(p_operation text,p_payload jsonb,p_idempotency_key text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=private.require_actor(false); prof private.profiles;
begin
 select * into prof from private.profiles where id=actor;
 if prof.role='staff' and prof.staff_type='cashier' and p_operation<>'order_pay' then raise exception using errcode='42501',message='Cashier access is limited to bills and payments';end if;
 if p_operation='order_pay' and prof.role<>'manager' and prof.staff_type<>'cashier' then raise exception using errcode='42501',message='Cashier access required';end if;
 if p_operation='order_transition' and p_payload->>'status'='completed' then raise exception using errcode='42501',message='Use cashier payment to mark an order paid';end if;
 return private.execute_command_before_cashier(p_operation,p_payload,p_idempotency_key);
end $$;
alter function private.execute_command(text,jsonb,text) owner to sd_branch_executor;
revoke all on function private.execute_command(text,jsonb,text) from public,anon,service_role;
grant execute on function private.execute_command(text,jsonb,text) to authenticated;
revoke all on function private.execute_command_before_cashier(text,jsonb,text) from authenticated,anon,public,service_role;

alter function private.command_core(text,jsonb,uuid) rename to command_core_before_cashier;
create function private.command_core(p_operation text,p_payload jsonb,p_actor uuid) returns jsonb language plpgsql set search_path='' as $$
declare prof private.profiles; o private.orders; total numeric; received numeric; result jsonb;
begin
 if private.require_actor(false)<>p_actor then raise exception using errcode='42501',message='Actor mismatch';end if;
 select * into prof from private.profiles where id=p_actor;
 if prof.role='staff' and prof.staff_type='cashier' and p_operation<>'order_pay' then raise exception using errcode='42501',message='Cashier access is limited to payments';end if;
 if p_operation='order_pay' then
  if prof.role<>'manager' and prof.staff_type<>'cashier' then raise exception using errcode='42501',message='Cashier access required';end if;
  select * into o from private.orders where id=(p_payload->>'id')::uuid for update;
  if not found then raise exception using errcode='P0002',message='Bill not found';end if;
  perform private.expect_version(o.version,(p_payload->>'expected_version')::integer);
  if o.status<>'ready' then raise exception using errcode='40001',message='Only ready, unpaid orders can be paid';end if;
  total:=(private.order_json(o.id,false)->>'total')::numeric;
  received:=(p_payload->>'cash_received')::numeric;
  if received is null or received<total or received<>round(received,2) then raise exception using errcode='22023',message='Cash received must cover the full bill';end if;
  update private.orders set paid_by=p_actor,cash_received=received,change_given=received-total where id=o.id;
  result:=private.command_core_before_cashier('order_transition',jsonb_build_object('id',o.id,'expected_version',o.version,'status','completed'),p_actor);
  perform private.audit(p_actor,'order_paid','orders',o.id,null,jsonb_build_object('total',total,'cash_received',received,'change_given',received-total));
  return result;
 end if;
 return private.command_core_before_cashier(p_operation,p_payload,p_actor);
end $$;
revoke all on function private.command_core(text,jsonb,uuid) from public,anon,authenticated,service_role;
grant execute on function private.command_core(text,jsonb,uuid) to sd_branch_executor;

alter function private.read_core(text,jsonb) rename to read_core_before_cashier;
create function private.read_core(p_resource text,p_params jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=private.require_actor(false); prof private.profiles; o private.orders; result jsonb; total integer;
 lim integer:=coalesce((p_params->>'limit')::integer,50); offst integer:=coalesce((p_params->>'offset')::integer,0); state text:=coalesce(p_params->>'payment_status','unpaid');
begin
 select * into prof from private.profiles where id=actor;
 if prof.role='staff' and prof.staff_type='cashier' and p_resource not in ('me','profile','orders','bills','receipt') then raise exception using errcode='42501',message='Cashier access is limited to bills';end if;
 if p_resource in ('me','profile') then return private.read_core_before_cashier(p_resource,p_params)||jsonb_build_object('cashier_billing_enabled',true);end if;
 if p_resource in ('bills','receipt') then
  if prof.role<>'manager' and prof.staff_type<>'cashier' then raise exception using errcode='42501',message='Cashier access required';end if;
  if p_resource='receipt' then
   select * into o from private.orders where id=(p_params->>'id')::uuid;
   if not found then raise exception using errcode='P0002',message='Bill not found';end if;
   result:=private.order_json(o.id,false)||jsonb_build_object('receipt_number','SD-'||o.id::text,'branch_name',(select name from private.branches where id=o.branch_id),'payment_status',case when o.status='completed' then 'paid' when o.status='cancelled' then 'cancelled' else 'unpaid' end);
   return private.json_decimals(result);
  end if;
  if lim not between 1 and 200 or offst<0 or state not in ('unpaid','paid','all') then raise exception using errcode='22023',message='Invalid bill filter';end if;
  select count(*) into total from private.orders where (state='all' or (state='paid' and status='completed') or (state='unpaid' and status in ('pending','preparing','ready')));
  select coalesce(jsonb_agg(private.order_json(t.id,false) order by t.created_at desc),'[]') into result from (
   select id,created_at from private.orders where (state='all' or (state='paid' and status='completed') or (state='unpaid' and status in ('pending','preparing','ready'))) order by created_at desc,id limit lim offset offst
  ) t;
  return private.json_decimals(jsonb_build_object('items',result,'total',total,'limit',lim,'offset',offst));
 end if;
 return private.read_core_before_cashier(p_resource,p_params);
end $$;
alter function private.read_core(text,jsonb) owner to sd_branch_executor;
revoke all on function private.read_core(text,jsonb) from public,anon,service_role;
grant execute on function private.read_core(text,jsonb) to authenticated;
-- Old entry points must not bypass the new cashier restrictions.
revoke all on function private.read_core_before_cashier(text,jsonb),private.read_core_before_simple_stock(text,jsonb) from public,anon,authenticated,service_role;
