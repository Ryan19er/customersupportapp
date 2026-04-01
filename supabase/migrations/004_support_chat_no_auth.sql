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
