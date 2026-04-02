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

