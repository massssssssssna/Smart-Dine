begin;
do $$
declare uid uuid:=gen_random_uuid();
begin
 insert into auth.users(id,email,raw_app_meta_data) values(uid,'portal-test@example.invalid','{}');
 update auth.users set raw_app_meta_data='{"managed_account":true}' where id=uid;
 set constraints all immediate;
 insert into auth.sessions(id,user_id) values(gen_random_uuid(),uid);
 update auth.users set email='portal-updated@example.invalid',encrypted_password='test-hash' where id=uid;
 if exists(select 1 from auth.sessions where user_id=uid) then raise exception 'Credentials did not revoke sessions'; end if;
 if not exists(select 1 from private.profiles where id=uid and email='portal-updated@example.invalid') then raise exception 'Profile email not synchronized'; end if;
end $$;
rollback;
