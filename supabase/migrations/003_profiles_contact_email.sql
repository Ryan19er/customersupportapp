-- Customer email for AI / support (used especially with anonymous auth where auth.users.email is empty).
alter table public.profiles add column if not exists contact_email text;

comment on column public.profiles.contact_email is 'Email the customer gave in-app for contact and AI context.';
