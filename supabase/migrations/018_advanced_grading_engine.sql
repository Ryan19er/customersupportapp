-- Advanced grading engine schema: deterministic checks, severity/reason codes,
-- queue intelligence metadata, and analytics dimensions.

alter table public.answer_grades
  add column if not exists reason_code text,
  add column if not exists severity text not null default 'low',
  add column if not exists deterministic_checks jsonb not null default '{}'::jsonb,
  add column if not exists contradiction_score numeric(4,3),
  add column if not exists grounding_score numeric(4,3),
  add column if not exists uncertainty numeric(4,3),
  add column if not exists queue_decision text,
  add column if not exists topic_fingerprint text;

alter table public.answer_grades
  drop constraint if exists answer_grades_severity_check;
alter table public.answer_grades
  add constraint answer_grades_severity_check
  check (severity in ('low','medium','high','critical'));

create index if not exists answer_grades_reason_code_idx
  on public.answer_grades (reason_code, created_at desc);

create index if not exists answer_grades_severity_idx
  on public.answer_grades (severity, created_at desc);

create index if not exists answer_grades_topic_fingerprint_idx
  on public.answer_grades (topic_fingerprint, created_at desc);

alter table public.correction_review_queue
  add column if not exists triage_bucket text,
  add column if not exists cluster_key text;

create index if not exists correction_review_queue_cluster_idx
  on public.correction_review_queue (cluster_key, status, created_at desc);

