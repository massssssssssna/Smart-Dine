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
