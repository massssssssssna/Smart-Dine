-- Retain sales and recipe references while removing dishes from the selectable menu.
alter table private.menu_items add column deleted_at timestamptz;
alter table private.menu_items drop constraint menu_items_branch_id_name_key;
create unique index menu_live_name_uq on private.menu_items(branch_id,name) where deleted_at is null;

alter function private.command_core(text,jsonb,uuid) rename to command_core_before_menu_delete;
create function private.command_core(p_operation text,p_payload jsonb,p_actor uuid) returns jsonb
language plpgsql set search_path='' as $$
declare item private.menu_items; result jsonb;
begin
 if p_operation='menu_delete' then
  if private.require_actor(true)<>p_actor then raise exception using errcode='42501',message='Actor mismatch';end if;
  select * into item from private.menu_items where id=(p_payload->>'id')::uuid and deleted_at is null for update;
  if not found then raise exception using errcode='P0002',message='Dish not found';end if;
  perform private.expect_version(item.version,(p_payload->>'expected_version')::integer);
  if exists(select 1 from private.order_items oi join private.orders o on o.id=oi.order_id where oi.menu_item_id=item.id and o.status in ('pending','preparing','ready')) then
   raise exception using errcode='40001',message='Complete or cancel active orders containing this dish before deleting it';
  end if;
  update private.menu_items set is_active=false,deleted_at=now(),updated_at=now(),version=version+1 where id=item.id;
  result:=jsonb_build_object('id',item.id,'status','deleted');
  perform private.audit(p_actor,'menu_delete','menu_items',item.id,to_jsonb(item),result);
  return result;
 end if;
 if p_operation in ('menu_update','recipe_set') and exists(select 1 from private.menu_items where id=(p_payload->>'id')::uuid and deleted_at is not null) then
  raise exception using errcode='P0002',message='Dish has been deleted';
 end if;
 return private.command_core_before_menu_delete(p_operation,p_payload,p_actor);
end $$;
revoke all on function private.command_core(text,jsonb,uuid) from public,anon,authenticated,service_role;
grant execute on function private.command_core(text,jsonb,uuid) to sd_branch_executor;

do $$ declare s text; begin
 s:=pg_get_functiondef('private.read_core(text,jsonb)'::regprocedure);
 s:=replace(s,'and (mgr or t.is_active)','and t.deleted_at is null and (mgr or t.is_active)');
 s:=replace(s,'where m.id=coalesce(id,(p_params->>''menu_item_id'')::uuid)','where m.deleted_at is null and m.id=coalesce(id,(p_params->>''menu_item_id'')::uuid)');
 execute s;
 s:=pg_get_functiondef('private.set_recipe(uuid,jsonb,integer,uuid)'::regprocedure);
 s:=replace(s,'where id=p_id for update','where id=p_id and deleted_at is null for update');
 execute s;
end $$;
