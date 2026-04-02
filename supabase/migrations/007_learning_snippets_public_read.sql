-- Allow the Flutter app (anon) to read learning snippets so technician notes improve AI replies.
-- Snippets are created from admin tech_notes; no sensitive columns beyond training text.

drop policy if exists "learning_snippets_select_public" on public.learning_snippets;
create policy "learning_snippets_select_public"
  on public.learning_snippets for select
  to anon, authenticated
  using (true);
