-- Migration 016: customer-facing download links.
--
-- The customer chat used to pivot to separate "Guides" and "Training" tabs
-- for users to find manuals. Those tabs are gone: the bot now surfaces
-- manuals directly in chat as tap-to-open links. To do that cleanly we
-- store, per document:
--   - file_url      -- public or signed HTTPS URL the customer can open
--                     on their phone (Supabase Storage public URL,
--                     Vercel Blob, or external CDN).
--   - display_title -- the human-readable title the bot should say when
--                     offering the link (e.g. "SS3015CP Operator Manual").
--                     Falls back to `title` if null.
--
-- Both are nullable so legacy rows stay valid; the chat only offers a
-- download when file_url is populated.

alter table public.knowledge_documents
  add column if not exists file_url text;

alter table public.knowledge_documents
  add column if not exists display_title text;

-- Helpful for the edge function to batch-load docs for the retrieved
-- chunks in one round-trip.
create index if not exists knowledge_documents_file_url_idx
  on public.knowledge_documents (id)
  where file_url is not null;

comment on column public.knowledge_documents.file_url is
  'Public or signed HTTPS URL served to customers as a download link in chat.';

comment on column public.knowledge_documents.display_title is
  'Optional human-friendly title shown alongside the download link.';
