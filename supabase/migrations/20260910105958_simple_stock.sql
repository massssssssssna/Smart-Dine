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

alter function private.read_core(text,jsonb) rename to read_core_before_simple_stock;
create function private.read_core(p_resource text,p_params jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; total integer; lim integer:=coalesce((p_params->>'limit')::integer,50); offst integer:=coalesce((p_params->>'offset')::integer,0);
begin
 if p_resource='stock_products' then
  perform private.require_actor(true);
  if lim not between 1 and 200 or offst<0 then raise exception using errcode='22023',message='Invalid pagination';end if;
  select count(*) into total from private.ingredients i join private.menu_items m on m.stock_ingredient_id=i.id where m.deleted_at is null;
  select coalesce(jsonb_agg(to_jsonb(t)),'[]') into result from (
   select i.id,m.id menu_item_id,m.name,i.stock_quantity,i.reorder_level,m.selling_price,
    coalesce((select sum(quantity) from private.inventory_transactions where ingredient_id=i.id and kind='purchase'),0) received,
    coalesce((select -sum(quantity) from private.inventory_transactions where ingredient_id=i.id and kind='consumption'),0) used,
    coalesce((select -sum(quantity) from private.inventory_transactions where ingredient_id=i.id and kind='wastage'),0) removed
   from private.ingredients i join private.menu_items m on m.stock_ingredient_id=i.id where m.deleted_at is null order by m.name limit lim offset offst
  ) t;
  return jsonb_build_object('items',result,'total',total,'limit',lim,'offset',offst);
 end if;
 return private.read_core_before_simple_stock(p_resource,p_params);
end $$;
alter function private.read_core(text,jsonb) owner to sd_branch_executor;
revoke all on function private.read_core(text,jsonb) from public,anon,service_role;
grant execute on function private.read_core(text,jsonb) to authenticated;

-- Keep financial consumers informed when kitchen ingredient costs are not tracked.
alter table private.order_items add column costing_complete boolean not null default true;
do $$ declare s text; begin
 s:=pg_get_functiondef('private.command_core_before_menu_delete(text,jsonb,uuid)'::regprocedure);
 s:=replace(s,'packaging_cost_snapshot=menu_row.packaging_cost','costing_complete=(menu_row.stock_ingredient_id is not null and exists(select 1 from private.order_consumptions cc where cc.order_item_id=oi.id and cc.unit_cost>0)),packaging_cost_snapshot=menu_row.packaging_cost');
 execute s;
 s:=pg_get_functiondef('private.analytics(jsonb)'::regprocedure);
 -- Preserve established calculations; consumers must label incomplete food costs as estimates.
 execute 'alter function private.analytics(jsonb) rename to analytics_before_simple_stock';
end $$;
create function private.analytics(p_params jsonb) returns jsonb language plpgsql set search_path='' as $$
declare result jsonb; incomplete boolean;
begin
 result:=private.analytics_before_simple_stock(p_params);
 select exists(select 1 from private.order_items oi join private.orders o on o.id=oi.order_id where o.status='completed' and not oi.costing_complete
  and (p_params->>'start_date' is null or (o.completed_at at time zone 'Asia/Karachi')::date>=(p_params->>'start_date')::date)
  and (p_params->>'end_date' is null or (o.completed_at at time zone 'Asia/Karachi')::date<=(p_params->>'end_date')::date)) into incomplete;
 return result||jsonb_build_object('costing_complete',not incomplete,'costing_note',case when incomplete then 'Kitchen ingredient costs or drink purchase costs are not recorded. Profit figures are incomplete.' else null end);
end $$;
revoke all on function private.analytics(jsonb) from public,anon,authenticated,service_role;
grant execute on function private.analytics(jsonb) to sd_branch_executor;
