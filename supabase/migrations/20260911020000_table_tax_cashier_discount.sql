-- Table tax rate configuration, automatic order tax calculation, and cashier discount management
alter table private.dining_tables add column if not exists tax_rate numeric(5,2) not null default 15.00 check(tax_rate >= 0 and tax_rate <= 100);
alter table private.orders add column if not exists tax_rate_snapshot numeric(5,2) not null default 15.00 check(tax_rate_snapshot >= 0 and tax_rate_snapshot <= 100);
alter table private.orders add column if not exists discount_percent numeric(5,2) check(discount_percent >= 0 and discount_percent <= 100);
alter table private.orders add column if not exists discount_reason text;

update private.dining_tables set tax_rate = 15.00 where tax_rate is null;
update private.orders set tax_rate_snapshot = 15.00 where tax_rate_snapshot is null;

create or replace function private.order_json(p_id uuid, p_manager boolean) returns jsonb language sql stable set search_path='' as $$
 select (to_jsonb(o) - case when p_manager then '{}'::text[] else array['platform_fee','delivery_cost'] end) || jsonb_build_object(
 'subtotal',(select coalesce(sum(quantity*price_snapshot),0) from private.order_items where order_id=o.id),
 'tax_rate',coalesce(o.tax_rate_snapshot, 15.00),
 'discount_percent',o.discount_percent,
 'discount_reason',o.discount_reason,
 'total',(select coalesce(sum(quantity*price_snapshot),0) from private.order_items where order_id=o.id)-o.discount+o.tax,'items',
 coalesce((select jsonb_agg(to_jsonb(i)-case when p_manager then '{}'::text[] else array['ingredient_cost_snapshot','packaging_cost_snapshot','fee_allocated','recipe_version'] end order by i.id) from private.order_items i where i.order_id=o.id),'[]'::jsonb))
 from private.orders o where o.id=p_id
$$;

alter function private.command_core(text,jsonb,uuid) rename to command_core_before_table_tax;

create function private.command_core(p_operation text,p_payload jsonb,p_actor uuid) returns jsonb
language plpgsql set search_path='' as $$
declare
 f private.floors;
 t private.dining_tables;
 o private.orders;
 result jsonb;
 before_data jsonb;
 entity uuid;
 kind text;
 subtot numeric;
 calc_tax numeric;
 total numeric;
 received numeric;
 disc_amt numeric;
 disc_pct numeric;
 is_mgr boolean;
 prof private.profiles;
begin
 select * into prof from private.profiles where id=p_actor;
 is_mgr := (prof.role = 'manager');

