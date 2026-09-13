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

 -- 1. Cashier payment with discount support
 if p_operation = 'order_pay' then
  if prof.role <> 'manager' and prof.staff_type <> 'cashier' then
   raise exception using errcode='42501',message='Cashier access required';
  end if;
  select * into o from private.orders where id=(p_payload->>'id')::uuid for update;
  if not found then raise exception using errcode='P0002',message='Bill not found'; end if;
  perform private.expect_version(o.version,(p_payload->>'expected_version')::integer);
  if o.status <> 'ready' then raise exception using errcode='40001',message='Only ready, unpaid orders can be paid'; end if;
  
  subtot := (select coalesce(sum(quantity*price_snapshot),0) from private.order_items where order_id=o.id);
  
  -- Check for cashier discount
  if p_payload ? 'discount_percent' and (p_payload->>'discount_percent')::numeric is not null then
   disc_pct := round((p_payload->>'discount_percent')::numeric, 2);
   if disc_pct < 0 or disc_pct > 100 then
    raise exception using errcode='22023',message='Discount percent must be between 0 and 100';
   end if;
   disc_amt := round(subtot * (disc_pct / 100.0), 2);
  elsif p_payload ? 'discount' and (p_payload->>'discount')::numeric is not null then
   disc_amt := round((p_payload->>'discount')::numeric, 2);
   if disc_amt < 0 or disc_amt > subtot then
    raise exception using errcode='22023',message='Discount cannot exceed subtotal';
   end if;
   disc_pct := case when subtot > 0 then round((disc_amt / subtot) * 100.0, 2) else 0 end;
  else
   disc_amt := coalesce(o.discount, 0);
   disc_pct := o.discount_percent;
  end if;

  update private.orders set
   discount = disc_amt,
   discount_percent = disc_pct,
   discount_reason = nullif(btrim(p_payload->>'discount_reason'), '')
  where id=o.id;

  total := subtot - disc_amt + o.tax;
  received := (p_payload->>'cash_received')::numeric;
  if received is null or received < total or received <> round(received, 2) then
   raise exception using errcode='22023',message='Cash received must cover the full bill';
  end if;

  update private.orders set
   paid_by = p_actor,
   cash_received = received,
   change_given = received - total
  where id=o.id;

  result := private.command_core_before_cashier('order_transition', jsonb_build_object('id', o.id, 'expected_version', o.version, 'status', 'completed'), p_actor);
  perform private.audit(p_actor, 'order_paid', 'orders', o.id, null, jsonb_build_object(
   'subtotal', subtot,
   'tax', o.tax,
   'tax_rate', o.tax_rate_snapshot,
   'discount', disc_amt,
   'discount_percent', disc_pct,
   'discount_reason', p_payload->>'discount_reason',
   'total', total,
   'cash_received', received,
   'change_given', received - total
  ));
  return result;
 end if;

