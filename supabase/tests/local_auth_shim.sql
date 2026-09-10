-- Disposable PostgreSQL ONLY. Never run against an existing Supabase project.
do $$ begin
 if not exists(select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
 if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
 if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role nologin bypassrls; end if;
end $$;
create schema auth;
create table auth.users(id uuid primary key, email text unique, encrypted_password text, raw_app_meta_data jsonb not null default '{}', raw_user_meta_data jsonb not null default '{}');
create table auth.sessions(id uuid primary key,user_id uuid not null references auth.users(id));
create function auth.uid() returns uuid language sql stable as $$select (nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid$$;
