-- Partition internal training chat into threads (per tech, topic, or field report) so history stays organized.

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
