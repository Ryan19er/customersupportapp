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

