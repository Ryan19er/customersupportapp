-- =============================================================================
-- Stealth Support App — full schema (migrations 001–012; no 010 in repo)
-- =============================================================================
-- Run in Supabase: Dashboard → SQL Editor → New query → paste this file → Run.
-- Safe to re-run on a project that already has some objects: uses IF NOT EXISTS / guards.
-- Individual files: supabase/migrations/001_*.sql … 009_*.sql, 011_*.sql, 012_*.sql
-- =============================================================================

-- ############################################################################# 001
-- 001_stealth_support_schema.sql
-- #############################################################################

-- Stealth Support: profiles, chat sessions, messages — run in Supabase SQL Editor (once).
-- Enables email/password auth, customer data retention, and resumable Claude chat history.

-- ---------------------------------------------------------------------------
-- Profiles (1:1 with auth.users)
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text,
  phone text,
  company_name text,
  machine_model text,
  machine_serial text,
  onboarding_completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists profiles_updated_at_idx on public.profiles (updated_at desc);

-- ---------------------------------------------------------------------------
-- Chat: one rolling session per user (pick up where they left off)
-- ---------------------------------------------------------------------------
create table if not exists public.chat_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  title text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists chat_sessions_user_updated_idx
  on public.chat_sessions (user_id, updated_at desc);

-- ---------------------------------------------------------------------------
-- Messages (ordered thread)
-- ---------------------------------------------------------------------------
create table if not exists public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.chat_sessions (id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  created_at timestamptz not null default now()
);

create index if not exists chat_messages_session_created_idx
  on public.chat_messages (session_id, created_at asc);

create or replace function public.touch_session_on_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.chat_sessions set updated_at = now() where id = new.session_id;
  return new;
end;
$$;

drop trigger if exists chat_messages_touch_session on public.chat_messages;
create trigger chat_messages_touch_session
  after insert on public.chat_messages
  for each row execute procedure public.touch_session_on_message();

-- ---------------------------------------------------------------------------
-- Auto-create profile row when a user signs up
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id)
  values (new.id)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ---------------------------------------------------------------------------
-- updated_at touch
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute procedure public.set_updated_at();

drop trigger if exists chat_sessions_set_updated_at on public.chat_sessions;
create trigger chat_sessions_set_updated_at
  before update on public.chat_sessions
  for each row execute procedure public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.chat_sessions enable row level security;
alter table public.chat_messages enable row level security;

drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own"
  on public.profiles for select
  using (auth.uid() = id);

drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own"
  on public.profiles for insert
  with check (auth.uid() = id);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
  on public.profiles for update
  using (auth.uid() = id);

drop policy if exists "sessions_all_own" on public.chat_sessions;
create policy "sessions_all_own"
  on public.chat_sessions for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "messages_select_own_session" on public.chat_messages;
create policy "messages_select_own_session"
  on public.chat_messages for select
  using (
    exists (
      select 1 from public.chat_sessions s
      where s.id = chat_messages.session_id and s.user_id = auth.uid()
    )
  );

drop policy if exists "messages_insert_own_session" on public.chat_messages;
create policy "messages_insert_own_session"
  on public.chat_messages for insert
  with check (
    exists (
      select 1 from public.chat_sessions s
      where s.id = chat_messages.session_id and s.user_id = auth.uid()
    )
  );

drop policy if exists "messages_delete_own_session" on public.chat_messages;
create policy "messages_delete_own_session"
  on public.chat_messages for delete
  using (
    exists (
      select 1 from public.chat_sessions s
      where s.id = chat_messages.session_id and s.user_id = auth.uid()
    )
  );

-- ############################################################################# 002
-- 002_bulletin_tickets_roles.sql
-- #############################################################################

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

-- ############################################################################# 003
-- 003_profiles_contact_email.sql
-- #############################################################################

-- Customer email for AI / support (used especially with anonymous auth where auth.users.email is empty).
alter table public.profiles add column if not exists contact_email text;

comment on column public.profiles.contact_email is 'Email the customer gave in-app for contact and AI context.';

-- ############################################################################# 004
-- 004_support_chat_no_auth.sql
-- #############################################################################

-- Chat + contact info with **no Supabase Auth** (anon key only). Run after 001/002/003.
-- Stores name, email, phone + messages so the AI can load history later.

create table if not exists public.chat_contacts (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  email text not null,
  phone text not null,
  machine_model text default '—',
  machine_serial text default '—',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists chat_contacts_email_lower_idx on public.chat_contacts (lower(email));

create table if not exists public.support_chat_sessions (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid not null references public.chat_contacts (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists support_chat_sessions_contact_idx
  on public.support_chat_sessions (contact_id, updated_at desc);

create table if not exists public.support_chat_messages (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.support_chat_sessions (id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  created_at timestamptz not null default now()
);

create index if not exists support_chat_messages_session_idx
  on public.support_chat_messages (session_id, created_at asc);

create or replace function public.touch_support_chat_session()
returns trigger
language plpgsql
as $$
begin
  update public.support_chat_sessions set updated_at = now() where id = new.session_id;
  return new;
end;
$$;

drop trigger if exists support_chat_messages_touch on public.support_chat_messages;
create trigger support_chat_messages_touch
  after insert on public.support_chat_messages
  for each row execute function public.touch_support_chat_session();

alter table public.chat_contacts enable row level security;
alter table public.support_chat_sessions enable row level security;
alter table public.support_chat_messages enable row level security;

-- Internal support app: anon can read/write these tables (tighten later with Edge Functions if needed).
drop policy if exists "chat_contacts_anon" on public.chat_contacts;
create policy "chat_contacts_anon"
  on public.chat_contacts for all
  to anon
  using (true)
  with check (true);

drop policy if exists "support_sessions_anon" on public.support_chat_sessions;
create policy "support_sessions_anon"
  on public.support_chat_sessions for all
  to anon
  using (true)
  with check (true);

drop policy if exists "support_messages_anon" on public.support_chat_messages;
create policy "support_messages_anon"
  on public.support_chat_messages for all
  to anon
  using (true)
  with check (true);

-- ############################################################################# 005
-- 005_contact_identity_normalization.sql
-- #############################################################################

-- Normalize contact identity fields so returning-customer matching is reliable.
-- Run after 004_support_chat_no_auth.sql.

do $$
begin
  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'chat_contacts'
      and column_name = 'normalized_name'
  ) then
    alter table public.chat_contacts
      add column normalized_name text generated always as (
        lower(regexp_replace(trim(full_name), '\s+', ' ', 'g'))
      ) stored;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'chat_contacts'
      and column_name = 'normalized_email'
  ) then
    alter table public.chat_contacts
      add column normalized_email text generated always as (
        lower(trim(email))
      ) stored;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'chat_contacts'
      and column_name = 'normalized_phone'
  ) then
    alter table public.chat_contacts
      add column normalized_phone text generated always as (
        regexp_replace(phone, '[^0-9]', '', 'g')
      ) stored;
  end if;
end $$;

create index if not exists chat_contacts_identity_lookup_idx
  on public.chat_contacts (normalized_name, normalized_email, normalized_phone);

-- ############################################################################# 006
-- 006_technician_learning_admin.sql
-- #############################################################################

-- Technician learning/admin schema
-- Supports internal notes, issue patterns, product catalog, prompt versioning, and training chat logs.

create table if not exists public.tech_notes (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid not null references public.chat_contacts (id) on delete cascade,
  session_id uuid not null references public.support_chat_sessions (id) on delete cascade,
  message_id uuid references public.support_chat_messages (id) on delete set null,
  symptoms text not null,
  root_cause text not null,
  fix_steps text not null,
  parts_used text,
  machine_model text,
  machine_serial text,
  tags text[] not null default '{}',
  created_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists tech_notes_session_idx on public.tech_notes (session_id, created_at desc);
create index if not exists tech_notes_contact_idx on public.tech_notes (contact_id, created_at desc);
create index if not exists tech_notes_tags_idx on public.tech_notes using gin (tags);

create table if not exists public.learning_snippets (
  id uuid primary key default gen_random_uuid(),
  tech_note_id uuid references public.tech_notes (id) on delete cascade,
  snippet_text text not null,
  machine_model text,
  machine_serial text,
  issue_tags text[] not null default '{}',
  confidence numeric not null default 0.5,
  created_at timestamptz not null default now()
);

create index if not exists learning_snippets_created_idx on public.learning_snippets (created_at desc);
create index if not exists learning_snippets_tags_idx on public.learning_snippets using gin (issue_tags);

create table if not exists public.product_catalog (
  id uuid primary key default gen_random_uuid(),
  product_name text not null,
  model_family text,
  aliases text[] not null default '{}',
  specs_json jsonb not null default '{}'::jsonb,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists product_catalog_status_idx on public.product_catalog (status);
create index if not exists product_catalog_name_idx on public.product_catalog (product_name);

create table if not exists public.issue_patterns (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  symptom_keywords text[] not null default '{}',
  likely_causes text not null default '',
  diagnostic_steps text not null default '',
  fix_template text not null default '',
  confidence_default numeric not null default 0.5,
  created_by text not null default 'admin',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists issue_patterns_title_idx on public.issue_patterns (title);
create index if not exists issue_patterns_symptom_keywords_idx on public.issue_patterns using gin (symptom_keywords);

create table if not exists public.knowledge_documents (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  source_type text not null default 'manual',
  source_ref text,
  raw_text text not null,
  chunk_status text not null default 'pending',
  created_by text not null default 'admin',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists knowledge_documents_source_idx on public.knowledge_documents (source_type, created_at desc);

create table if not exists public.prompt_versions (
  id uuid primary key default gen_random_uuid(),
  prompt_key text not null,
  version integer not null,
  markdown_content text not null,
  change_summary text not null,
  created_by text not null,
  is_active boolean not null default false,
  created_at timestamptz not null default now(),
  unique (prompt_key, version)
);

create index if not exists prompt_versions_key_idx on public.prompt_versions (prompt_key, version desc);
create index if not exists prompt_versions_active_idx on public.prompt_versions (prompt_key, is_active);

create table if not exists public.training_chat_messages (
  id uuid primary key default gen_random_uuid(),
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  created_by text not null,
  created_at timestamptz not null default now()
);

create index if not exists training_chat_messages_created_idx on public.training_chat_messages (created_at asc);

create table if not exists public.learning_events (
  id uuid primary key default gen_random_uuid(),
  event_type text not null,
  reference_id uuid,
  payload jsonb not null default '{}'::jsonb,
  created_by text not null default 'admin',
  created_at timestamptz not null default now()
);

create index if not exists learning_events_type_idx on public.learning_events (event_type, created_at desc);

alter table public.tech_notes enable row level security;
alter table public.learning_snippets enable row level security;
alter table public.product_catalog enable row level security;
alter table public.issue_patterns enable row level security;
alter table public.knowledge_documents enable row level security;
alter table public.prompt_versions enable row level security;
alter table public.training_chat_messages enable row level security;
alter table public.learning_events enable row level security;

-- ############################################################################# 007
-- 007_learning_snippets_public_read.sql
-- #############################################################################

-- Allow the Flutter app (anon) to read learning snippets so technician notes improve AI replies.
-- Snippets are created from admin tech_notes; no sensitive columns beyond training text.

drop policy if exists "learning_snippets_select_public" on public.learning_snippets;
create policy "learning_snippets_select_public"
  on public.learning_snippets for select
  to anon, authenticated
  using (true);

-- ############################################################################# 008
-- 008_admin_customer_question_queue.sql
-- #############################################################################

-- Queue of hard / ambiguous customer questions surfaced in admin training chat for technicians to answer.

create table if not exists public.admin_customer_question_queue (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  detail text,
  source text not null default 'training_chat',
  status text not null default 'open' check (status in ('open', 'resolved')),
  contact_id uuid references public.chat_contacts (id) on delete set null,
  session_id uuid references public.support_chat_sessions (id) on delete set null,
  created_by text not null default 'admin',
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by text
);

create index if not exists admin_customer_question_queue_status_idx
  on public.admin_customer_question_queue (status, created_at desc);

alter table public.admin_customer_question_queue enable row level security;

-- ############################################################################# 009
-- 009_seed_default_prompt_version.sql
-- #############################################################################

-- So the admin panel is never empty on first deploy: one active prompt row for support-system.
-- Replace content in Admin with full text from `lib/config/stealth_system_prompt.dart` when ready.

insert into public.prompt_versions (prompt_key, version, markdown_content, change_summary, created_by, is_active)
select
  'support-system',
  1,
  $seed$## Stealth customer AI — default system prompt (seed)

This row was created by migration 009 so the admin panel has something to edit.
Replace this with the full prompt from the Flutter app (`stealth_system_prompt.dart`) or your canonical KB.

### Role
You are the official Stealth Machine Tools customer-support assistant. Help with equipment, troubleshooting, safety, and how to reach Stealth.
$seed$,
  'Seed v1 from migration 009',
  'system',
  true
where not exists (
  select 1 from public.prompt_versions where prompt_key = 'support-system'
);

-- ############################################################################# 011
-- 011_training_threads.sql
-- #############################################################################

create table if not exists public.training_threads (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  created_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists training_threads_updated_idx on public.training_threads (updated_at desc);

alter table public.training_chat_messages add column if not exists thread_id uuid references public.training_threads (id) on delete cascade;

do $$
declare
  default_tid uuid;
begin
  if not exists (select 1 from public.training_threads) then
    insert into public.training_threads (title, created_by)
    values ('General', 'system')
    returning id into default_tid;
  else
    select id into default_tid from public.training_threads order by created_at asc limit 1;
  end if;

  update public.training_chat_messages
  set thread_id = default_tid
  where thread_id is null;
end $$;

alter table public.training_chat_messages alter column thread_id set not null;

create index if not exists training_chat_messages_thread_created_idx
  on public.training_chat_messages (thread_id, created_at asc);

create or replace function public.touch_training_thread_on_message()
returns trigger
language plpgsql
as $$
begin
  update public.training_threads set updated_at = now() where id = new.thread_id;
  return new;
end;
$$;

drop trigger if exists training_chat_messages_touch_thread on public.training_chat_messages;
create trigger training_chat_messages_touch_thread
  after insert on public.training_chat_messages
  for each row execute function public.touch_training_thread_on_message();

alter table public.training_threads enable row level security;

-- ############################################################################# 012
-- 012_learning_snippet_unique_tech_note.sql
-- #############################################################################

alter table public.tech_notes add column if not exists prior_assistant_summary text;

create unique index if not exists learning_snippets_tech_note_id_key
  on public.learning_snippets (tech_note_id)
  where tech_note_id is not null;

-- =============================================================================
-- Done. Admin panel needs service role + these tables; Flutter uses anon for chat.
-- =============================================================================
