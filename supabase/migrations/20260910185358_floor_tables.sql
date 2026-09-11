-- Branch-owned floor plans. Existing orders and menus are unchanged.
create table private.floors (
 id uuid primary key default gen_random_uuid(),
 branch_id uuid not null default private.current_branch() references private.branches(id),
 name text not null check(length(btrim(name)) between 1 and 80),
 version integer not null default 1,
 created_at timestamptz not null default now(),
 unique(branch_id,id)
);
create unique index floors_name_uq on private.floors(branch_id,lower(btrim(name)));
create table private.dining_tables (
 id uuid primary key default gen_random_uuid(),
 branch_id uuid not null default private.current_branch() references private.branches(id),
 floor_id uuid not null,
 name text not null check(length(btrim(name)) between 1 and 80),
 seats integer not null check(seats between 1 and 100),
 version integer not null default 1,
 created_at timestamptz not null default now(),
 foreign key(branch_id,floor_id) references private.floors(branch_id,id)
);
create unique index dining_tables_name_uq on private.dining_tables(branch_id,floor_id,lower(btrim(name)));
create sequence private.order_number_seq start 100001;
grant usage on sequence private.order_number_seq to sd_branch_executor;
alter table private.orders add column order_number text not null default ('SD-'||nextval('private.order_number_seq')) unique;
alter table private.orders add column table_id uuid references private.dining_tables(id) on delete set null;
alter table private.orders add column floor_name_snapshot text;
alter table private.orders add column table_name_snapshot text;
alter table private.orders add column seats_snapshot integer;
create index orders_table_idx on private.orders(table_id);
alter table private.floors enable row level security;
alter table private.dining_tables enable row level security;
create policy branch_isolation on private.floors to sd_branch_executor using(branch_id=private.current_branch()) with check(branch_id=private.current_branch());
create policy branch_isolation on private.dining_tables to sd_branch_executor using(branch_id=private.current_branch()) with check(branch_id=private.current_branch());
revoke all on private.floors,private.dining_tables from public,anon,authenticated,service_role;
grant select,insert,update,delete on private.floors,private.dining_tables to sd_branch_executor;

alter function private.command_core(text,jsonb,uuid) rename to command_core_before_floor_tables;
create function private.command_core(p_operation text,p_payload jsonb,p_actor uuid) returns jsonb
language plpgsql set search_path='' as $$
declare f private.floors; t private.dining_tables; result jsonb; before_data jsonb; entity uuid; kind text;
begin
 if p_operation='order_create' and not (p_payload ? 'table_id') and exists(select 1 from private.dining_tables) then
  raise exception using errcode='22023',message='Select a floor and table for this order';
 end if;
 if p_operation in ('order_create','order_update') and p_payload ? 'table_id' then
  perform private.require_actor(false);
  select * into t from private.dining_tables where id=(p_payload->>'table_id')::uuid for share;
  if not found then raise exception using errcode='P0002',message='Select an existing table';end if;
  select * into f from private.floors where id=t.floor_id for share;
  result:=private.command_core_before_floor_tables(p_operation,p_payload,p_actor);
  update private.orders set table_id=t.id,floor_name_snapshot=f.name,table_name_snapshot=t.name,seats_snapshot=t.seats where id=(result->>'id')::uuid;
  return private.order_json((result->>'id')::uuid,(select role='manager' from private.profiles where id=p_actor));
 end if;
 if p_operation not in ('floor_create','floor_update','floor_delete','table_create','table_update','table_delete') then
  return private.command_core_before_floor_tables(p_operation,p_payload,p_actor);
 end if;
 if private.require_actor(true)<>p_actor then raise exception using errcode='42501',message='Manager required';end if;
 if p_operation like 'floor_%' then
  kind:='floors';
  if p_operation='floor_create' then
   insert into private.floors(name) values(btrim(p_payload->>'name')) returning * into f;
  else
   select * into f from private.floors where id=(p_payload->>'id')::uuid for update;
   if not found then raise exception using errcode='P0002',message='Floor not found';end if;
   perform private.expect_version(f.version,(p_payload->>'expected_version')::integer);before_data:=to_jsonb(f);
   if p_operation='floor_delete' then
    if exists(select 1 from private.dining_tables where floor_id=f.id) then raise exception using errcode='22023',message='Move or delete the tables on this floor first';end if;
    delete from private.floors where id=f.id;
   else
    update private.floors set name=btrim(p_payload->>'name'),version=version+1 where id=f.id returning * into f;
   end if;
  end if;
  entity:=f.id;result:=to_jsonb(f);
 else
  kind:='dining_tables';
  if p_operation<>'table_create' then
   select * into t from private.dining_tables where id=(p_payload->>'id')::uuid for update;
   if not found then raise exception using errcode='P0002',message='Table not found';end if;
   perform private.expect_version(t.version,(p_payload->>'expected_version')::integer);before_data:=to_jsonb(t);
  end if;
  if p_operation='table_delete' then
   if exists(select 1 from private.orders where table_id=t.id and status in ('pending','preparing','ready')) then raise exception using errcode='22023',message='Complete or cancel this table''s active orders before deleting it';end if;
   delete from private.dining_tables where id=t.id;
  else
   select * into f from private.floors where id=(p_payload->>'floor_id')::uuid for key share;
   if not found then raise exception using errcode='P0002',message='Floor not found';end if;
   if p_operation='table_create' then
    insert into private.dining_tables(floor_id,name,seats) values(f.id,btrim(p_payload->>'name'),(p_payload->>'seats')::integer) returning * into t;
   else
    update private.dining_tables set floor_id=f.id,name=btrim(p_payload->>'name'),seats=(p_payload->>'seats')::integer,version=version+1 where id=t.id returning * into t;
   end if;
  end if;
  entity:=t.id;result:=to_jsonb(t);
 end if;
 perform private.audit(p_actor,p_operation,kind,entity,before_data,result);
 return result;
end $$;
revoke all on function private.command_core(text,jsonb,uuid) from public,anon,authenticated,service_role;
grant execute on function private.command_core(text,jsonb,uuid) to sd_branch_executor;

alter function private.read_core(text,jsonb) rename to read_core_before_floor_tables;
create function private.read_core(p_resource text,p_params jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb; total integer; prof private.profiles; q text:=lower(coalesce(p_params->>'q','')); lim integer:=coalesce((p_params->>'limit')::integer,50); offst integer:=coalesce((p_params->>'offset')::integer,0);
begin
 if p_resource='receipt' then
  result:=private.read_core_before_floor_tables(p_resource,p_params);
  return result||jsonb_build_object('receipt_number',result->>'order_number');
 end if;
 if p_resource='orders' and q<>'' then
  select * into prof from private.profiles where id=private.require_actor(false);
  if lim not between 1 and 100 or offst<0 then raise exception using errcode='22023',message='Invalid pagination';end if;
  select count(*) into total from private.orders o where position(q in lower(concat_ws(' ',o.id,o.order_number,o.notes,o.floor_name_snapshot,o.table_name_snapshot)))>0 and (p_params->>'status' is null or o.status=p_params->>'status');
  select coalesce(jsonb_agg(private.order_json(x.id,prof.role='manager') order by x.created_at desc,x.id),'[]') into result from (
   select o.id,o.created_at from private.orders o where position(q in lower(concat_ws(' ',o.id,o.order_number,o.notes,o.floor_name_snapshot,o.table_name_snapshot)))>0 and (p_params->>'status' is null or o.status=p_params->>'status') order by o.created_at desc,o.id limit lim offset offst
  ) x;
  return private.json_decimals(jsonb_build_object('items',result,'total',total,'limit',lim,'offset',offst));
 end if;
 if p_resource not in ('floors','tables') then return private.read_core_before_floor_tables(p_resource,p_params);end if;
 select * into prof from private.profiles where id=private.require_actor(false);
 if prof.role<>'manager' and prof.staff_type<>'waiter' then raise exception using errcode='42501',message='Floor access requires manager or waiter';end if;
 if lim not between 1 and 100 or offst<0 then raise exception using errcode='22023',message='Invalid pagination';end if;
 if p_resource='floors' then
  select count(*) into total from private.floors;
  select coalesce(jsonb_agg(to_jsonb(x) order by x.name,x.id),'[]') into result from (
   select f.*,(select count(*) from private.dining_tables t where t.floor_id=f.id) as table_count,
    (select coalesce(sum(seats),0) from private.dining_tables t where t.floor_id=f.id) as total_seats
   from private.floors f order by f.name,f.id limit lim offset offst
  ) x;
 else
  select count(*) into total from private.dining_tables where floor_id=(p_params->>'floor_id')::uuid;
  select coalesce(jsonb_agg(to_jsonb(x) order by x.name,x.id),'[]') into result from (
   select * from private.dining_tables where floor_id=(p_params->>'floor_id')::uuid order by name,id limit lim offset offst
  ) x;
 end if;
 return jsonb_build_object('items',result,'total',total,'limit',lim,'offset',offst);
end $$;
alter function private.read_core(text,jsonb) owner to sd_branch_executor;
revoke all on function private.read_core(text,jsonb) from public,anon,service_role;
grant execute on function private.read_core(text,jsonb) to authenticated;
revoke all on function private.read_core_before_floor_tables(text,jsonb) from public,anon,authenticated,service_role;
