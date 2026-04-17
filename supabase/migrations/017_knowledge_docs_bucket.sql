-- Migration 017: Supabase Storage bucket for admin-uploaded knowledge files.
--
-- Customer-facing chat surfaces these files as tap-to-open download links.
-- The admin panel uploads raw PDF/DOCX/TXT/MD via /api/admin/knowledge/upload;
-- that route writes to this bucket, captures the public URL, and ingests
-- the extracted text into knowledge_chunks so the RAG retriever can cite
-- the document on future customer turns.
--
-- Public-read bucket: customers get the plain object URL in their chat
-- reply and tap to download on their phone. Uploads are restricted to the
-- service role (admin API writes via service key), so there is no
-- customer-facing write path.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'knowledge-docs',
  'knowledge-docs',
  true,
  52428800, -- 50 MB per file
  array[
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/plain',
    'text/markdown',
    'application/zip'
  ]
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Read policy: anyone (including anonymous customers tapping a chat link)
-- can download objects from this bucket.
drop policy if exists "knowledge_docs_public_read" on storage.objects;
create policy "knowledge_docs_public_read"
  on storage.objects for select
  using (bucket_id = 'knowledge-docs');

-- Writes only via service_role (admin API). No policies for anon/authenticated
-- write on this bucket — service_role bypasses RLS so uploads work via the
-- admin server, and customer browsers cannot upload.
