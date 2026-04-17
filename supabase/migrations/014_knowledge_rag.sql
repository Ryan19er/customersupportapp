-- Real RAG + learning engine V3: pgvector-backed per-product knowledge, evidence audit,
-- auto-grading, and gated correction review queue.

create extension if not exists vector;

-- ---------------------------------------------------------------------------
-- Product catalog: extend existing table with a stable slug + subsystem list.
-- Existing columns (from 006): id, product_name, model_family, aliases, specs_json, status.
-- ---------------------------------------------------------------------------
alter table public.product_catalog add column if not exists slug text;
alter table public.product_catalog add column if not exists display_name text;
alter table public.product_catalog add column if not exists subsystems text[] not null default '{}'::text[];

create unique index if not exists product_catalog_slug_key
  on public.product_catalog (slug)
  where slug is not null;

insert into public.product_catalog (slug, display_name, product_name, model_family, aliases, subsystems)
values
  ('ss1510','SS1510 Compact Fiber Laser','SS1510','fiber_flat',
    array['ss1510','compact fiber','hypcut']::text[],
    array['motion','laser_source','assist_gas','chiller','controller','software','optics']::text[]),
  ('ss3015','SS3015 Nighthawk Open Fiber Laser','SS3015','fiber_flat_nighthawk',
    array['ss3015','ss4015','ss6015','ss4020','ss6020','nighthawk','blt420','blt641','hypcut']::text[],
    array['motion','laser_source','assist_gas','chiller','controller','optics','head']::text[]),
  ('ss3015cp','SS3015CP Nighthawk Enclosed Fiber Laser','SS3015CP','fiber_flat_nighthawk_cp',
    array['ss3015cp','ss4015cp','ss6015cp','ss4020cp','ss6020cp','nighthawk cp','enclosed','filtration']::text[],
    array['motion','laser_source','assist_gas','chiller','controller','optics','head','enclosure','filtration']::text[]),
  ('ss3015cpr','SS3015CPR Nighthawk Enclosed + Rotary','SS3015CPR','fiber_flat_nighthawk_cpr',
    array['ss3015cpr','cpr','rotary','tube attachment','pneumatic chuck']::text[],
    array['motion','laser_source','assist_gas','chiller','controller','optics','head','enclosure','rotary']::text[]),
  ('sl3015cp','SL3015CP Spirit Premium Fiber Laser','SL3015CP','fiber_flat_spirit',
    array['sl3015cp','sl4020cp','sl6020cp','spirit','max photonics','maxpar']::text[],
    array['motion','laser_source','assist_gas','chiller','controller','optics','head','enclosure']::text[]),
  ('x3','X3 High Power Enclosed Fiber Laser','X3','fiber_flat_x3',
    array['x3','30kw','max + ipg','highpower']::text[],
    array['motion','laser_source','assist_gas','chiller','controller','optics','head','enclosure','filtration']::text[]),
  ('ss2060','SS2060 Tube Fiber Laser (manual)','SS2060','tube_manual',
    array['ss2060','ss3060','raytools','lantek','power automation','higerman']::text[],
    array['motion','laser_source','assist_gas','chiller','controller','head','chuck','loading']::text[]),
  ('ss2060a','SS2060A Tube Fiber Laser (auto loader)','SS2060A','tube_auto',
    array['ss2060a','ss3060a','auto loader','bundle loader']::text[],
    array['motion','laser_source','assist_gas','chiller','controller','head','chuck','loading','automation']::text[]),
  ('slx1390','SLX1390 CO2 Non-metal Laser','SLX1390','co2',
    array['slx1390','co2','lightburn','80w','100w','130w','150w']::text[],
    array['motion','laser_source','optics','software','cooling_water','platform']::text[]),
  ('marking_laser','Fiber Marking Laser (Mini split)','FiberMarking','marking',
    array['marking','mini split','1064','lightburn','20w','30w','50w','60w']::text[],
    array['optics','software','rotary','cooling_air']::text[]),
  ('press_brake','eP-Press CNC Press Brake','eP-Press','press_brake',
    array['press brake','ep-press','ibend','iris','laser safe']::text[],
    array['hydraulics','controller','safety','tooling']::text[]),
  ('rapid_sander','Rapid Sander Automated Finishing','RapidSander','finishing',
    array['rapid sander','deburring','dust collector','finishing']::text[],
    array['abrasives','dust_collector','controller']::text[])
on conflict (slug) where slug is not null do update
  set display_name = excluded.display_name,
      aliases = excluded.aliases,
      subsystems = excluded.subsystems,
      model_family = excluded.model_family,
      updated_at = now();

-- ---------------------------------------------------------------------------
-- Knowledge documents: extend for product tagging + idempotent ingestion.
-- ---------------------------------------------------------------------------
alter table public.knowledge_documents add column if not exists product_slug text;
alter table public.knowledge_documents add column if not exists machine_family text;
alter table public.knowledge_documents add column if not exists subsystem text;
alter table public.knowledge_documents add column if not exists doc_type text not null default 'manual';
alter table public.knowledge_documents add column if not exists version text;
alter table public.knowledge_documents add column if not exists checksum text;
alter table public.knowledge_documents add column if not exists ingested_at timestamptz;
alter table public.knowledge_documents add column if not exists chunk_count integer not null default 0;
alter table public.knowledge_documents add column if not exists byte_size bigint;

create unique index if not exists knowledge_documents_checksum_key
  on public.knowledge_documents (checksum)
  where checksum is not null;

create index if not exists knowledge_documents_product_idx
  on public.knowledge_documents (product_slug, subsystem);

-- ---------------------------------------------------------------------------
-- Knowledge chunks: the unit retrieval actually operates on.
-- ---------------------------------------------------------------------------
create table if not exists public.knowledge_chunks (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.knowledge_documents (id) on delete cascade,
  ord integer not null,
  heading text,
  text text not null,
  token_count integer not null default 0,
  product_slug text,
  machine_family text,
  subsystem text,
  symptom_tags text[] not null default '{}'::text[],
  error_codes text[] not null default '{}'::text[],
  embedding vector(384),
  tsv tsvector generated always as (to_tsvector('english', coalesce(heading,'') || ' ' || text)) stored,
  source_type text not null default 'manual',
  source_ref text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists knowledge_chunks_doc_ord_idx
  on public.knowledge_chunks (document_id, ord);

create index if not exists knowledge_chunks_product_idx
  on public.knowledge_chunks (product_slug, subsystem);

create index if not exists knowledge_chunks_tags_idx
  on public.knowledge_chunks using gin (symptom_tags);

create index if not exists knowledge_chunks_error_codes_idx
  on public.knowledge_chunks using gin (error_codes);

create index if not exists knowledge_chunks_tsv_idx
  on public.knowledge_chunks using gin (tsv);

create index if not exists knowledge_chunks_embedding_idx
  on public.knowledge_chunks using ivfflat (embedding vector_cosine_ops)
  with (lists = 100);

-- ---------------------------------------------------------------------------
-- Canonical knowledge + snippets: embeddings so retrieval can rank them too.
-- ---------------------------------------------------------------------------
alter table public.canonical_knowledge add column if not exists product_slug text;
alter table public.canonical_knowledge add column if not exists subsystem text;
alter table public.canonical_knowledge add column if not exists symptom_tags text[] not null default '{}'::text[];
alter table public.canonical_knowledge add column if not exists error_codes text[] not null default '{}'::text[];
alter table public.canonical_knowledge add column if not exists embedding vector(384);

create index if not exists canonical_knowledge_product_idx
  on public.canonical_knowledge (product_slug, subsystem);
create index if not exists canonical_knowledge_tags_idx2
  on public.canonical_knowledge using gin (symptom_tags);
create index if not exists canonical_knowledge_error_codes_idx
  on public.canonical_knowledge using gin (error_codes);
create index if not exists canonical_knowledge_embedding_idx
  on public.canonical_knowledge using ivfflat (embedding vector_cosine_ops)
  with (lists = 50);

alter table public.learning_snippets add column if not exists product_slug text;
alter table public.learning_snippets add column if not exists subsystem text;
alter table public.learning_snippets add column if not exists symptom_tags text[] not null default '{}'::text[];
alter table public.learning_snippets add column if not exists error_codes text[] not null default '{}'::text[];
alter table public.learning_snippets add column if not exists embedding vector(384);

create index if not exists learning_snippets_product_idx
  on public.learning_snippets (product_slug, subsystem);
create index if not exists learning_snippets_tags_idx
  on public.learning_snippets using gin (symptom_tags);
create index if not exists learning_snippets_embedding_idx
  on public.learning_snippets using ivfflat (embedding vector_cosine_ops)
  with (lists = 50);

-- ---------------------------------------------------------------------------
-- Approval gate: canonical facts now require queue approval before going live.
-- Existing rows stay active; new rows default to 'draft'.
-- ---------------------------------------------------------------------------
alter table public.canonical_knowledge drop constraint if exists canonical_knowledge_status_check;
alter table public.canonical_knowledge
  add constraint canonical_knowledge_status_check
  check (status in ('draft','active','deprecated','rejected'));

-- ---------------------------------------------------------------------------
-- Answer audit: one row per assistant reply, evidence chosen at runtime.
-- ---------------------------------------------------------------------------
create table if not exists public.answer_audit (
  id uuid primary key default gen_random_uuid(),
  session_channel text not null check (session_channel in ('support','auth','training')),
  session_id uuid,
  message_id uuid,
  product_slug text,
  user_query text,
  assistant_text text,
  resolver_meta jsonb not null default '{}'::jsonb,
  evidence jsonb not null default '[]'::jsonb,
  prompt_version_id uuid references public.prompt_versions (id) on delete set null,
  model text,
  latency_ms integer,
  created_at timestamptz not null default now()
);

create index if not exists answer_audit_session_idx
  on public.answer_audit (session_channel, session_id, created_at desc);
create index if not exists answer_audit_product_idx
  on public.answer_audit (product_slug, created_at desc);

-- ---------------------------------------------------------------------------
-- Auto-grader output.
-- ---------------------------------------------------------------------------
create table if not exists public.answer_grades (
  id uuid primary key default gen_random_uuid(),
  audit_id uuid not null references public.answer_audit (id) on delete cascade,
  scores jsonb not null default '{}'::jsonb,
  overall numeric(3,2),
  rationale text,
  grader_model text,
  auto_flagged boolean not null default false,
  flag_reason text,
  created_at timestamptz not null default now()
);

create index if not exists answer_grades_audit_idx
  on public.answer_grades (audit_id);
create index if not exists answer_grades_flag_idx
  on public.answer_grades (auto_flagged, created_at desc);

-- ---------------------------------------------------------------------------
-- Correction review queue: every new canonical update routes here for approval.
-- ---------------------------------------------------------------------------
create table if not exists public.correction_review_queue (
  id uuid primary key default gen_random_uuid(),
  correction_id uuid references public.corrections (id) on delete set null,
  canonical_knowledge_id uuid references public.canonical_knowledge (id) on delete set null,
  audit_id uuid references public.answer_audit (id) on delete set null,
  source text not null check (source in ('admin_manual','admin_synthesized','admin_training','auto_flag','conflict')),
  priority text not null default 'normal' check (priority in ('low','normal','high','urgent')),
  reason text not null,
  proposed_title text,
  proposed_law_text text,
  proposed_machine_model text,
  proposed_product_slug text,
  status text not null default 'pending' check (status in ('pending','approved','rejected','edited')),
  reviewed_by text,
  reviewed_at timestamptz,
  review_notes text,
  created_by text not null default 'system',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists correction_review_queue_status_idx
  on public.correction_review_queue (status, priority, created_at desc);
create index if not exists correction_review_queue_source_idx
  on public.correction_review_queue (source, created_at desc);

-- ---------------------------------------------------------------------------
-- Query embedding cache (per session, short TTL via cleanup).
-- ---------------------------------------------------------------------------
create table if not exists public.query_embedding_cache (
  id uuid primary key default gen_random_uuid(),
  session_id uuid,
  query_hash text not null,
  embedding vector(384) not null,
  created_at timestamptz not null default now()
);

create index if not exists query_embedding_cache_hash_idx
  on public.query_embedding_cache (query_hash, created_at desc);
create index if not exists query_embedding_cache_session_idx
  on public.query_embedding_cache (session_id, created_at desc);

-- ---------------------------------------------------------------------------
-- RLS: treat new tables the same way as 013 tables — enabled, no public select.
-- ---------------------------------------------------------------------------
alter table public.knowledge_chunks enable row level security;
alter table public.answer_audit enable row level security;
alter table public.answer_grades enable row level security;
alter table public.correction_review_queue enable row level security;
alter table public.query_embedding_cache enable row level security;

-- Runtime (anon) must read knowledge_chunks so retrieval works from edge functions;
-- service role bypasses RLS, so edge functions are fine either way. We expose
-- a read-only policy for anon/authenticated so future on-device retrieval works.
drop policy if exists "knowledge_chunks_select_public" on public.knowledge_chunks;
create policy "knowledge_chunks_select_public"
  on public.knowledge_chunks for select
  to anon, authenticated
  using (true);

-- ---------------------------------------------------------------------------
-- Hybrid retrieval RPC: cosine + lexical + tag boosts, filtered by product.
-- ---------------------------------------------------------------------------
create or replace function public.retrieve_knowledge(
  p_query_embedding vector(384),
  p_query_text text,
  p_product_slug text default null,
  p_symptom_tags text[] default '{}'::text[],
  p_error_codes text[] default '{}'::text[],
  p_limit integer default 8
)
returns table (
  source_type text,
  source_id uuid,
  document_id uuid,
  text text,
  heading text,
  product_slug text,
  subsystem text,
  symptom_tags text[],
  error_codes text[],
  vector_score double precision,
  lexical_score double precision,
  tag_score double precision,
  total_score double precision
)
language plpgsql
stable
as $$
declare
  v_q tsquery;
begin
  begin
    v_q := websearch_to_tsquery('english', coalesce(p_query_text,''));
  exception when others then
    v_q := plainto_tsquery('english', coalesce(p_query_text,''));
  end;

  return query
  with chunk_hits as (
    select
      'chunk'::text as source_type,
      c.id as source_id,
      c.document_id,
      c.text,
      c.heading,
      c.product_slug,
      c.subsystem,
      c.symptom_tags,
      c.error_codes,
      case when c.embedding is null then 0.0
           else 1 - (c.embedding <=> p_query_embedding) end as vector_score,
      case when v_q is null then 0.0
           else coalesce(ts_rank(c.tsv, v_q), 0.0) end as lexical_score,
      (coalesce(cardinality(array(select unnest(c.symptom_tags) intersect select unnest(coalesce(p_symptom_tags,'{}')))), 0) * 0.10
        + coalesce(cardinality(array(select unnest(c.error_codes) intersect select unnest(coalesce(p_error_codes,'{}')))), 0) * 0.20)::double precision as tag_score
    from public.knowledge_chunks c
    where p_product_slug is null
       or c.product_slug is null
       or c.product_slug = p_product_slug
    order by c.embedding <=> p_query_embedding nulls last
    limit greatest(p_limit * 4, 32)
  ),
  canon_hits as (
    select
      'canonical'::text as source_type,
      k.id as source_id,
      null::uuid as document_id,
      k.law_text as text,
      k.title as heading,
      k.product_slug,
      k.subsystem,
      k.symptom_tags,
      k.error_codes,
      case when k.embedding is null then 0.0
           else 1 - (k.embedding <=> p_query_embedding) end as vector_score,
      0.0::double precision as lexical_score,
      (0.25
        + coalesce(cardinality(array(select unnest(k.symptom_tags) intersect select unnest(coalesce(p_symptom_tags,'{}')))), 0) * 0.10
        + coalesce(cardinality(array(select unnest(k.error_codes) intersect select unnest(coalesce(p_error_codes,'{}')))), 0) * 0.20)::double precision as tag_score
    from public.canonical_knowledge k
    where k.status = 'active'
      and (p_product_slug is null or k.product_slug is null or k.product_slug = p_product_slug)
    order by k.embedding <=> p_query_embedding nulls last
    limit greatest(p_limit, 10)
  ),
  snippet_hits as (
    select
      'snippet'::text as source_type,
      s.id as source_id,
      null::uuid as document_id,
      s.snippet_text as text,
      null::text as heading,
      s.product_slug,
      s.subsystem,
      s.symptom_tags,
      s.error_codes,
      case when s.embedding is null then 0.0
           else 1 - (s.embedding <=> p_query_embedding) end as vector_score,
      0.0::double precision as lexical_score,
      (0.15
        + coalesce(cardinality(array(select unnest(s.symptom_tags) intersect select unnest(coalesce(p_symptom_tags,'{}')))), 0) * 0.10
        + coalesce(cardinality(array(select unnest(s.error_codes) intersect select unnest(coalesce(p_error_codes,'{}')))), 0) * 0.20)::double precision as tag_score
    from public.learning_snippets s
    where s.status = 'active'
      and (p_product_slug is null or s.product_slug is null or s.product_slug = p_product_slug)
    order by s.embedding <=> p_query_embedding nulls last
    limit greatest(p_limit, 10)
  ),
  unioned as (
    select * from chunk_hits
    union all
    select * from canon_hits
    union all
    select * from snippet_hits
  )
  select
    source_type,
    source_id,
    document_id,
    text,
    heading,
    product_slug,
    subsystem,
    symptom_tags,
    error_codes,
    vector_score,
    lexical_score,
    tag_score,
    (coalesce(vector_score,0) * 0.70
     + coalesce(lexical_score,0) * 0.20
     + coalesce(tag_score,0) * 0.10) as total_score
  from unioned
  order by total_score desc
  limit p_limit;
end;
$$;

grant execute on function public.retrieve_knowledge(vector(384), text, text, text[], text[], integer)
  to anon, authenticated, service_role;
