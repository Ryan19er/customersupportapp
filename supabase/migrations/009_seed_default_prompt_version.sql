-- So the admin panel is never empty on first deploy: one active prompt row for support-system.
-- Replace content in Admin with full text from `lib/config/stealth_system_prompt.dart` when ready.

insert into public.prompt_versions (prompt_key, version, markdown_content, change_summary, created_by, is_active)
select
  'support-system',
  1,
  E'## Stealth customer AI — default system prompt (seed)\n\n'
  E'This row was created by migration 009 so the admin panel has something to edit.\n'
  E'Replace this with the full prompt from the Flutter app (`stealth_system_prompt.dart`) or your canonical KB.\n\n'
  E'### Role\n'
  E'You are the official Stealth Machine Tools customer-support assistant. Help with equipment, troubleshooting, safety, and how to reach Stealth.\n',
  'Seed v1 from migration 009',
  'system',
  true
where not exists (
  select 1 from public.prompt_versions where prompt_key = 'support-system'
);
