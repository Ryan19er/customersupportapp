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
