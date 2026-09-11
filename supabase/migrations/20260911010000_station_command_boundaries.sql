-- Enforce station boundaries for dining orders, preparation, and payments.
alter function private.execute_command(text,jsonb,text) rename to execute_command_before_station_boundaries;

create function private.execute_command(p_operation text,p_payload jsonb,p_idempotency_key text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=private.require_actor(false); prof private.profiles;
begin
 select * into prof from private.profiles where id=actor;
 if not found or not prof.is_active then raise exception using errcode='42501',message='Active profile required';end if;

 -- Kitchen and cashier staff cannot create or edit dining table orders (floor staff only)
 if prof.role='staff' and prof.staff_type in ('kitchen','cashier') and p_operation in ('order_create','order_update') then
   raise exception using errcode='42501',message='Kitchen and cashier staff cannot create or edit table orders';
 end if;

 -- Only kitchen or manager can mark an order preparing or ready for pickup
 if p_operation='order_transition' and p_payload->>'status' in ('preparing','ready') and prof.role<>'manager' and prof.staff_type<>'kitchen' then
   raise exception using errcode='42501',message='Kitchen or manager access is required to prepare or plate orders';
 end if;

 return private.execute_command_before_station_boundaries(p_operation,p_payload,p_idempotency_key);
end $$;

alter function private.execute_command(text,jsonb,text) owner to sd_branch_executor;
revoke all on function private.execute_command(text,jsonb,text) from public,anon,service_role;
grant execute on function private.execute_command(text,jsonb,text) to authenticated;
revoke all on function private.execute_command_before_station_boundaries(text,jsonb,text) from authenticated,anon,public,service_role;
