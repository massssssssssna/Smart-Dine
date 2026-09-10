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
