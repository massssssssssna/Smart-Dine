-- SmartDine core: private data, capability-limited RPC, atomic operational ledger.
create schema if not exists private;
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to authenticated, service_role;
alter default privileges in schema private revoke execute on functions from public;

create table private.profiles (
 id uuid primary key references auth.users(id), email text not null unique,
 full_name text not null check (length(btrim(full_name)) between 1 and 150),
 role text not null check(role in ('manager','staff')), is_active boolean not null default false,
 version integer not null default 1, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table private.user_provisioning (
 id uuid primary key default gen_random_uuid(), email text not null unique, full_name text not null,
 role text not null check(role in ('manager','staff')), requested_by uuid not null references private.profiles(id),
 request_key text not null, user_id uuid unique references auth.users(id), status text not null default 'pending',
 created_at timestamptz not null default now(), unique(requested_by,request_key)
);
create table private.bootstrap_state(singleton boolean primary key default true check(singleton),completed_at timestamptz not null default now());
create table private.ingredients (
 id uuid primary key default gen_random_uuid(), name text not null unique check(length(btrim(name)) between 1 and 150),
 unit text not null check(unit in ('g','ml','piece')), stock_quantity numeric(18,6) not null default 0 check(stock_quantity>=0),
 average_unit_cost numeric(18,8) not null default 0 check(average_unit_cost>=0),
 reorder_level numeric(18,6) not null default 0 check(reorder_level>=0), is_active boolean not null default true,
 version integer not null default 1, created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create table private.menu_items (
 id uuid primary key default gen_random_uuid(), name text not null unique check(length(btrim(name)) between 1 and 150),
 category text not null default 'General', selling_price numeric(14,2) not null check(selling_price>0),
 packaging_cost numeric(14,2) not null default 0 check(packaging_cost>=0), is_active boolean not null default true,
 version integer not null default 1, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table private.recipes (
 menu_item_id uuid not null references private.menu_items(id), ingredient_id uuid not null references private.ingredients(id),
 quantity numeric(18,6) not null check(quantity>0), primary key(menu_item_id,ingredient_id)
);
create index recipes_ingredient_idx on private.recipes(ingredient_id);
create table private.orders (
 id uuid primary key default gen_random_uuid(), status text not null default 'pending' check(status in ('pending','preparing','ready','completed','cancelled')),
 discount numeric(14,2) not null default 0 check(discount>=0), platform_fee numeric(14,2) not null default 0 check(platform_fee>=0), delivery_cost numeric(14,2) not null default 0 check(delivery_cost>=0),
 tax numeric(14,2) not null default 0 check(tax>=0), notes text not null default '', created_by uuid not null references private.profiles(id),
 version integer not null default 1, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 prepared_at timestamptz, completed_at timestamptz, cancelled_at timestamptz, cancellation_reason text
);
create index orders_status_created_idx on private.orders(status,created_at desc);
create index orders_completed_idx on private.orders(completed_at) where status='completed';
create table private.order_items (
 id uuid primary key default gen_random_uuid(), order_id uuid not null references private.orders(id), menu_item_id uuid not null references private.menu_items(id),
 name_snapshot text not null, quantity integer not null check(quantity between 1 and 10000), price_snapshot numeric(14,2) not null,
 ingredient_cost_snapshot numeric(18,6) not null default 0, packaging_cost_snapshot numeric(14,2) not null default 0,
 discount_allocated numeric(14,2) not null default 0, fee_allocated numeric(14,2) not null default 0,
 recipe_version integer, unique(order_id,menu_item_id)
);
create index order_items_menu_idx on private.order_items(menu_item_id);
create table private.order_consumptions (
 id uuid primary key default gen_random_uuid(), order_id uuid not null references private.orders(id),order_item_id uuid not null references private.order_items(id),
 ingredient_id uuid not null references private.ingredients(id), quantity numeric(18,6) not null check(quantity>0),unit_cost numeric(18,8) not null check(unit_cost>=0),
 cost numeric(18,6) not null check(cost>=0), unique(order_item_id,ingredient_id)
);
create index order_consumptions_order_idx on private.order_consumptions(order_id);
create index order_consumptions_ingredient_idx on private.order_consumptions(ingredient_id);
create table private.inventory_transactions (
 id uuid primary key default gen_random_uuid(),ingredient_id uuid not null references private.ingredients(id),order_id uuid references private.orders(id),
 kind text not null check(kind in ('purchase','consumption','wastage','adjustment')),quantity numeric(18,6) not null check(quantity<>0),
 unit_cost numeric(18,8) not null check(unit_cost>=0), value numeric(18,6) not null, reason text not null,
 created_by uuid not null references private.profiles(id), created_at timestamptz not null default now()
);
create index inventory_transactions_ingredient_idx on private.inventory_transactions(ingredient_id,created_at desc);
create index inventory_transactions_order_idx on private.inventory_transactions(order_id);
create table private.expenses (
 id uuid primary key default gen_random_uuid(),category text not null,amount numeric(14,2) not null check(amount>0),incurred_on date not null,
 description text not null default '',created_by uuid not null references private.profiles(id),created_at timestamptz not null default now(),
 voided_at timestamptz,void_reason text,version integer not null default 1
);
create index expenses_date_idx on private.expenses(incurred_on);
create table private.review_tokens (
 id uuid primary key default gen_random_uuid(),order_id uuid not null unique references private.orders(id),token_hash text not null unique,
 expires_at timestamptz not null,used_at timestamptz,created_at timestamptz not null default now()
);
create table private.reviews (
 id uuid primary key default gen_random_uuid(),order_id uuid not null unique references private.orders(id),menu_item_id uuid references private.menu_items(id),
 rating integer not null check(rating between 1 and 5),comment text not null check(length(comment) between 1 and 5000),
 analysis_status text not null default 'pending',created_at timestamptz not null default now()
);
create index reviews_menu_idx on private.reviews(menu_item_id);
create table private.recommendations (
 id uuid primary key default gen_random_uuid(),action_type text not null check(action_type in ('price_update','recipe_update','menu_update','marketing','reorder')),
 title text not null,description text not null default '',target_id uuid,expected_target_version integer,
 proposed_change jsonb not null,evidence jsonb not null,status text not null default 'proposed' check(status in ('proposed','approved','rejected','applied')),
 version integer not null default 1,created_by uuid not null references private.profiles(id),approved_by uuid references private.profiles(id),
 created_at timestamptz not null default now(),approved_at timestamptz,applied_at timestamptz
);
create table private.audit_logs (
 id bigint generated always as identity primary key, actor_id uuid references private.profiles(id),action text not null,entity text not null,entity_id uuid,
 before_data jsonb,after_data jsonb,created_at timestamptz not null default now()
);
create index audit_created_idx on private.audit_logs(created_at desc);
create table private.idempotency_records (
 actor_id uuid not null references private.profiles(id),operation text not null,key text not null,request_hash text not null,
 result jsonb not null,created_at timestamptz not null default now(),primary key(actor_id,operation,key)
);

create function private.require_actor(p_manager boolean default false) returns uuid
language plpgsql security definer set search_path='' as $$
declare v_actor uuid := auth.uid(); v_profile private.profiles;
 v_session text:=nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'session_id';
begin
 select * into v_profile from private.profiles where id=v_actor;
 if v_actor is null or not found or not v_profile.is_active or (p_manager and v_profile.role<>'manager') then
 raise exception using errcode='42501',message='An active authorized account is required'; end if;
 if v_session is not null and not exists(select 1 from auth.sessions where id=v_session::uuid and user_id=v_actor) then
 raise exception using errcode='42501',message='Session has been revoked'; end if;
 return v_actor;
end $$;

create function private.validate_managed_user() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if coalesce((new.raw_app_meta_data->>'managed_account')::boolean,false) is not true then
 raise exception using errcode='42501',message='Accounts must be provisioned by a manager'; end if;
 insert into private.profiles(id,email,full_name,role,is_active) values(new.id,lower(new.email),coalesce(nullif(new.raw_user_meta_data->>'full_name',''),'Pending account'),'staff',false);
 return new;
end $$;
create trigger smartdine_managed_accounts after insert on auth.users for each row execute function private.validate_managed_user();

create function private.set_recipe(p_id uuid,p_ingredients jsonb,p_expected integer,p_actor uuid) returns void language plpgsql set search_path='' as $$
declare m private.menu_items; item jsonb;
begin
 select * into m from private.menu_items where id=p_id for update;
 if not found then raise exception using errcode='P0002',message='Menu item not found'; end if;
 perform private.expect_version(m.version,p_expected);
 if jsonb_typeof(p_ingredients) is distinct from 'array' then raise exception using errcode='22023',message='Recipe ingredients array required'; end if;
 if jsonb_array_length(p_ingredients) not between 1 and 100 then raise exception using errcode='22023',message='Recipe must contain 1 to 100 ingredients'; end if;
 delete from private.recipes where menu_item_id=p_id;
 for item in select value from jsonb_array_elements(p_ingredients) loop
 if not exists(select 1 from private.ingredients where id=(item->>'ingredient_id')::uuid and is_active) then raise exception using errcode='22023',message='Recipe ingredient is unavailable'; end if;
 insert into private.recipes(menu_item_id,ingredient_id,quantity) values(p_id,(item->>'ingredient_id')::uuid,(item->>'quantity')::numeric);
 end loop;
 update private.menu_items set version=version+1,updated_at=now() where id=p_id;
 perform private.audit(p_actor,'recipe_set','menu_items',p_id,to_jsonb(m),p_ingredients);
end $$;

create function private.set_order_items(p_id uuid,p_items jsonb) returns void language plpgsql set search_path='' as $$
declare item jsonb; m private.menu_items; q integer; old_prices jsonb;
begin
 if jsonb_typeof(p_items) is distinct from 'array' then raise exception using errcode='22023',message='Order items array required'; end if;
 if jsonb_array_length(p_items) not between 1 and 100 then raise exception using errcode='22023',message='Order must contain 1 to 100 items'; end if;
 select coalesce(jsonb_object_agg(menu_item_id::text,price_snapshot),'{}') into old_prices from private.order_items where order_id=p_id;
 delete from private.order_items where order_id=p_id;
 for item in select value from jsonb_array_elements(p_items) loop
 select * into m from private.menu_items where id=(item->>'menu_item_id')::uuid and is_active for share;
 if not found then raise exception using errcode='22023',message='Menu item is unavailable'; end if;
 q:=(item->>'quantity')::integer;
 insert into private.order_items(order_id,menu_item_id,name_snapshot,quantity,price_snapshot)
 values(p_id,m.id,m.name,q,coalesce((old_prices->>m.id::text)::numeric,m.selling_price));
 end loop;
end $$;

create function private.allocate_order(p_id uuid) returns void language plpgsql set search_path='' as $$
declare o private.orders; i private.order_items; subtotal numeric; allocated_discount numeric:=0; allocated_fee numeric:=0; d numeric; f numeric; n integer:=0; cnt integer;
begin
 select * into o from private.orders where id=p_id;
 select sum(quantity*price_snapshot),count(*) into subtotal,cnt from private.order_items where order_id=p_id;
 if subtotal is null or o.discount>subtotal then raise exception using errcode='22023',message='Discount cannot exceed subtotal'; end if;
 for i in select * from private.order_items where order_id=p_id order by id loop
 n:=n+1;
 d:=case when n=cnt then o.discount-allocated_discount else trunc(o.discount*i.quantity*i.price_snapshot/subtotal,2) end;
 f:=case when n=cnt then o.platform_fee+o.delivery_cost-allocated_fee else trunc((o.platform_fee+o.delivery_cost)*i.quantity*i.price_snapshot/subtotal,2) end;
 update private.order_items set discount_allocated=d,fee_allocated=f where id=i.id;
 allocated_discount:=allocated_discount+d; allocated_fee:=allocated_fee+f;
 end loop;
end $$;

create function private.command_core(p_operation text,p_payload jsonb,p_actor uuid) returns jsonb
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
 update private.profiles set full_name=coalesce(p_payload->>'full_name',full_name),role=coalesce(p_payload->>'role',role),is_active=coalesce((p_payload->>'is_active')::boolean,is_active),version=version+1,updated_at=now() where profiles.id=id; result:=private.read_core('users',jsonb_build_object('id',id));
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
create function private.require_service() returns void
language plpgsql security invoker set search_path='' as $$
begin
 if coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'role','')<>'service_role'
 and coalesce(current_setting('role',true),'')<>'service_role' then
 raise exception using errcode='42501',message='Service access required'; end if;
end $$;
create function private.audit(p_actor uuid,p_action text,p_entity text,p_id uuid,p_before jsonb,p_after jsonb) returns void
language sql set search_path='' as $$
 insert into private.audit_logs(actor_id,action,entity,entity_id,before_data,after_data) values(p_actor,p_action,p_entity,p_id,p_before,p_after)
$$;
create function private.expect_version(p_actual integer,p_expected integer) returns void
language plpgsql set search_path='' as $$
begin
 if p_expected is null then raise exception using errcode='22023',message='expected_version is required'; end if;
 if p_actual<>p_expected then raise exception using errcode='40001',message='Record changed; refresh before retrying'; end if;
end $$;
-- Preserve precision in every RPC response, including nested financial snapshots.
create function private.json_decimals(p_value jsonb) returns jsonb language plpgsql immutable set search_path='' as $$
declare k text; v jsonb; r jsonb; begin
 if jsonb_typeof(p_value)='array' then
 select coalesce(jsonb_agg(private.json_decimals(value)),'[]'::jsonb) into r from jsonb_array_elements(p_value); return r;
 elsif jsonb_typeof(p_value)='object' then
 r:='{}'; for k,v in select * from jsonb_each(p_value) loop
 if jsonb_typeof(v)='number' and ((k ~ '(price|cost|amount|revenue|profit|margin|discount|fee|tax|value|stock|level|loss|expenses|threshold)' and k not in ('stock_count')) or k='subtotal' or (k='total' and not (p_value ? 'limit')) or (k='quantity' and (p_value ? 'kind' or p_value ? 'unit_cost'))) then r:=r||jsonb_build_object(k,v#>>'{}');
 else r:=r||jsonb_build_object(k,private.json_decimals(v)); end if; end loop; return r;
 end if; return p_value; end $$;
create function private.read_intelligence(p_resource text,p_params jsonb) returns jsonb language plpgsql set search_path='' as $$ begin raise exception using errcode='22023',message='Unknown resource'; end $$;
create function private.command_intelligence(p_operation text,p_payload jsonb,p_actor uuid) returns jsonb language plpgsql set search_path='' as $$ begin raise exception using errcode='22023',message='Unknown operation'; end $$;
create function private.service_intelligence(p_operation text,p_payload jsonb) returns jsonb language plpgsql set search_path='' as $$ begin raise exception using errcode='22023',message='Unknown service operation'; end $$;
create function private.enqueue_job(p_kind text,p_payload jsonb,p_dedup_key text,p_actor uuid) returns uuid language plpgsql set search_path='' as $$ begin raise exception using errcode='55000',message='Intelligence migration must be installed'; end $$;

create function private.order_json(p_id uuid,p_manager boolean) returns jsonb language sql stable set search_path='' as $$
 select (to_jsonb(o) - case when p_manager then '{}'::text[] else array['platform_fee','delivery_cost'] end) || jsonb_build_object(
 'subtotal',(select coalesce(sum(quantity*price_snapshot),0) from private.order_items where order_id=o.id),
 'total',(select coalesce(sum(quantity*price_snapshot),0) from private.order_items where order_id=o.id)-o.discount+o.tax,'items',
 coalesce((select jsonb_agg(to_jsonb(i)-case when p_manager then '{}'::text[] else array['ingredient_cost_snapshot','packaging_cost_snapshot','fee_allocated','recipe_version'] end order by i.id) from private.order_items i where i.order_id=o.id),'[]'::jsonb))
 from private.orders o where o.id=p_id
$$;

create function private.analytics(p_params jsonb) returns jsonb language plpgsql set search_path='' as $$
declare d1 date:=coalesce((p_params->>'start_date')::date,(now() at time zone 'Asia/Karachi')::date-29);
 d2 date:=coalesce((p_params->>'end_date')::date,(now() at time zone 'Asia/Karachi')::date);
 rev numeric; direct numeric; exp numeric; losses numeric; cancel_losses numeric; items jsonb; overall numeric; med numeric;
 report text:=coalesce(p_params->>'report','summary'); result jsonb;
begin
 perform private.require_actor(true);
 if d2<d1 or d2-d1>366 then raise exception using errcode='22023',message='Report range must be ordered and at most 366 days'; end if;
 if report not in ('summary','items','matrix','sales','stock_losses','review_aspects') then raise exception using errcode='22023',message='Unknown report'; end if;
 if report='review_aspects' then
 select coalesce(jsonb_agg(to_jsonb(q)),'[]') into items from (
 select a.value->>'aspect' as aspect,a.value->>'sentiment' as sentiment,count(*) as mentions
 from private.reviews r join private.review_analyses ra on ra.review_id=r.id
 cross join lateral jsonb_array_elements(ra.result->'aspects') a(value)
 where (r.created_at at time zone 'Asia/Karachi')::date between d1 and d2 group by 1,2 order by 1,2) q;
 return jsonb_build_object('start_date',d1,'end_date',d2,'items',items,
 'reviews_received',(select count(*) from private.reviews where (created_at at time zone 'Asia/Karachi')::date between d1 and d2),
 'reviews_analyzed',(select count(*) from private.reviews where analysis_status='completed' and (created_at at time zone 'Asia/Karachi')::date between d1 and d2));
 end if;
 if report='sales' then
 select coalesce(jsonb_agg(to_jsonb(q) order by q.day),'[]') into items from (
 select (o.completed_at at time zone 'Asia/Karachi')::date as day,count(distinct o.id) as completed_orders,
 sum(i.quantity) as quantity,round(sum(i.quantity*i.price_snapshot-i.discount_allocated),2) as net_revenue,
 round(sum(i.quantity*i.price_snapshot-i.discount_allocated-i.ingredient_cost_snapshot-i.quantity*i.packaging_cost_snapshot-i.fee_allocated),2) as contribution_margin
 from private.orders o join private.order_items i on i.order_id=o.id where o.status='completed'
 and (o.completed_at at time zone 'Asia/Karachi')::date between d1 and d2 group by 1) q;
 return jsonb_build_object('start_date',d1,'end_date',d2,'currency','PKR','items',items,'source','completed_orders');
 end if;
 select coalesce(sum(i.quantity*i.price_snapshot-i.discount_allocated),0),coalesce(sum(i.ingredient_cost_snapshot+i.quantity*i.packaging_cost_snapshot+i.fee_allocated),0)
 into rev,direct from private.order_items i join private.orders o on o.id=i.order_id where o.status='completed' and (o.completed_at at time zone 'Asia/Karachi')::date between d1 and d2;
 select coalesce(sum(amount),0) into exp from private.expenses where voided_at is null and incurred_on between d1 and d2;
 select coalesce(sum(-value),0) into losses from private.inventory_transactions where quantity<0 and kind in ('wastage','adjustment') and (created_at at time zone 'Asia/Karachi')::date between d1 and d2;
 select coalesce(sum(i.ingredient_cost_snapshot+i.quantity*i.packaging_cost_snapshot+i.fee_allocated),0) into cancel_losses from private.order_items i join private.orders o on o.id=i.order_id where o.status='cancelled' and o.prepared_at is not null and (o.cancelled_at at time zone 'Asia/Karachi')::date between d1 and d2;
 overall:=case when rev>0 then (rev-direct)/rev*100 else 0 end;
 with sales as(select i.menu_item_id,sum(i.quantity) qty from private.order_items i join private.orders o on o.id=i.order_id where o.status='completed' and (o.completed_at at time zone 'Asia/Karachi')::date between d1 and d2 group by 1)
 select coalesce(percentile_cont(0.5) within group(order by qty),0) into med from sales;
 with sales as(select i.menu_item_id,sum(i.quantity) quantity,sum(i.quantity*i.price_snapshot-i.discount_allocated) net_revenue,
 sum(i.quantity*i.price_snapshot-i.discount_allocated-i.ingredient_cost_snapshot-i.quantity*i.packaging_cost_snapshot-i.fee_allocated) contribution_margin
 from private.order_items i join private.orders o on o.id=i.order_id where o.status='completed' and (o.completed_at at time zone 'Asia/Karachi')::date between d1 and d2 group by 1)
 select coalesce(jsonb_agg(jsonb_build_object('menu_item_id',m.id,'name',m.name,'quantity',coalesce(s.quantity,0),'net_revenue',coalesce(s.net_revenue,0),'contribution_margin',coalesce(s.contribution_margin,0),
 'margin_percent',case when s.net_revenue>0 then round(s.contribution_margin/s.net_revenue*100,2) end,
 'matrix',case when s.quantity is null then 'insufficient_sales' else (case when s.quantity>=med then 'high_volume' else 'low_volume' end)||'/'||(case when s.contribution_margin>0 and s.contribution_margin/nullif(s.net_revenue,0)*100>=overall then 'high_margin' else 'low_margin' end) end) order by m.name),'[]') into items from private.menu_items m left join sales s on s.menu_item_id=m.id;
 result:=jsonb_build_object('start_date',d1,'end_date',d2,'currency','PKR','timezone','Asia/Karachi','net_revenue',round(rev,2),'direct_cost',round(direct,2),'contribution_margin',round(rev-direct,2),
 'operating_expenses',exp,'stock_losses',round(losses,2),'cancellation_losses',round(cancel_losses,2),'operating_profit',round(rev-direct-exp-losses-cancel_losses,2),'volume_threshold',med,'margin_threshold',round(overall,2),'items',items);
 if report='stock_losses' then return jsonb_build_object('start_date',d1,'end_date',d2,'currency','PKR','stock_losses',round(losses,2),'cancellation_losses',round(cancel_losses,2),'total_losses',round(losses+cancel_losses,2)); end if;
 if report in ('items','matrix') then return jsonb_build_object('start_date',d1,'end_date',d2,'currency','PKR','volume_threshold',med,'margin_threshold',round(overall,2),'items',items); end if;
 return result;
end $$;

create function private.read_core(p_resource text,p_params jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
#variable_conflict use_variable
declare actor uuid:=private.require_actor(false); mgr boolean; id uuid:=(p_params->>'id')::uuid; lim integer:=coalesce((p_params->>'limit')::int,50); offst integer:=coalesce((p_params->>'offset')::int,0); allrows jsonb; result jsonb;
begin
 select role='manager' into mgr from private.profiles where profiles.id=actor;
 if lim not between 1 and 200 or offst<0 then raise exception using errcode='22023',message='Invalid pagination'; end if;
 if p_resource in ('me','profile') then return (select to_jsonb(p) from private.profiles p where p.id=actor); end if;
 if p_resource in ('users','recipes','analytics','reviews','recommendations','audit') then perform private.require_actor(true); end if;
 if p_resource='analytics' then return private.json_decimals(private.analytics(p_params));
 elsif p_resource='users' then select coalesce(jsonb_agg(to_jsonb(t) order by t.created_at desc),'[]') into allrows from private.profiles t where id is null or t.id=id;
 elsif p_resource='menu' then select coalesce(jsonb_agg(to_jsonb(t)-case when mgr then '{}'::text[] else array['packaging_cost'] end order by t.name),'[]') into allrows from private.menu_items t where (id is null or t.id=id) and (mgr or t.is_active);
 elsif p_resource='recipes' then select jsonb_build_object('id',m.id,'version',m.version,'ingredients',coalesce((select jsonb_agg(jsonb_build_object('ingredient_id',r.ingredient_id,'quantity',r.quantity::text,'name',i.name,'unit',i.unit) order by i.name) from private.recipes r join private.ingredients i on i.id=r.ingredient_id where r.menu_item_id=m.id),'[]')) into result from private.menu_items m where m.id=coalesce(id,(p_params->>'menu_item_id')::uuid); if result is null then raise exception using errcode='P0002',message='Recipe item not found'; end if; return result;
 elsif p_resource='orders' then select coalesce(jsonb_agg(private.order_json(t.id,mgr) order by t.created_at desc),'[]') into allrows from private.orders t where (id is null or t.id=id) and (p_params->>'status' is null or t.status=p_params->>'status');
 elsif p_resource='inventory' then select coalesce(jsonb_agg(to_jsonb(t)-case when mgr then '{}'::text[] else array['average_unit_cost'] end order by t.name),'[]') into allrows from private.ingredients t where id is null or t.id=id;
 elsif p_resource='inventory_transactions' then select coalesce(jsonb_agg(to_jsonb(t)-case when mgr then '{}'::text[] else array['unit_cost','value'] end order by t.created_at desc),'[]') into allrows from private.inventory_transactions t where (id is null or t.id=id) and (p_params->>'ingredient_id' is null or t.ingredient_id=(p_params->>'ingredient_id')::uuid);
 elsif p_resource='expenses' then select coalesce(jsonb_agg(to_jsonb(t) order by t.created_at desc),'[]') into allrows from private.expenses t where (id is null or t.id=id) and (mgr or t.created_by=actor) and (p_params->>'start_date' is null or t.incurred_on>=(p_params->>'start_date')::date) and (p_params->>'end_date' is null or t.incurred_on<=(p_params->>'end_date')::date);
 elsif p_resource='reviews' then select coalesce(jsonb_agg(to_jsonb(t) order by t.created_at desc),'[]') into allrows from private.reviews t where (id is null or t.id=id) and (p_params->>'menu_item_id' is null or t.menu_item_id=(p_params->>'menu_item_id')::uuid) and (p_params->>'start_date' is null or (t.created_at at time zone 'Asia/Karachi')::date>=(p_params->>'start_date')::date) and (p_params->>'end_date' is null or (t.created_at at time zone 'Asia/Karachi')::date<=(p_params->>'end_date')::date);
 elsif p_resource='recommendations' then select coalesce(jsonb_agg(to_jsonb(t) order by t.created_at desc),'[]') into allrows from private.recommendations t where (id is null or t.id=id) and (p_params->>'status' is null or t.status=p_params->>'status');
 elsif p_resource='audit' then
 if p_params ? 'event_id' then
 select to_jsonb(t) into result from private.audit_logs t where t.id=(p_params->>'event_id')::bigint;
 if result is null then raise exception using errcode='P0002',message='Audit event not found'; end if;
 return private.json_decimals(result);
 end if;
 select coalesce(jsonb_agg(to_jsonb(t) order by t.created_at desc),'[]') into allrows from private.audit_logs t;
 else return private.json_decimals(private.read_intelligence(p_resource,p_params)); end if;
 if id is not null then if jsonb_array_length(allrows)=0 then raise exception using errcode='P0002',message='Record not found'; end if; return private.json_decimals(allrows->0); end if;
 select coalesce(jsonb_agg(value),'[]') into result from (select value from jsonb_array_elements(allrows) with ordinality x(value,n) order by n limit lim offset offst) q;
 return private.json_decimals(jsonb_build_object('items',result,'total',jsonb_array_length(allrows),'limit',lim,'offset',offst));
end $$;

create function private.service_core(p_operation text,p_payload jsonb default '{}') returns jsonb
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
 if prov.email<>email or prov.full_name<>fullname or prov.role<>p_payload->>'role' then raise exception using errcode='23505',message='Provisioning key payload conflict'; end if;
 return to_jsonb(prov);
 end if;
 if exists(select 1 from private.user_provisioning where user_provisioning.email=email) or exists(select 1 from private.profiles where profiles.email=email) then raise exception using errcode='23505',message='Email already exists or is being provisioned'; end if;
 insert into private.user_provisioning(email,full_name,role,requested_by,request_key) values(email,fullname,p_payload->>'role',actor,p_payload->>'request_key') returning * into prov;
 return to_jsonb(prov);
 else
 select * into prov from private.user_provisioning where user_provisioning.id=(p_payload->>'provision_id')::uuid for update;
 if not found or prov.requested_by<>actor then raise exception using errcode='P0002',message='Provisioning request not found'; end if;
 if prov.status='active' then if prov.user_id<>uid then raise exception using errcode='23505',message='Provisioning user conflict'; end if; return (select to_jsonb(p) from private.profiles p where p.id=uid); end if;
 select * into prof from private.profiles where profiles.id=uid for update;
 if not found or lower(prof.email)<>prov.email then raise exception using errcode='22023',message='Auth user must match provisioning email'; end if;
 update private.profiles set role=prov.role,full_name=prov.full_name,is_active=true,version=version+1,updated_at=now() where profiles.id=uid;
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

create function private.staff_json(p_value jsonb) returns jsonb language plpgsql immutable set search_path='' as $$
declare k text; v jsonb; r jsonb; begin
 if jsonb_typeof(p_value)='array' then select coalesce(jsonb_agg(private.staff_json(value)),'[]') into r from jsonb_array_elements(p_value); return r;
 elsif jsonb_typeof(p_value)='object' then r:='{}'; for k,v in select * from jsonb_each(p_value) loop
 if k<>all(array['ingredient_cost_snapshot','packaging_cost_snapshot','fee_allocated','recipe_version','average_unit_cost','unit_cost','value','platform_fee','delivery_cost','packaging_cost']) then r:=r||jsonb_build_object(k,private.staff_json(v)); end if;
 end loop; return r;
 end if; return p_value; end $$;

create function private.validate_payload(p_value jsonb) returns void language plpgsql immutable set search_path='' as $$
declare k text; v jsonb; begin
 if jsonb_typeof(p_value)='array' then for v in select value from jsonb_array_elements(p_value) loop perform private.validate_payload(v); end loop;
 elsif jsonb_typeof(p_value)='object' then for k,v in select * from jsonb_each(p_value) loop
 if k=any(array['selling_price','packaging_cost','discount','platform_fee','delivery_cost','tax','amount','quantity','unit_cost','reorder_level']) then
 if v='null'::jsonb or jsonb_typeof(v) not in ('number','string') or (v#>>'{}')!~'^-?[0-9]+([.][0-9]+)?$' then raise exception using errcode='22023',message='Finite decimal value required for '||k; end if;
 end if;
 perform private.validate_payload(v);
 end loop; end if;
end $$;
create function private.required_fields(p_payload jsonb,p_fields text[]) returns void language plpgsql immutable set search_path='' as $$
declare k text; begin
 foreach k in array p_fields loop if not (p_payload ? k) or p_payload->k='null'::jsonb or p_payload->>k='' then raise exception using errcode='22023',message='Required field: '||k; end if; end loop;
end $$;

create function private.execute_command(p_operation text,p_payload jsonb,p_idempotency_key text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=private.require_actor(false); h text; prior private.idempotency_records; result jsonb; mgr boolean;
begin
 select role='manager' into mgr from private.profiles where id=actor;
 if p_operation<>all(array['inventory_record','order_create','order_update','order_transition','expense_create','review_token_create']) then perform private.require_actor(true); end if;
 if p_operation is null or jsonb_typeof(p_payload) is distinct from 'object' or length(coalesce(p_idempotency_key,'')) not between 1 and 200 then raise exception using errcode='22023',message='Operation, object payload and Idempotency-Key required'; end if;
 perform private.validate_payload(p_payload);
 case p_operation
 when 'menu_create' then perform private.required_fields(p_payload,array['name','selling_price']);
 when 'ingredient_create' then perform private.required_fields(p_payload,array['name','unit']);
 when 'recipe_set' then perform private.required_fields(p_payload,array['id','expected_version','ingredients']);
 when 'inventory_record' then perform private.required_fields(p_payload,array['ingredient_id','kind','quantity','reason']);
 when 'order_create' then perform private.required_fields(p_payload,array['items']);
 when 'order_transition' then perform private.required_fields(p_payload,array['id','expected_version','status']);
 when 'expense_create' then perform private.required_fields(p_payload,array['category','amount','incurred_on']);
 when 'expense_void' then perform private.required_fields(p_payload,array['id','expected_version','reason']);
 when 'recommendation_create' then perform private.required_fields(p_payload,array['action_type','title','proposed_change','evidence']);
 when 'menu_update','ingredient_update','order_update','user_update','recommendation_approve','recommendation_apply','recommendation_reject' then perform private.required_fields(p_payload,array['id','expected_version']);
 else null;
 end case;
 h:=encode(extensions.digest(p_payload::text,'sha256'),'hex');
 perform pg_advisory_xact_lock(hashtextextended(actor::text||':'||p_operation||':'||p_idempotency_key,0));
 select * into prior from private.idempotency_records where actor_id=actor and operation=p_operation and key=p_idempotency_key;
 if found then if prior.request_hash<>h then raise exception using errcode='23505',message='Idempotency key was already used with a different payload'; end if; return case when mgr then prior.result else private.staff_json(prior.result) end; end if;
 result:=private.command_core(p_operation,p_payload,actor);
 insert into private.idempotency_records(actor_id,operation,key,request_hash,result) values(actor,p_operation,p_idempotency_key,h,result);
 return result;
end $$;

create function public.sd_read(p_resource text,p_params jsonb default '{}') returns jsonb
language sql security invoker set search_path='' as $$ select private.read_core(p_resource,p_params) $$;
create function public.sd_command(p_operation text,p_payload jsonb,p_idempotency_key text) returns jsonb
language sql security invoker set search_path='' as $$ select private.execute_command(p_operation,p_payload,p_idempotency_key) $$;
create function public.sd_service(p_operation text,p_payload jsonb default '{}') returns jsonb
language sql security invoker set search_path='' as $$ select private.service_core(p_operation,p_payload) $$;

-- No business tables are accessible directly, even through accidental schema exposure.
do $$ declare t record; begin
 for t in select tablename from pg_tables where schemaname='private' loop
 execute format('alter table private.%I enable row level security',t.tablename);
 end loop;
end $$;
revoke all on all tables in schema private from public,anon,authenticated,service_role;
revoke all on all sequences in schema private from public,anon,authenticated,service_role;
revoke execute on all functions in schema private from public,anon,authenticated,service_role;
grant execute on function private.read_core(text,jsonb),private.execute_command(text,jsonb,text) to authenticated;
grant execute on function private.service_core(text,jsonb) to service_role;
revoke execute on function public.sd_read(text,jsonb),public.sd_command(text,jsonb,text),public.sd_service(text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.sd_read(text,jsonb),public.sd_command(text,jsonb,text) to authenticated;
grant execute on function public.sd_service(text,jsonb) to service_role;
