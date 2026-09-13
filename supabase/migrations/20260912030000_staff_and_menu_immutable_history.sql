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

