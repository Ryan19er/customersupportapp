-- =============================================================================
-- Stealth Support App — full schema (migrations 001–014; no 010 in repo)
-- =============================================================================
-- Run in Supabase: Dashboard → SQL Editor → New query → paste this file → Run.
-- Safe to re-run on a project that already has some objects: uses IF NOT EXISTS / guards.
-- Individual files: supabase/migrations/001_*.sql … 014_*.sql (no 010 in repo)
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

-- ############################################################################# 013
-- 013_training_system_v2.sql
-- #############################################################################

create unique index if not exists prompt_versions_one_active_key
  on public.prompt_versions (prompt_key)
  where is_active = true;

alter table public.tech_notes alter column contact_id drop not null;
alter table public.tech_notes alter column session_id drop not null;

create table if not exists public.corrections (
  id uuid primary key default gen_random_uuid(),
  source text not null check (source in ('manual_note','synthesized_note','training_chat','queue_resolution')),
  source_ref_id uuid,
  conversation_channel text not null check (conversation_channel in ('support','auth','training')),
  support_session_id uuid references public.support_chat_sessions (id) on delete set null,
  support_message_id uuid references public.support_chat_messages (id) on delete set null,
  auth_session_id uuid references public.chat_sessions (id) on delete set null,
  auth_message_id uuid references public.chat_messages (id) on delete set null,
  training_thread_id uuid references public.training_threads (id) on delete set null,
  customer_identifier text,
  machine_model text,
  machine_serial text,
  symptom_summary text not null,
  prior_ai_summary text,
  root_cause text not null,
  fix_steps text not null,
  parts_used text,
  tags text[] not null default '{}'::text[],
  auto_applied boolean not null default true,
  review_status text not null default 'pending' check (review_status in ('pending','approved','rejected')),
  conflict_status text not null default 'none' check (conflict_status in ('none','flagged','resolved')),
  reviewed_by text,
  reviewed_at timestamptz,
  created_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint corrections_channel_ref_check check (
    (conversation_channel = 'support' and support_session_id is not null) or
    (conversation_channel = 'auth' and auth_session_id is not null) or
    (conversation_channel = 'training' and training_thread_id is not null)
  )
);

create index if not exists corrections_created_idx on public.corrections (created_at desc);
create index if not exists corrections_review_idx on public.corrections (review_status, conflict_status, created_at desc);
create index if not exists corrections_tags_idx on public.corrections using gin (tags);
create index if not exists corrections_support_session_idx on public.corrections (support_session_id, created_at desc);
create index if not exists corrections_auth_session_idx on public.corrections (auth_session_id, created_at desc);

create table if not exists public.canonical_knowledge (
  id uuid primary key default gen_random_uuid(),
  correction_id uuid not null references public.corrections (id) on delete cascade,
  title text not null,
  law_text text not null,
  machine_model text,
  machine_serial text,
  tags text[] not null default '{}'::text[],
  status text not null default 'active' check (status in ('active','deprecated')),
  effective_from timestamptz not null default now(),
  effective_to timestamptz,
  created_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists canonical_knowledge_status_idx on public.canonical_knowledge (status, created_at desc);
create index if not exists canonical_knowledge_tags_idx on public.canonical_knowledge using gin (tags);

create table if not exists public.correction_conflicts (
  id uuid primary key default gen_random_uuid(),
  correction_id uuid not null references public.corrections (id) on delete cascade,
  canonical_knowledge_id uuid references public.canonical_knowledge (id) on delete set null,
  reason text not null,
  status text not null default 'open' check (status in ('open','resolved','dismissed')),
  resolved_by text,
  resolved_at timestamptz,
  resolution_note text,
  created_at timestamptz not null default now()
);

create index if not exists correction_conflicts_status_idx on public.correction_conflicts (status, created_at desc);

alter table public.support_chat_messages
  add column if not exists context_metadata jsonb not null default '{}'::jsonb;
alter table public.chat_messages
  add column if not exists context_metadata jsonb not null default '{}'::jsonb;

alter table public.learning_snippets add column if not exists correction_id uuid references public.corrections (id) on delete set null;
alter table public.learning_snippets add column if not exists status text not null default 'active' check (status in ('active','deprecated'));

create index if not exists learning_snippets_status_idx on public.learning_snippets (status, created_at desc);
create index if not exists learning_snippets_correction_idx on public.learning_snippets (correction_id, created_at desc);

create table if not exists public.runtime_learning_revisions (
  id bigint generated always as identity primary key,
  revision bigint not null generated always as identity,
  reason text not null,
  correction_id uuid references public.corrections (id) on delete set null,
  prompt_version_id uuid references public.prompt_versions (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists runtime_learning_revisions_created_idx
  on public.runtime_learning_revisions (created_at desc);

alter table public.corrections enable row level security;
alter table public.canonical_knowledge enable row level security;
alter table public.correction_conflicts enable row level security;
alter table public.runtime_learning_revisions enable row level security;

-- ############################################################################# 014
-- 014_knowledge_rag.sql
-- #############################################################################

-- Real RAG + learning engine V3: pgvector-backed per-product knowledge, evidence audit,
-- auto-grading, and gated correction review queue.

create extension if not exists vector;

alter table public.product_catalog add column if not exists slug text;
alter table public.product_catalog add column if not exists display_name text;
alter table public.product_catalog add column if not exists subsystems text[] not null default '{}'::text[];

create unique index if not exists product_catalog_slug_key
  on public.product_catalog (slug)
  where slug is not null;

insert into public.product_catalog (slug, display_name, product_name, model_family, aliases, subsystems)
values
  ('ss1510','SS1510 Compact Fiber Laser','SS1510','fiber_flat',
    array['ss1510','compact fiber','hypcut']::text[],
    array['motion','laser_source','assist_gas','chiller','controller','software','optics']::text[]),
  ('ss3015','SS3015 Nighthawk Open Fiber Laser','SS3015','fiber_flat_nighthawk',
    array['ss3015','ss4015','ss6015','ss4020','ss6020','nighthawk','blt420','blt641','hypcut']::text[],
    array['motion','laser_source','assist_gas','chiller','controller','optics','head']::text[]),
  ('ss3015cp','SS3015CP Nighthawk Enclosed Fiber Laser','SS3015CP','fiber_flat_nighthawk_cp',
    array['ss3015cp','ss4015cp','ss6015cp','ss4020cp','ss6020cp','nighthawk cp','enclosed','filtration']::text[],
    array['motion','laser_source','assist_gas','chiller','controller','optics','head','enclosure','filtration']::text[]),
  ('ss3015cpr','SS3015CPR Nighthawk Enclosed + Rotary','SS3015CPR','fiber_flat_nighthawk_cpr',
    array['ss3015cpr','cpr','rotary','tube attachment','pneumatic chuck']::text[],
    array['motion','laser_source','assist_gas','chiller','controller','optics','head','enclosure','rotary']::text[]),
  ('sl3015cp','SL3015CP Spirit Premium Fiber Laser','SL3015CP','fiber_flat_spirit',
    array['sl3015cp','sl4020cp','sl6020cp','spirit','max photonics','maxpar']::text[],
    array['motion','laser_source','assist_gas','chiller','controller','optics','head','enclosure']::text[]),
  ('x3','X3 High Power Enclosed Fiber Laser','X3','fiber_flat_x3',
    array['x3','30kw','max + ipg','highpower']::text[],
    array['motion','laser_source','assist_gas','chiller','controller','optics','head','enclosure','filtration']::text[]),
  ('ss2060','SS2060 Tube Fiber Laser (manual)','SS2060','tube_manual',
    array['ss2060','ss3060','raytools','lantek','power automation','higerman']::text[],
    array['motion','laser_source','assist_gas','chiller','controller','head','chuck','loading']::text[]),
  ('ss2060a','SS2060A Tube Fiber Laser (auto loader)','SS2060A','tube_auto',
    array['ss2060a','ss3060a','auto loader','bundle loader']::text[],
    array['motion','laser_source','assist_gas','chiller','controller','head','chuck','loading','automation']::text[]),
  ('slx1390','SLX1390 CO2 Non-metal Laser','SLX1390','co2',
    array['slx1390','co2','lightburn','80w','100w','130w','150w']::text[],
    array['motion','laser_source','optics','software','cooling_water','platform']::text[]),
  ('marking_laser','Fiber Marking Laser (Mini split)','FiberMarking','marking',
    array['marking','mini split','1064','lightburn','20w','30w','50w','60w']::text[],
    array['optics','software','rotary','cooling_air']::text[]),
  ('press_brake','eP-Press CNC Press Brake','eP-Press','press_brake',
    array['press brake','ep-press','ibend','iris','laser safe']::text[],
    array['hydraulics','controller','safety','tooling']::text[]),
  ('rapid_sander','Rapid Sander Automated Finishing','RapidSander','finishing',
    array['rapid sander','deburring','dust collector','finishing']::text[],
    array['abrasives','dust_collector','controller']::text[])
on conflict (slug) where slug is not null do update
  set display_name = excluded.display_name,
      aliases = excluded.aliases,
      subsystems = excluded.subsystems,
      model_family = excluded.model_family,
      updated_at = now();

alter table public.knowledge_documents add column if not exists product_slug text;
alter table public.knowledge_documents add column if not exists machine_family text;
alter table public.knowledge_documents add column if not exists subsystem text;
alter table public.knowledge_documents add column if not exists doc_type text not null default 'manual';
alter table public.knowledge_documents add column if not exists version text;
alter table public.knowledge_documents add column if not exists checksum text;
alter table public.knowledge_documents add column if not exists ingested_at timestamptz;
alter table public.knowledge_documents add column if not exists chunk_count integer not null default 0;
alter table public.knowledge_documents add column if not exists byte_size bigint;

create unique index if not exists knowledge_documents_checksum_key
  on public.knowledge_documents (checksum)
  where checksum is not null;

create index if not exists knowledge_documents_product_idx
  on public.knowledge_documents (product_slug, subsystem);

create table if not exists public.knowledge_chunks (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.knowledge_documents (id) on delete cascade,
  ord integer not null,
  heading text,
  text text not null,
  token_count integer not null default 0,
  product_slug text,
  machine_family text,
  subsystem text,
  symptom_tags text[] not null default '{}'::text[],
  error_codes text[] not null default '{}'::text[],
  embedding vector(384),
  tsv tsvector generated always as (to_tsvector('english', coalesce(heading,'') || ' ' || text)) stored,
  source_type text not null default 'manual',
  source_ref text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists knowledge_chunks_doc_ord_idx
  on public.knowledge_chunks (document_id, ord);
create index if not exists knowledge_chunks_product_idx
  on public.knowledge_chunks (product_slug, subsystem);
create index if not exists knowledge_chunks_tags_idx
  on public.knowledge_chunks using gin (symptom_tags);
create index if not exists knowledge_chunks_error_codes_idx
  on public.knowledge_chunks using gin (error_codes);
create index if not exists knowledge_chunks_tsv_idx
  on public.knowledge_chunks using gin (tsv);
create index if not exists knowledge_chunks_embedding_idx
  on public.knowledge_chunks using ivfflat (embedding vector_cosine_ops)
  with (lists = 100);

alter table public.canonical_knowledge add column if not exists product_slug text;
alter table public.canonical_knowledge add column if not exists subsystem text;
alter table public.canonical_knowledge add column if not exists symptom_tags text[] not null default '{}'::text[];
alter table public.canonical_knowledge add column if not exists error_codes text[] not null default '{}'::text[];
alter table public.canonical_knowledge add column if not exists embedding vector(384);

create index if not exists canonical_knowledge_product_idx
  on public.canonical_knowledge (product_slug, subsystem);
create index if not exists canonical_knowledge_tags_idx2
  on public.canonical_knowledge using gin (symptom_tags);
create index if not exists canonical_knowledge_error_codes_idx
  on public.canonical_knowledge using gin (error_codes);
create index if not exists canonical_knowledge_embedding_idx
  on public.canonical_knowledge using ivfflat (embedding vector_cosine_ops)
  with (lists = 50);

alter table public.learning_snippets add column if not exists product_slug text;
alter table public.learning_snippets add column if not exists subsystem text;
alter table public.learning_snippets add column if not exists symptom_tags text[] not null default '{}'::text[];
alter table public.learning_snippets add column if not exists error_codes text[] not null default '{}'::text[];
alter table public.learning_snippets add column if not exists embedding vector(384);

create index if not exists learning_snippets_product_idx
  on public.learning_snippets (product_slug, subsystem);
create index if not exists learning_snippets_tags_idx
  on public.learning_snippets using gin (symptom_tags);
create index if not exists learning_snippets_embedding_idx
  on public.learning_snippets using ivfflat (embedding vector_cosine_ops)
  with (lists = 50);

alter table public.canonical_knowledge drop constraint if exists canonical_knowledge_status_check;
alter table public.canonical_knowledge
  add constraint canonical_knowledge_status_check
  check (status in ('draft','active','deprecated','rejected'));

create table if not exists public.answer_audit (
  id uuid primary key default gen_random_uuid(),
  session_channel text not null check (session_channel in ('support','auth','training')),
  session_id uuid,
  message_id uuid,
  product_slug text,
  user_query text,
  assistant_text text,
  resolver_meta jsonb not null default '{}'::jsonb,
  evidence jsonb not null default '[]'::jsonb,
  prompt_version_id uuid references public.prompt_versions (id) on delete set null,
  model text,
  latency_ms integer,
  created_at timestamptz not null default now()
);

create index if not exists answer_audit_session_idx
  on public.answer_audit (session_channel, session_id, created_at desc);
create index if not exists answer_audit_product_idx
  on public.answer_audit (product_slug, created_at desc);

create table if not exists public.answer_grades (
  id uuid primary key default gen_random_uuid(),
  audit_id uuid not null references public.answer_audit (id) on delete cascade,
  scores jsonb not null default '{}'::jsonb,
  overall numeric(3,2),
  rationale text,
  grader_model text,
  auto_flagged boolean not null default false,
  flag_reason text,
  created_at timestamptz not null default now()
);

create index if not exists answer_grades_audit_idx on public.answer_grades (audit_id);
create index if not exists answer_grades_flag_idx on public.answer_grades (auto_flagged, created_at desc);

create table if not exists public.correction_review_queue (
  id uuid primary key default gen_random_uuid(),
  correction_id uuid references public.corrections (id) on delete set null,
  canonical_knowledge_id uuid references public.canonical_knowledge (id) on delete set null,
  audit_id uuid references public.answer_audit (id) on delete set null,
  source text not null check (source in ('admin_manual','admin_synthesized','admin_training','auto_flag','conflict')),
  priority text not null default 'normal' check (priority in ('low','normal','high','urgent')),
  reason text not null,
  proposed_title text,
  proposed_law_text text,
  proposed_machine_model text,
  proposed_product_slug text,
  status text not null default 'pending' check (status in ('pending','approved','rejected','edited')),
  reviewed_by text,
  reviewed_at timestamptz,
  review_notes text,
  created_by text not null default 'system',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists correction_review_queue_status_idx
  on public.correction_review_queue (status, priority, created_at desc);
create index if not exists correction_review_queue_source_idx
  on public.correction_review_queue (source, created_at desc);

create table if not exists public.query_embedding_cache (
  id uuid primary key default gen_random_uuid(),
  session_id uuid,
  query_hash text not null,
  embedding vector(384) not null,
  created_at timestamptz not null default now()
);

create index if not exists query_embedding_cache_hash_idx
  on public.query_embedding_cache (query_hash, created_at desc);
create index if not exists query_embedding_cache_session_idx
  on public.query_embedding_cache (session_id, created_at desc);

alter table public.knowledge_chunks enable row level security;
alter table public.answer_audit enable row level security;
alter table public.answer_grades enable row level security;
alter table public.correction_review_queue enable row level security;
alter table public.query_embedding_cache enable row level security;

drop policy if exists "knowledge_chunks_select_public" on public.knowledge_chunks;
create policy "knowledge_chunks_select_public"
  on public.knowledge_chunks for select
  to anon, authenticated
  using (true);

create or replace function public.retrieve_knowledge(
  p_query_embedding vector(384),
  p_query_text text,
  p_product_slug text default null,
  p_symptom_tags text[] default '{}'::text[],
  p_error_codes text[] default '{}'::text[],
  p_limit integer default 8
)
returns table (
  source_type text,
  source_id uuid,
  document_id uuid,
  text text,
  heading text,
  product_slug text,
  subsystem text,
  symptom_tags text[],
  error_codes text[],
  vector_score double precision,
  lexical_score double precision,
  tag_score double precision,
  total_score double precision
)
language plpgsql
stable
as $$
declare
  v_q tsquery;
begin
  begin
    v_q := websearch_to_tsquery('english', coalesce(p_query_text,''));
  exception when others then
    v_q := plainto_tsquery('english', coalesce(p_query_text,''));
  end;

  return query
  with chunk_hits as (
    select
      'chunk'::text as source_type,
      c.id as source_id,
      c.document_id,
      c.text,
      c.heading,
      c.product_slug,
      c.subsystem,
      c.symptom_tags,
      c.error_codes,
      case when c.embedding is null then 0.0
           else 1 - (c.embedding <=> p_query_embedding) end as vector_score,
      case when v_q is null then 0.0
           else coalesce(ts_rank(c.tsv, v_q), 0.0) end as lexical_score,
      (coalesce(cardinality(array(select unnest(c.symptom_tags) intersect select unnest(coalesce(p_symptom_tags,'{}')))), 0) * 0.10
        + coalesce(cardinality(array(select unnest(c.error_codes) intersect select unnest(coalesce(p_error_codes,'{}')))), 0) * 0.20)::double precision as tag_score
    from public.knowledge_chunks c
    where p_product_slug is null
       or c.product_slug is null
       or c.product_slug = p_product_slug
    order by c.embedding <=> p_query_embedding nulls last
    limit greatest(p_limit * 4, 32)
  ),
  canon_hits as (
    select
      'canonical'::text as source_type,
      k.id as source_id,
      null::uuid as document_id,
      k.law_text as text,
      k.title as heading,
      k.product_slug,
      k.subsystem,
      k.symptom_tags,
      k.error_codes,
      case when k.embedding is null then 0.0
           else 1 - (k.embedding <=> p_query_embedding) end as vector_score,
      0.0::double precision as lexical_score,
      (0.25
        + coalesce(cardinality(array(select unnest(k.symptom_tags) intersect select unnest(coalesce(p_symptom_tags,'{}')))), 0) * 0.10
        + coalesce(cardinality(array(select unnest(k.error_codes) intersect select unnest(coalesce(p_error_codes,'{}')))), 0) * 0.20)::double precision as tag_score
    from public.canonical_knowledge k
    where k.status = 'active'
      and (p_product_slug is null or k.product_slug is null or k.product_slug = p_product_slug)
    order by k.embedding <=> p_query_embedding nulls last
    limit greatest(p_limit, 10)
  ),
  snippet_hits as (
    select
      'snippet'::text as source_type,
      s.id as source_id,
      null::uuid as document_id,
      s.snippet_text as text,
      null::text as heading,
      s.product_slug,
      s.subsystem,
      s.symptom_tags,
      s.error_codes,
      case when s.embedding is null then 0.0
           else 1 - (s.embedding <=> p_query_embedding) end as vector_score,
      0.0::double precision as lexical_score,
      (0.15
        + coalesce(cardinality(array(select unnest(s.symptom_tags) intersect select unnest(coalesce(p_symptom_tags,'{}')))), 0) * 0.10
        + coalesce(cardinality(array(select unnest(s.error_codes) intersect select unnest(coalesce(p_error_codes,'{}')))), 0) * 0.20)::double precision as tag_score
    from public.learning_snippets s
    where s.status = 'active'
      and (p_product_slug is null or s.product_slug is null or s.product_slug = p_product_slug)
    order by s.embedding <=> p_query_embedding nulls last
    limit greatest(p_limit, 10)
  ),
  unioned as (
    select * from chunk_hits
    union all
    select * from canon_hits
    union all
    select * from snippet_hits
  )
  select
    source_type,
    source_id,
    document_id,
    text,
    heading,
    product_slug,
    subsystem,
    symptom_tags,
    error_codes,
    vector_score,
    lexical_score,
    tag_score,
    (coalesce(vector_score,0) * 0.70
     + coalesce(lexical_score,0) * 0.20
     + coalesce(tag_score,0) * 0.10) as total_score
  from unioned
  order by total_score desc
  limit p_limit;
end;
$$;

grant execute on function public.retrieve_knowledge(vector(384), text, text, text[], text[], integer)
  to anon, authenticated, service_role;

-- =============================================================================
-- Done. Admin panel needs service role + these tables; Flutter uses anon for chat.
-- =============================================================================
-- Fix: PostgreSQL was reporting "column reference 'source_type' is ambiguous"
-- because the RETURNS TABLE column names collide with the CTE column names of
-- the same name in the final SELECT. Qualifying every output with the CTE
-- alias resolves it.

drop function if exists public.retrieve_knowledge(vector(384), text, text, text[], text[], integer);

create or replace function public.retrieve_knowledge(
  p_query_embedding vector(384),
  p_query_text text,
  p_product_slug text default null,
  p_symptom_tags text[] default '{}'::text[],
  p_error_codes text[] default '{}'::text[],
  p_limit integer default 8
)
returns table (
  source_type text,
  source_id uuid,
  document_id uuid,
  text text,
  heading text,
  product_slug text,
  subsystem text,
  symptom_tags text[],
  error_codes text[],
  vector_score double precision,
  lexical_score double precision,
  tag_score double precision,
  total_score double precision
)
language plpgsql
stable
as $$
declare
  v_q tsquery;
begin
  begin
    v_q := websearch_to_tsquery('english', coalesce(p_query_text,''));
  exception when others then
    v_q := plainto_tsquery('english', coalesce(p_query_text,''));
  end;

  return query
  with chunk_hits as (
    select
      'chunk'::text as src_type,
      c.id as src_id,
      c.document_id as doc_id,
      c.text as src_text,
      c.heading as src_heading,
      c.product_slug as src_product,
      c.subsystem as src_subsystem,
      c.symptom_tags as src_tags,
      c.error_codes as src_codes,
      case when c.embedding is null then 0.0
           else 1 - (c.embedding <=> p_query_embedding) end as v_score,
      case when v_q is null then 0.0
           else coalesce(ts_rank(c.tsv, v_q), 0.0) end as l_score,
      (coalesce(cardinality(array(select unnest(c.symptom_tags) intersect select unnest(coalesce(p_symptom_tags,'{}')))), 0) * 0.10
        + coalesce(cardinality(array(select unnest(c.error_codes) intersect select unnest(coalesce(p_error_codes,'{}')))), 0) * 0.20)::double precision as t_score
    from public.knowledge_chunks c
    where p_product_slug is null
       or c.product_slug is null
       or c.product_slug = p_product_slug
    order by c.embedding <=> p_query_embedding nulls last
    limit greatest(p_limit * 4, 32)
  ),
  canon_hits as (
    select
      'canonical'::text as src_type,
      k.id as src_id,
      null::uuid as doc_id,
      k.law_text as src_text,
      k.title as src_heading,
      k.product_slug as src_product,
      k.subsystem as src_subsystem,
      k.symptom_tags as src_tags,
      k.error_codes as src_codes,
      case when k.embedding is null then 0.0
           else 1 - (k.embedding <=> p_query_embedding) end as v_score,
      0.0::double precision as l_score,
      (0.25
        + coalesce(cardinality(array(select unnest(k.symptom_tags) intersect select unnest(coalesce(p_symptom_tags,'{}')))), 0) * 0.10
        + coalesce(cardinality(array(select unnest(k.error_codes) intersect select unnest(coalesce(p_error_codes,'{}')))), 0) * 0.20)::double precision as t_score
    from public.canonical_knowledge k
    where k.status = 'active'
      and (p_product_slug is null or k.product_slug is null or k.product_slug = p_product_slug)
    order by k.embedding <=> p_query_embedding nulls last
    limit greatest(p_limit, 10)
  ),
  snippet_hits as (
    select
      'snippet'::text as src_type,
      s.id as src_id,
      null::uuid as doc_id,
      s.snippet_text as src_text,
      null::text as src_heading,
      s.product_slug as src_product,
      s.subsystem as src_subsystem,
      s.symptom_tags as src_tags,
      s.error_codes as src_codes,
      case when s.embedding is null then 0.0
           else 1 - (s.embedding <=> p_query_embedding) end as v_score,
      0.0::double precision as l_score,
      (0.15
        + coalesce(cardinality(array(select unnest(s.symptom_tags) intersect select unnest(coalesce(p_symptom_tags,'{}')))), 0) * 0.10
        + coalesce(cardinality(array(select unnest(s.error_codes) intersect select unnest(coalesce(p_error_codes,'{}')))), 0) * 0.20)::double precision as t_score
    from public.learning_snippets s
    where s.status = 'active'
      and (p_product_slug is null or s.product_slug is null or s.product_slug = p_product_slug)
    order by s.embedding <=> p_query_embedding nulls last
    limit greatest(p_limit, 10)
  ),
  unioned as (
    select * from chunk_hits
    union all
    select * from canon_hits
    union all
    select * from snippet_hits
  )
  select
    u.src_type        as source_type,
    u.src_id          as source_id,
    u.doc_id          as document_id,
    u.src_text        as text,
    u.src_heading     as heading,
    u.src_product     as product_slug,
    u.src_subsystem   as subsystem,
    u.src_tags        as symptom_tags,
    u.src_codes       as error_codes,
    u.v_score         as vector_score,
    u.l_score         as lexical_score,
    u.t_score         as tag_score,
    (coalesce(u.v_score,0) * 0.70
     + coalesce(u.l_score,0) * 0.20
     + coalesce(u.t_score,0) * 0.10) as total_score
  from unioned u
  order by total_score desc
  limit p_limit;
end;
$$;

grant execute on function public.retrieve_knowledge(vector(384), text, text, text[], text[], integer)
  to anon, authenticated, service_role;
