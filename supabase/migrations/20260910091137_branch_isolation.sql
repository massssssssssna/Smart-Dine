-- Branch ownership is database enforced, including calls made through RPCs.
create table private.branches(id uuid primary key default gen_random_uuid(), name text not null, created_at timestamptz not null default now());
insert into private.branches(name) values ('Main branch');
alter table private.profiles add column branch_id uuid references private.branches(id);
update private.profiles set branch_id=(select id from private.branches limit 1);
do $$ begin
 if (select count(*) from private.profiles where role='manager')>1 then
  raise exception 'Assign existing managers and records to branches before applying this migration';
 end if;
end $$;
create unique index one_manager_per_branch on private.profiles(branch_id) where role='manager';

create function private.current_branch() returns uuid language sql stable security definer set search_path='' as $$
 select coalesce((select branch_id from private.profiles where id=auth.uid()),nullif(current_setting('app.branch_id',true),'')::uuid)
$$;
revoke all on function private.current_branch() from public,anon,authenticated;

-- Inactive provisioning profiles may temporarily have no branch; activation must assign one.
create function private.assign_profile_branch() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.role='manager' and (new.branch_id is null or (tg_op='UPDATE' and old.role<>'manager')) then
  if not exists(select 1 from private.profiles where role='manager') then
   select id into new.branch_id from private.branches order by created_at limit 1;
  else
   insert into private.branches(name) values(new.full_name || ' branch') returning id into new.branch_id;
  end if;
 elsif new.branch_id is null then
  select p.branch_id into new.branch_id from private.user_provisioning u join private.profiles p on p.id=u.requested_by where lower(u.email)=lower(new.email);
 end if;
 if new.is_active and new.branch_id is null then raise exception using errcode='23514',message='Active accounts require a branch';end if;
 return new;
end $$;
create trigger assign_profile_branch before insert or update on private.profiles for each row execute function private.assign_profile_branch();

do $$ declare t record; begin
 for t in select tablename from pg_tables where schemaname='private' and tablename not in ('profiles','branches','bootstrap_state') loop
  execute format('alter table private.%I add column branch_id uuid references private.branches(id)',t.tablename);
  execute format('update private.%I set branch_id=(select id from private.branches limit 1)',t.tablename);
  execute format('alter table private.%I alter column branch_id set default private.current_branch(), alter column branch_id set not null',t.tablename);
 end loop;
end $$;
alter table private.ingredients drop constraint ingredients_name_key, add unique(branch_id,name);
alter table private.menu_items drop constraint menu_items_name_key, add unique(branch_id,name);
alter table private.daily_coverage drop constraint daily_coverage_pkey, add primary key(branch_id,day);

create function private.audit_branch() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.branch_id is null then
  select branch_id into new.branch_id from private.profiles where id=coalesce(new.actor_id,case when new.entity='profiles' then new.entity_id end);
 end if;
 return new;
end $$;
create trigger audit_branch before insert on private.audit_logs for each row execute function private.audit_branch();
revoke all on function private.audit_branch() from public,anon,authenticated,service_role;

-- Foreign keys also include branch ownership: a recipe/order cannot reference another branch.
do $$ declare r record; begin
 for r in select c.conrelid::regclass child,c.confrelid::regclass parent,c.conname,a.attname col,b.attname refcol
  from pg_constraint c join pg_namespace n on n.oid=c.connamespace
  join pg_attribute a on a.attrelid=c.conrelid and a.attnum=c.conkey[1]
  join pg_attribute b on b.attrelid=c.confrelid and b.attnum=c.confkey[1]
  where c.contype='f' and n.nspname='private' and array_length(c.conkey,1)=1
  and c.confrelid in(select oid from pg_class where relnamespace='private'::regnamespace)
  and c.confrelid<>'private.branches'::regclass
 loop
  execute format('create unique index if not exists %I on %s(branch_id,%I)',replace(r.parent::text,'.','_')||'_'||r.refcol||'_branch_uq',r.parent,r.refcol);
  if r.parent='private.profiles'::regclass then
   execute format('alter table %s drop constraint %I',r.child,r.conname);
   if r.child='private.idempotency_records'::regclass then
    execute format('alter table %s add constraint %I foreign key(%I) references private.profiles(id) on delete cascade',r.child,r.conname,r.col);
   else
    execute format('alter table %s alter column %I drop not null',r.child,r.col);
    execute format('alter table %s add constraint %I foreign key(%I) references private.profiles(id) on delete set null',r.child,r.conname,r.col);
   end if;
  end if;
  execute format('alter table %s add constraint %I foreign key(branch_id,%I) references %s(branch_id,%I)',r.child,r.conname||'_branch',r.col,r.parent,r.refcol);
 end loop;
end $$;

-- Normal calls run as a non-login, non-bypass role, never as the table owner.
do $$ begin if not exists(select 1 from pg_roles where rolname='sd_branch_executor') then create role sd_branch_executor nologin nobypassrls;end if;end $$;
grant usage on schema private,auth,extensions to sd_branch_executor;
grant select,insert,update,delete on all tables in schema private to sd_branch_executor;
grant usage,select on all sequences in schema private to sd_branch_executor;
grant select on auth.sessions to sd_branch_executor;
grant execute on all functions in schema private to sd_branch_executor;
grant execute on function auth.uid() to sd_branch_executor;

do $$ declare t record; begin
 for t in select tablename from pg_tables where schemaname='private' and tablename<>'bootstrap_state' loop
  execute format('alter table private.%I enable row level security',t.tablename);
  execute format('create index if not exists %I on private.%I(%I)',t.tablename||'_branch_idx',t.tablename,case when t.tablename='branches' then 'id' else 'branch_id' end);
  execute format('create policy branch_isolation on private.%I to sd_branch_executor using (%I=private.current_branch() or (nullif(current_setting(''request.jwt.claims'',true),'''')::jsonb->>''role''=''service_role'' and private.current_branch() is null)) with check (%I=private.current_branch() or (nullif(current_setting(''request.jwt.claims'',true),'''')::jsonb->>''role''=''service_role'' and private.current_branch() is null))',t.tablename,case when t.tablename='branches' then 'id' else 'branch_id' end,case when t.tablename='branches' then 'id' else 'branch_id' end);
 end loop;
end $$;
create policy internal_bootstrap on private.bootstrap_state to sd_branch_executor using (true) with check (true);

-- Preserve original workflows, adding staff-only guards before any mutation.
do $$ declare s text; begin
 s:=pg_get_functiondef('private.read_core(text,jsonb)'::regprocedure);
 s:=replace(s,'from private.profiles t where id is null or t.id=id','from private.profiles t where t.role=''staff'' and (id is null or t.id=id)');
 execute s;
 s:=pg_get_functiondef('private.command_core(text,jsonb,uuid)'::regprocedure);
 s:=replace(s,'elsif p_operation=''user_update'' then','elsif p_operation=''user_update'' then
 if coalesce(p_payload->>''role'',''staff'')<>''staff'' or not exists(select 1 from private.profiles where profiles.id=id and role=''staff'') then raise exception using errcode=''42501'',message=''Only staff accounts can be managed in the portal'';end if;');
 execute s;
 s:=pg_get_functiondef('private.service_core(text,jsonb)'::regprocedure);
 s:=replace(s,'if p_operation=''reserve_user'' then','if p_operation=''reserve_user'' then
 if coalesce(p_payload->>''role'',''staff'')<>''staff'' then raise exception using errcode=''42501'',message=''Managers are provisioned by the database owner only'';end if;');
 s:=replace(s,'if prov.status=''active'' then if prov.user_id<>uid','if prov.role<>''staff'' then raise exception using errcode=''42501'',message=''Only staff provisioning is allowed'';end if;
 if prov.status=''active'' then if prov.user_id<>uid');
 s:=replace(s,'update private.profiles set role=prov.role,','update private.profiles set branch_id=(select branch_id from private.profiles where profiles.id=actor),role=prov.role,');
 execute s;
 s:=pg_get_functiondef('private.command_intelligence(text,jsonb,uuid)'::regprocedure);
 s:=replace(s,'on conflict(day) do nothing','on conflict(branch_id,day) do nothing');execute s;
end $$;

-- Service calls establish a trusted branch from stored records, not from a client branch field.
alter function private.service_core(text,jsonb) rename to service_core_unscoped;
create function private.service_core(p_operation text,p_payload jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' as $$
declare b uuid; result jsonb;
begin
 perform private.require_service();
 if p_payload->>'actor_id' is not null then select branch_id into b from private.profiles where id=(p_payload->>'actor_id')::uuid;
 elsif p_payload->>'job_id' is not null then select branch_id into b from private.processing_jobs where id=(p_payload->>'job_id')::uuid;
 elsif p_payload->>'review_id' is not null then select branch_id into b from private.reviews where id=(p_payload->>'review_id')::uuid;
 elsif p_payload->>'menu_item_id' is not null then select branch_id into b from private.menu_items where id=(p_payload->>'menu_item_id')::uuid;
 elsif p_operation='review_submit' then select branch_id into b from private.review_tokens where token_hash=encode(extensions.digest(p_payload->>'token','sha256'),'hex');
 end if;
 perform set_config('app.branch_id',coalesce(b::text,''),true);
 result:=private.service_core_unscoped(p_operation,p_payload);
 return result;
end $$;

-- Known wrappers must use the scoped service entry point (SQL bodies are text).
create or replace function public.sd_service(p_operation text,p_payload jsonb default '{}') returns jsonb language sql security invoker set search_path='' as $$ select private.service_core(p_operation,p_payload) $$;
alter function private.read_core(text,jsonb) owner to sd_branch_executor;
alter function private.command_core(text,jsonb,uuid) owner to sd_branch_executor;
alter function private.execute_command(text,jsonb,text) owner to sd_branch_executor;
alter function private.service_core_unscoped(text,jsonb) owner to sd_branch_executor;
-- The service wrapper is trusted to resolve the branch; its callee applies RLS.
revoke all on function private.service_core(text,jsonb) from public,anon,authenticated;
revoke all on function private.service_core_unscoped(text,jsonb) from public,anon,authenticated,service_role;
grant execute on function private.service_core(text,jsonb) to service_role;
grant execute on all functions in schema private to sd_branch_executor;

create function public.sd_delete_staff(p_user_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=private.require_actor(true); target private.profiles; b uuid;
begin
 select branch_id into b from private.profiles where id=actor for update;
 select * into target from private.profiles where id=p_user_id for update;
 if not found or target.role<>'staff' or target.branch_id is distinct from b then raise exception using errcode='42501',message='Only your branch staff can be deleted';end if;
 perform set_config('app.branch_id',b::text,true);
 perform private.audit(actor,'staff_deleted','profiles',target.id,null,jsonb_build_object('full_name',target.full_name));
 delete from auth.sessions where user_id=target.id;
 delete from private.user_provisioning where user_id=target.id or email=target.email;
 delete from private.profiles where id=target.id;
 delete from auth.users where id=target.id;
 return jsonb_build_object('status','deleted','id',p_user_id);
end $$;
revoke all on function public.sd_delete_staff(uuid) from public,anon,service_role;
grant execute on function public.sd_delete_staff(uuid) to authenticated;
revoke all on private.branches from public,anon,authenticated,service_role;
revoke all on function private.assign_profile_branch() from public,anon,authenticated,service_role;
