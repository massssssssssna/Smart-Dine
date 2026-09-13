-- A paid receipt is completed at the cashier station, so cashier staff must be
-- allowed to issue its single-use review token while retaining all other
-- station boundaries.
create or replace function private.execute_command_before_station_boundaries(
  p_operation text,
  p_payload jsonb,
  p_idempotency_key text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := private.require_actor(false);
  prof private.profiles;
begin
  select * into prof from private.profiles where id = actor;
  if prof.role = 'staff'
     and prof.staff_type = 'cashier'
     and p_operation not in ('order_pay', 'review_token_create') then
    raise exception using errcode = '42501', message = 'Cashier access is limited to bills, payments and receipt review links';
  end if;
  if p_operation = 'order_pay' and prof.role <> 'manager' and prof.staff_type <> 'cashier' then
    raise exception using errcode = '42501', message = 'Cashier access required';
  end if;
  if p_operation = 'order_transition' and p_payload->>'status' = 'completed' then
    raise exception using errcode = '42501', message = 'Use cashier payment to mark an order paid';
  end if;
  return private.execute_command_before_cashier(p_operation, p_payload, p_idempotency_key);
end;
$$;

create or replace function private.command_core_before_floor_tables(
  p_operation text,
  p_payload jsonb,
  p_actor uuid
) returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  prof private.profiles;
  o private.orders;
  total numeric;
  received numeric;
  result jsonb;
begin
  if private.require_actor(false) <> p_actor then
    raise exception using errcode = '42501', message = 'Actor mismatch';
  end if;
  select * into prof from private.profiles where id = p_actor;
  if prof.role = 'staff'
     and prof.staff_type = 'cashier'
     and p_operation not in ('order_pay', 'review_token_create') then
    raise exception using errcode = '42501', message = 'Cashier access is limited to payments and receipt review links';
  end if;
  if p_operation = 'order_pay' then
    if prof.role <> 'manager' and prof.staff_type <> 'cashier' then
      raise exception using errcode = '42501', message = 'Cashier access required';
    end if;
    select * into o from private.orders where id = (p_payload->>'id')::uuid for update;
    if not found then
      raise exception using errcode = 'P0002', message = 'Bill not found';
    end if;
    perform private.expect_version(o.version, (p_payload->>'expected_version')::integer);
    if o.status <> 'ready' then
      raise exception using errcode = '40001', message = 'Only ready, unpaid orders can be paid';
    end if;
    total := (private.order_json(o.id, false)->>'total')::numeric;
    received := (p_payload->>'cash_received')::numeric;
    if received is null or received < total or received <> round(received, 2) then
      raise exception using errcode = '22023', message = 'Cash received must cover the full bill';
    end if;
    update private.orders
    set paid_by = p_actor, cash_received = received, change_given = received - total
    where id = o.id;
    result := private.command_core_before_cashier(
      'order_transition',
      jsonb_build_object('id', o.id, 'expected_version', o.version, 'status', 'completed'),
      p_actor
    );
    perform private.audit(
      p_actor,
      'order_paid',
      'orders',
      o.id,
      null,
      jsonb_build_object('total', total, 'cash_received', received, 'change_given', received - total)
    );
    return result;
  end if;
  return private.command_core_before_cashier(p_operation, p_payload, p_actor);
end;
$$;
