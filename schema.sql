-- NYUMBA SALAMA: starter PostgreSQL data model.
-- Not connected to frontend. Add Supabase Auth/RLS and permission policies BEFORE exposing via API.
create extension if not exists pgcrypto;
create table if not exists profiles (
 id uuid primary key default gen_random_uuid(),
 display_name text not null,
 phone text,
 role text not null default 'tenant' check (role in ('tenant','landlord','agent','admin')),
 created_at timestamptz not null default now()
);
create table if not exists properties (
 id uuid primary key default gen_random_uuid(),
 owner_id uuid not null references profiles(id),
 title text not null,
 location text not null,
 property_type text not null check(property_type in ('single','self','apartment','family')),
 monthly_rent numeric(14,2) not null check(monthly_rent > 0),
 description text,
 is_published boolean not null default false,
 is_verified boolean not null default false,
 created_at timestamptz not null default now()
);
create table if not exists tenancies (
 id uuid primary key default gen_random_uuid(),
 property_id uuid not null references properties(id),
 tenant_id uuid not null references profiles(id),
 starts_on date not null,
 ends_on date,
 rent_amount numeric(14,2) not null check(rent_amount>0),
 status text not null default 'pending' check(status in ('pending','active','ended','cancelled'))
);
create table if not exists rent_invoices (
 id uuid primary key default gen_random_uuid(),
 tenancy_id uuid not null references tenancies(id),
 due_on date not null,
 amount numeric(14,2) not null check(amount>=0),
 status text not null default 'unpaid' check(status in ('unpaid','partial','paid','void'))
);
create table if not exists payments (
 id uuid primary key default gen_random_uuid(),
 invoice_id uuid references rent_invoices(id),
 provider text,
 provider_reference text unique,
 amount numeric(14,2) not null check(amount>0),
 status text not null default 'pending' check(status in ('pending','confirmed','failed','refunded')),
 verified_at timestamptz,
 created_at timestamptz not null default now()
);
create table if not exists maintenance_requests (
 id uuid primary key default gen_random_uuid(),
 property_id uuid not null references properties(id),
 reported_by uuid not null references profiles(id),
 category text not null,
 description text not null,
 status text not null default 'open' check(status in ('open','assigned','in_progress','resolved','closed')),
 created_at timestamptz not null default now()
);
create table if not exists utility_meters (
 id uuid primary key default gen_random_uuid(),
 property_id uuid not null references properties(id),
 label text not null
);
create table if not exists meter_members (
 meter_id uuid not null references utility_meters(id),
 tenant_id uuid not null references profiles(id),
 primary key(meter_id,tenant_id)
);
create table if not exists luku_purchases (
 id uuid primary key default gen_random_uuid(),
 meter_id uuid not null references utility_meters(id),
 amount numeric(14,2) not null check(amount>0),
 created_at timestamptz not null default now()
);
create table if not exists luku_splits (
 id uuid primary key default gen_random_uuid(),
 purchase_id uuid not null references luku_purchases(id),
 tenant_id uuid not null references profiles(id),
 amount_due numeric(14,2) not null check(amount_due>=0),
 unique(purchase_id,tenant_id)
);
create table if not exists roommate_posts (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references profiles(id),
 location text not null,
 monthly_budget numeric(14,2) not null check(monthly_budget>0),
 preference text,
 created_at timestamptz not null default now()
);
create table if not exists reviews (
 id uuid primary key default gen_random_uuid(),
 property_id uuid not null references properties(id),
 reviewer_id uuid not null references profiles(id),
 tenancy_id uuid references tenancies(id),
 rating smallint not null check(rating between 1 and 5),
 comment text,
 is_visible boolean not null default false,
 created_at timestamptz not null default now()
);
create table if not exists contract_drafts (
 id uuid primary key default gen_random_uuid(),
 tenancy_id uuid not null references tenancies(id),
 body text not null,
 status text not null default 'draft' check(status in ('draft','under_review','approved','cancelled')),
 created_at timestamptz not null default now()
);
-- SECURITY TODO: map profiles to auth.users, enable RLS on every exposed table,
-- create tenant/owner policies, protect private files and verify payment webhooks server-side.
