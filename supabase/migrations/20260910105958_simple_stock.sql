-- Count ready-to-sell drinks; kitchen dishes have no stock requirement.
alter table private.menu_items add column stock_ingredient_id uuid;
alter table private.menu_items add constraint menu_stock_branch_fk foreign key(branch_id,stock_ingredient_id) references private.ingredients(branch_id,id);
create unique index menu_stock_item_uq on private.menu_items(stock_ingredient_id) where stock_ingredient_id is not null;

-- Preparation consumes one piece per tracked drink. Existing recipe definitions are retained,
-- but do not constrain kitchen dish availability in this simplified workflow.
do $$ declare s text; begin
 s:=pg_get_functiondef('private.command_core_before_menu_delete(text,jsonb,uuid)'::regprocedure);
 s:=replace(s,'if exists(select 1 from private.order_items oi where oi.order_id=id and not exists(select 1 from private.recipes r where r.menu_item_id=oi.menu_item_id)) then raise exception using errcode=''22023'',message=''Every item needs a recipe before preparation''; end if;','');
 s:=replace(s,'private.recipes r','(select mi.id menu_item_id,mi.stock_ingredient_id ingredient_id,1::numeric quantity from private.menu_items mi where mi.stock_ingredient_id is not null) r');
 s:=replace(s,'ingredient_cost_snapshot=(select sum(c.cost) from private.order_consumptions c where c.order_item_id=oi.id)','ingredient_cost_snapshot=coalesce((select sum(c.cost) from private.order_consumptions c where c.order_item_id=oi.id),0)');
 s:=replace(s,'Insufficient or inactive ingredient stock','Not enough bottles in stock');
 execute s;
end $$;

alter function private.command_core(text,jsonb,uuid) rename to command_core_before_simple_stock;
create function private.command_core(p_operation text,p_payload jsonb,p_actor uuid) returns jsonb language plpgsql set search_path='' as $$
declare ingredient uuid; product uuid; q numeric; cost numeric; ing private.ingredients; result jsonb;
begin
 if p_operation='inventory_record' and exists(select 1 from private.menu_items where stock_ingredient_id=(p_payload->>'ingredient_id')::uuid) and (p_payload->>'quantity')::numeric<>trunc((p_payload->>'quantity')::numeric) then
  raise exception using errcode='22023',message='Bottle quantities must be whole numbers';
 end if;
 if p_operation='ingredient_update' and exists(select 1 from private.menu_items where stock_ingredient_id=(p_payload->>'id')::uuid) and p_payload->>'unit'<>'piece' then
  raise exception using errcode='22023',message='Drinks are counted in pieces';
 end if;
 if p_operation in ('stock_product_create','stock_receive','stock_remove') then
  if private.require_actor(true)<>p_actor then raise exception using errcode='42501',message='Manager required';end if;
  q:=(p_payload->>'quantity')::numeric;
  if q is null or q<0 or q<>trunc(q) or q>1000000 or (p_operation<>'stock_product_create' and q=0) then raise exception using errcode='22023',message='Enter a whole-number quantity';end if;
  if p_operation='stock_product_create' then
   if coalesce((p_payload->>'selling_price')::numeric,0)<=0 then raise exception using errcode='22023',message='Selling price must be positive';end if;
   insert into private.ingredients(name,unit,reorder_level) values(p_payload->>'name','piece',coalesce((p_payload->>'reorder_level')::integer,5)) returning id into ingredient;
   insert into private.menu_items(name,category,selling_price,stock_ingredient_id) values(p_payload->>'name','Drinks',(p_payload->>'selling_price')::numeric,ingredient) returning id into product;
   cost:=coalesce((p_payload->>'unit_cost')::numeric,0);
  else
   select * into ing from private.ingredients where id=(p_payload->>'id')::uuid for update;
   if not found or not exists(select 1 from private.menu_items where stock_ingredient_id=ing.id and deleted_at is null) then raise exception using errcode='P0002',message='Stock item not found';end if;
   ingredient:=ing.id;cost:=coalesce((p_payload->>'unit_cost')::numeric,ing.average_unit_cost);
  end if;
  if q>0 then
   perform private.command_core_before_simple_stock('inventory_record',jsonb_build_object('ingredient_id',ingredient,'kind',case when p_operation='stock_remove' then 'wastage' else 'purchase' end,'quantity',q,'reason',coalesce(nullif(p_payload->>'reason',''),case when p_operation='stock_remove' then 'Damaged or missing bottles' else 'Stock received' end)) || case when p_operation='stock_remove' then '{}'::jsonb else jsonb_build_object('unit_cost',cost) end,p_actor);
  end if;
  result:=jsonb_build_object('id',ingredient,'menu_item_id',product,'status','saved');
  perform private.audit(p_actor,p_operation,'ingredients',ingredient,null,result);
  return result;
 end if;
 return private.command_core_before_simple_stock(p_operation,p_payload,p_actor);
end $$;
revoke all on function private.command_core(text,jsonb,uuid) from public,anon,authenticated,service_role;
grant execute on function private.command_core(text,jsonb,uuid) to sd_branch_executor;
