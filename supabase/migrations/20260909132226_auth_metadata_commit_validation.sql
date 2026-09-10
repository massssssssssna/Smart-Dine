-- GoTrue adds admin app_metadata after INSERT within the same transaction.
-- Keep profile creation immediate, but enforce the marker on committed state.
create or replace function private.validate_managed_user() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 insert into private.profiles(id,email,full_name,role,is_active)
 values(new.id,lower(new.email),coalesce(nullif(new.raw_user_meta_data->>'full_name',''),'Pending account'),'staff',false);
 return new;
end $$;

create function private.check_managed_user_commit() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from auth.users where id=new.id and
   coalesce((raw_app_meta_data->>'managed_account')::boolean,false) is not true) then
   raise exception using errcode='42501',message='Accounts must be provisioned by a manager';
 end if;
 return new;
end $$;
revoke all on function private.check_managed_user_commit() from public,anon,authenticated;
create constraint trigger smartdine_managed_account_commit after insert on auth.users
deferrable initially deferred for each row execute function private.check_managed_user_commit();
