-- NYUMBA SALAMA PHASE 2 — run this SQL in a NEW Supabase project SQL Editor.
-- Auth, profile creation, RLS and owner-managed property listings.
-- Never put a service_role key in the frontend.
create extension if not exists pgcrypto;
create table if not exists public.profiles (
 id uuid primary key references auth.users(id) on delete cascade,
 display_name text,
 role text not null default 'tenant' check (role in ('tenant','landlord','agent')),
 created_at timestamptz not null default now()
);
create or replace function public.new_user_profile() returns trigger language plpgsql security definer set search_path = '' as $$
begin
 insert into public.profiles(id,display_name) values(new.id,coalesce(new.raw_user_meta_data ->> 'display_name','')) on conflict (id) do nothing;
 return new;
end; $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute procedure public.new_user_profile();
insert into public.profiles(id,display_name) select id,coalesce(raw_user_meta_data ->> 'display_name','') from auth.users on conflict(id) do nothing;
create table if not exists public.properties (
 id uuid primary key default gen_random_uuid(),
 owner_id uuid not null references auth.users(id) on delete cascade,
 title text not null check(char_length(trim(title)) between 3 and 120),
 location text not null check(char_length(trim(location)) between 2 and 160),
 property_type text not null check(property_type in ('single','self','apartment','family')),
 monthly_rent numeric(14,2) not null check(monthly_rent > 0 and monthly_rent <= 1000000000),
 description text check(char_length(description) <= 1500),
 is_published boolean not null default false,
 is_verified boolean not null default false,
 created_at timestamptz not null default now()
);
create index if not exists properties_published_idx on public.properties(is_published,created_at desc);
create index if not exists properties_owner_idx on public.properties(owner_id);
alter table public.profiles enable row level security;
alter table public.properties enable row level security;
drop policy if exists profiles_read_own on public.profiles;
create policy profiles_read_own on public.profiles for select to authenticated using ((select auth.uid())=id);
-- No direct profile update policy: users cannot self-assign trusted roles.
drop policy if exists properties_read on public.properties;
create policy properties_read on public.properties for select to anon,authenticated using (is_published=true or (select auth.uid())=owner_id);
drop policy if exists properties_insert_own on public.properties;
create policy properties_insert_own on public.properties for insert to authenticated with check ((select auth.uid())=owner_id and is_verified=false);
drop policy if exists properties_update_own on public.properties;
create policy properties_update_own on public.properties for update to authenticated using ((select auth.uid())=owner_id) with check ((select auth.uid())=owner_id);
drop policy if exists properties_delete_own on public.properties;
create policy properties_delete_own on public.properties for delete to authenticated using ((select auth.uid())=owner_id);
-- Protect verified status: clients cannot set or change it, even when updating other columns.
revoke update on public.properties from anon,authenticated;
grant update(title,location,property_type,monthly_rent,description,is_published) on public.properties to authenticated;
revoke insert on public.properties from anon,authenticated;
grant insert(owner_id,title,location,property_type,monthly_rent,description,is_published) on public.properties to authenticated;
grant select,delete on public.properties to authenticated;
grant select on public.properties to anon;
grant select on public.profiles to authenticated;
