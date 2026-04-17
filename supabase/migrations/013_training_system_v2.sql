-- V2 training/correction governance: channel-agnostic conversation refs, canonical facts, conflicts,
-- and deterministic runtime prompt activation constraints.

-- Ensure only one active prompt version per prompt_key.
create unique index if not exists prompt_versions_one_active_key
  on public.prompt_versions (prompt_key)
  where is_active = true;

-- Legacy tech_notes now support auth-channel references via corrections table.
alter table public.tech_notes alter column contact_id drop not null;
alter table public.tech_notes alter column session_id drop not null;

-- Admin corrections become first-class records with lifecycle + review status.
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

-- Canonical facts/rules derived from corrections. Runtime treats these as highest-priority policy.
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

-- Conflict review records (manual resolution required).
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

-- Persist exactly which context a given assistant reply used (audit/replay).
alter table public.support_chat_messages
  add column if not exists context_metadata jsonb not null default '{}'::jsonb;
alter table public.chat_messages
  add column if not exists context_metadata jsonb not null default '{}'::jsonb;

-- Make learning snippets correction-driven and lifecycle aware.
alter table public.learning_snippets add column if not exists correction_id uuid references public.corrections (id) on delete set null;
alter table public.learning_snippets add column if not exists status text not null default 'active' check (status in ('active','deprecated'));

create index if not exists learning_snippets_status_idx on public.learning_snippets (status, created_at desc);
create index if not exists learning_snippets_correction_idx on public.learning_snippets (correction_id, created_at desc);

-- Track materialized resolver version to prove immediate application.
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
