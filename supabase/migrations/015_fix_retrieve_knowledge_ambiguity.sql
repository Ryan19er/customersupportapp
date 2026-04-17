-- Fix: PostgreSQL was reporting "column reference 'source_type' is ambiguous"
-- because the RETURNS TABLE column names collide with the CTE column names of
-- the same name in the final SELECT. Qualifying every output with the CTE
-- alias resolves it.

drop function if exists public.retrieve_knowledge(vector(384), text, text, text[], text[], integer);

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
      'chunk'::text as src_type,
      c.id as src_id,
      c.document_id as doc_id,
      c.text as src_text,
      c.heading as src_heading,
      c.product_slug as src_product,
      c.subsystem as src_subsystem,
      c.symptom_tags as src_tags,
      c.error_codes as src_codes,
      case when c.embedding is null then 0.0
           else 1 - (c.embedding <=> p_query_embedding) end as v_score,
      case when v_q is null then 0.0
           else coalesce(ts_rank(c.tsv, v_q), 0.0) end as l_score,
      (coalesce(cardinality(array(select unnest(c.symptom_tags) intersect select unnest(coalesce(p_symptom_tags,'{}')))), 0) * 0.10
        + coalesce(cardinality(array(select unnest(c.error_codes) intersect select unnest(coalesce(p_error_codes,'{}')))), 0) * 0.20)::double precision as t_score
    from public.knowledge_chunks c
    where p_product_slug is null
       or c.product_slug is null
       or c.product_slug = p_product_slug
    order by c.embedding <=> p_query_embedding nulls last
    limit greatest(p_limit * 4, 32)
  ),
  canon_hits as (
    select
      'canonical'::text as src_type,
      k.id as src_id,
      null::uuid as doc_id,
      k.law_text as src_text,
      k.title as src_heading,
      k.product_slug as src_product,
      k.subsystem as src_subsystem,
      k.symptom_tags as src_tags,
      k.error_codes as src_codes,
      case when k.embedding is null then 0.0
           else 1 - (k.embedding <=> p_query_embedding) end as v_score,
      0.0::double precision as l_score,
      (0.25
        + coalesce(cardinality(array(select unnest(k.symptom_tags) intersect select unnest(coalesce(p_symptom_tags,'{}')))), 0) * 0.10
        + coalesce(cardinality(array(select unnest(k.error_codes) intersect select unnest(coalesce(p_error_codes,'{}')))), 0) * 0.20)::double precision as t_score
    from public.canonical_knowledge k
    where k.status = 'active'
      and (p_product_slug is null or k.product_slug is null or k.product_slug = p_product_slug)
    order by k.embedding <=> p_query_embedding nulls last
    limit greatest(p_limit, 10)
  ),
  snippet_hits as (
    select
      'snippet'::text as src_type,
      s.id as src_id,
      null::uuid as doc_id,
      s.snippet_text as src_text,
      null::text as src_heading,
      s.product_slug as src_product,
      s.subsystem as src_subsystem,
      s.symptom_tags as src_tags,
      s.error_codes as src_codes,
      case when s.embedding is null then 0.0
           else 1 - (s.embedding <=> p_query_embedding) end as v_score,
      0.0::double precision as l_score,
      (0.15
        + coalesce(cardinality(array(select unnest(s.symptom_tags) intersect select unnest(coalesce(p_symptom_tags,'{}')))), 0) * 0.10
        + coalesce(cardinality(array(select unnest(s.error_codes) intersect select unnest(coalesce(p_error_codes,'{}')))), 0) * 0.20)::double precision as t_score
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
    u.src_type        as source_type,
    u.src_id          as source_id,
    u.doc_id          as document_id,
    u.src_text        as text,
    u.src_heading     as heading,
    u.src_product     as product_slug,
    u.src_subsystem   as subsystem,
    u.src_tags        as symptom_tags,
    u.src_codes       as error_codes,
    u.v_score         as vector_score,
    u.l_score         as lexical_score,
    u.t_score         as tag_score,
    (coalesce(u.v_score,0) * 0.70
     + coalesce(u.l_score,0) * 0.20
     + coalesce(u.t_score,0) * 0.10) as total_score
  from unioned u
  order by total_score desc
  limit p_limit;
end;
$$;

grant execute on function public.retrieve_knowledge(vector(384), text, text, text[], text[], integer)
  to anon, authenticated, service_role;
