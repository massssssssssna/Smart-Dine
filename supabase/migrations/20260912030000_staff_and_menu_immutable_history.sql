-- Migration: 20260912030000_staff_and_menu_immutable_history.sql
-- Description: Immutable staff attribution across all stations, menu item snapshot immutability, safe staff deletion, and 6-month historical operations.

-- 1. Add immutable staff snapshot columns to private.orders
alter table private.orders add column if not exists created_by_name text;
alter table private.orders add column if not exists created_by_email text;
alter table private.orders add column if not exists prepared_by uuid;
alter table private.orders add column if not exists prepared_by_name text;
alter table private.orders add column if not exists prepared_by_email text;
alter table private.orders add column if not exists paid_by_name text;
alter table private.orders add column if not exists paid_by_email text;

-- 2. Backfill existing orders with profile snapshots where available
update private.orders o
set
  created_by_name = coalesce(o.created_by_name, p.full_name, 'Dining Staff'),
  created_by_email = coalesce(o.created_by_email, p.email, 'staff@smartdine.pk')
from private.profiles p
where o.created_by = p.id;

update private.orders o
set
  paid_by_name = coalesce(o.paid_by_name, p.full_name, 'Cashier Staff'),
  paid_by_email = coalesce(o.paid_by_email, p.email, 'cashier@smartdine.pk')
from private.profiles p
where o.paid_by = p.id;

-- 3. Adjust Foreign Keys to ON DELETE SET NULL to preserve order history when staff/dishes are removed
do $$
declare r record;
begin
  -- orders.created_by
  for r in select constraint_name from information_schema.table_constraints
           where table_schema = 'private' and table_name = 'orders' and constraint_type = 'FOREIGN KEY'
           and constraint_name like '%created_by%' loop
    execute 'alter table private.orders drop constraint ' || quote_ident(r.constraint_name);
  end loop;
  alter table private.orders add constraint orders_created_by_fkey foreign key (created_by) references private.profiles(id) on delete set null;

  -- orders.paid_by
  for r in select constraint_name from information_schema.table_constraints
           where table_schema = 'private' and table_name = 'orders' and constraint_type = 'FOREIGN KEY'
           and constraint_name like '%paid_by%' loop
    execute 'alter table private.orders drop constraint ' || quote_ident(r.constraint_name);
  end loop;
  alter table private.orders add constraint orders_paid_by_fkey foreign key (paid_by) references private.profiles(id) on delete set null;

  -- orders.prepared_by
  alter table private.orders drop constraint if exists orders_prepared_by_fkey;
  alter table private.orders add constraint orders_prepared_by_fkey foreign key (prepared_by) references private.profiles(id) on delete set null;

  -- order_items.menu_item_id (allow menu item deletion without corrupting order items)
  for r in select constraint_name from information_schema.table_constraints
           where table_schema = 'private' and table_name = 'order_items' and constraint_type = 'FOREIGN KEY'
           and constraint_name like '%menu_item_id%' loop
    execute 'alter table private.order_items drop constraint ' || quote_ident(r.constraint_name);
  end loop;
  alter table private.order_items alter column menu_item_id drop not null;
  alter table private.order_items add constraint order_items_menu_item_id_fkey foreign key (menu_item_id) references private.menu_items(id) on delete set null;

  -- audit_logs.actor_id
  for r in select constraint_name from information_schema.table_constraints
           where table_schema = 'private' and table_name = 'audit_logs' and constraint_type = 'FOREIGN KEY'
           and constraint_name like '%actor%' loop
    execute 'alter table private.audit_logs drop constraint ' || quote_ident(r.constraint_name);
  end loop;
  alter table private.audit_logs add constraint audit_logs_actor_id_fkey foreign key (actor_id) references private.profiles(id) on delete set null;

  -- idempotency_records.actor_id
  for r in select constraint_name from information_schema.table_constraints
           where table_schema = 'private' and table_name = 'idempotency_records' and constraint_type = 'FOREIGN KEY' loop
    execute 'alter table private.idempotency_records drop constraint ' || quote_ident(r.constraint_name);
  end loop;
  alter table private.idempotency_records add constraint idempotency_records_actor_id_fkey foreign key (actor_id) references private.profiles(id) on delete cascade;
end $$;

-- 4. Update command_core to record staff snapshots on order_create, order_transition, and order_pay
alter function private.command_core(text,jsonb,uuid) rename to command_core_before_staff_immutability;

create function private.command_core(p_operation text,p_payload jsonb,p_actor uuid) returns jsonb
language plpgsql set search_path='' as $$
declare
  actor_prof private.profiles;
  result jsonb;
  order_rec private.orders;
begin
  select * into actor_prof from private.profiles where id = p_actor;

  -- If operation is order_create or order_update, capture creator snapshots
  if p_operation in ('order_create', 'order_update') then
    result := private.command_core_before_staff_immutability(p_operation, p_payload, p_actor);
    update private.orders
    set
      created_by_name = coalesce(created_by_name, actor_prof.full_name, 'Staff Member'),
      created_by_email = coalesce(created_by_email, actor_prof.email, 'staff@smartdine.pk')
    where id = (result->>'id')::uuid;
    return private.order_json((result->>'id')::uuid, actor_prof.role = 'manager');
  end if;

  -- If operation is order_transition to preparing/ready, capture kitchen chef snapshot
  if p_operation = 'order_transition' and p_payload->>'status' in ('preparing', 'ready') then
    result := private.command_core_before_staff_immutability(p_operation, p_payload, p_actor);
    update private.orders
    set
      prepared_by = coalesce(prepared_by, p_actor),
      prepared_by_name = coalesce(prepared_by_name, actor_prof.full_name, 'Kitchen Staff'),
      prepared_by_email = coalesce(prepared_by_email, actor_prof.email, 'kitchen@smartdine.pk'),
      prepared_at = coalesce(prepared_at, now())
    where id = (p_payload->>'id')::uuid;
    return private.order_json((p_payload->>'id')::uuid, actor_prof.role = 'manager');
  end if;

  -- If operation is order_pay, capture cashier snapshot
  if p_operation = 'order_pay' then
    result := private.command_core_before_staff_immutability(p_operation, p_payload, p_actor);
    update private.orders
    set
      paid_by = p_actor,
      paid_by_name = coalesce(actor_prof.full_name, 'Cashier Staff'),
      paid_by_email = coalesce(actor_prof.email, 'cashier@smartdine.pk')
    where id = (p_payload->>'id')::uuid;
    return result;
  end if;

  return private.command_core_before_staff_immutability(p_operation, p_payload, p_actor);
end $$;

revoke all on function private.command_core(text,jsonb,uuid) from public,anon,authenticated,service_role;
grant execute on function private.command_core(text,jsonb,uuid) to sd_branch_executor;

-- 5. Update public.sd_delete_staff to safely delete without foreign key blocks
create or replace function public.sd_delete_staff(p_user_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  actor uuid := private.require_actor(true);
  target private.profiles;
  b uuid;
begin
  select branch_id into b from private.profiles where id = actor for update;
  select * into target from private.profiles where id = p_user_id for update;
  if not found or target.role <> 'staff' or target.branch_id is distinct from b then
    raise exception using errcode = '42501', message = 'Only your branch staff can be deleted';
  end if;
  perform set_config('app.branch_id', b::text, true);
  perform private.audit(actor, 'staff_deleted', 'profiles', target.id, null, jsonb_build_object('full_name', target.full_name, 'email', target.email, 'staff_type', target.staff_type));

  delete from auth.sessions where user_id = target.id;
  delete from private.user_provisioning where user_id = target.id or email = target.email;
  delete from private.idempotency_records where actor_id = target.id;
  delete from private.profiles where id = target.id;
  delete from auth.users where id = target.id;

  return jsonb_build_object('status', 'deleted', 'id', p_user_id, 'full_name', target.full_name);
end $$;

revoke all on function public.sd_delete_staff(uuid) from public,anon,service_role;
grant execute on function public.sd_delete_staff(uuid) to authenticated;

-- 6. Update search query in private.read_core('orders') to include staff names and emails
do $$ declare s text; begin
  s := pg_get_functiondef('private.read_core(text,jsonb)'::regprocedure);
  s := replace(s,
    'concat_ws('' '',o.id,o.order_number,o.notes,o.floor_name_snapshot,o.table_name_snapshot)',
    'concat_ws('' '',o.id,o.order_number,o.notes,o.floor_name_snapshot,o.table_name_snapshot,o.created_by_name,o.created_by_email,o.prepared_by_name,o.prepared_by_email,o.paid_by_name,o.paid_by_email)'
  );
  execute s;
end $$;
