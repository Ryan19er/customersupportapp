-- Bulletin: support tickets + optional role / employee ID on profiles
-- Run in Supabase SQL Editor after 001_stealth_support_schema.sql

alter table public.profiles
  add column if not exists app_role text not null default 'customer',
  add column if not exists employee_id text;

comment on column public.profiles.app_role is 'customer | sales | technician | employee';
comment on column public.profiles.employee_id is 'Internal employee ID when app_role is employee';

create table if not exists public.support_tickets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  ticket_number text not null unique,
  subject text,
  status text not null default 'open',
  created_at timestamptz not null default now()
);

create index if not exists support_tickets_user_idx
  on public.support_tickets (user_id, created_at desc);

alter table public.support_tickets enable row level security;

drop policy if exists "tickets_own" on public.support_tickets;
create policy "tickets_own"
  on public.support_tickets for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
