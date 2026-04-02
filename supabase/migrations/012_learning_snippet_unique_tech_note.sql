-- One published learning row per tech note (upsert from admin API).
-- Optional: store what the customer AI tried before the field fix (synthesize path).

alter table public.tech_notes add column if not exists prior_assistant_summary text;

create unique index if not exists learning_snippets_tech_note_id_key
  on public.learning_snippets (tech_note_id)
  where tech_note_id is not null;
