// Deterministic runtime product/subsystem/error-code resolver used by
// `anthropic-chat` + `retrieve` edge functions.
//
// Strategy (in priority order):
//   1) explicit machine_model from saved profile block
//   2) alias match against public.product_catalog (loaded lazily, cached in-memory)
//   3) substring match in recent conversation text
// Fallback returns { product_slug: null, confidence: 0 } so callers can request
// clarification from the customer before guessing.
//
// No network calls beyond the optional product_catalog fetch.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

export type ResolvedContext = {
  product_slug: string | null;
  machine_family: string | null;
  subsystem: string | null;
  error_codes: string[];
  symptom_tags: string[];
  confidence: number; // 0..1
  evidence: string[]; // why we picked the slug
};

type CatalogRow = {
  slug: string;
  display_name: string | null;
  product_name: string | null;
  model_family: string | null;
  aliases: string[] | null;
  subsystems: string[] | null;
};

// Static fallback when catalog fetch fails. Mirrors migration 014 seeds.
const FALLBACK_CATALOG: CatalogRow[] = [
  { slug: "ss1510", display_name: "SS1510", product_name: "SS1510", model_family: "fiber_flat", aliases: ["ss1510","compact fiber"], subsystems: [] },
  { slug: "ss3015cpr", display_name: "SS3015CPR", product_name: "SS3015CPR", model_family: "fiber_flat_nighthawk_cpr", aliases: ["ss3015cpr","cpr","3015cpr","rotary","tube attachment"], subsystems: [] },
  { slug: "ss3015cp", display_name: "SS3015CP", product_name: "SS3015CP", model_family: "fiber_flat_nighthawk_cp", aliases: ["ss3015cp","ss4015cp","ss6015cp","ss4020cp","ss6020cp","nighthawk cp"], subsystems: [] },
  { slug: "ss3015", display_name: "SS3015 Nighthawk", product_name: "SS3015", model_family: "fiber_flat_nighthawk", aliases: ["ss3015","ss4015","ss6015","ss4020","ss6020","nighthawk"], subsystems: [] },
  { slug: "sl3015cp", display_name: "SL3015CP Spirit", product_name: "SL3015CP", model_family: "fiber_flat_spirit", aliases: ["sl3015cp","sl4020cp","sl6020cp","sl_3015","sl-3015","spirit","maxpar"], subsystems: [] },
  { slug: "x3", display_name: "X3", product_name: "X3", model_family: "fiber_flat_x3", aliases: ["x3 laser","x3 cutter","x3cp"], subsystems: [] },
  { slug: "ss2060a", display_name: "SS2060A", product_name: "SS2060A", model_family: "tube_auto", aliases: ["ss2060a","ss3060a","auto loader","bundle loader"], subsystems: [] },
  { slug: "ss2060", display_name: "SS2060", product_name: "SS2060", model_family: "tube_manual", aliases: ["ss2060","ss3060"], subsystems: [] },
  { slug: "slx1390", display_name: "SLX1390", product_name: "SLX1390", model_family: "co2", aliases: ["slx1390","slx 1390","co2 laser"], subsystems: [] },
  { slug: "marking_laser", display_name: "Fiber Marking Laser", product_name: "FiberMarking", model_family: "marking", aliases: ["fiber marking","mini split","marking laser"], subsystems: [] },
  { slug: "press_brake", display_name: "CNC Press Brake", product_name: "eP-Press", model_family: "press_brake", aliases: ["press brake","ep-press","epress","ibend"], subsystems: [] },
  { slug: "rapid_sander", display_name: "Rapid Sander", product_name: "RapidSander", model_family: "finishing", aliases: ["rapid sander","deburring"], subsystems: [] },
];

const SUBSYSTEM_ALIASES: Array<[string, string[]]> = [
  ["assist_gas", ["assist gas", "gas pressure", "oxygen", "nitrogen", "air compressor", "compressor"]],
  ["chiller", ["chiller", "water tank", "coolant"]],
  ["laser_source", ["laser source", "ipg", "max photonics", "raycus"]],
  ["optics", ["optic", "lens", "nozzle", "focus", "collimator", "protective window", "mirror"]],
  ["head", ["cutting head", "blt420", "blt641", "raytools", "autofocus"]],
  ["motion", ["servo", "axis", "gantry", "rail", "linear guide"]],
  ["controller", ["hypcut", "cypcut", "cypnest", "hmi", "ethercat", "power automation"]],
  ["software", ["cypnest", "lantek", "lightburn", "nesting"]],
  ["enclosure", ["enclosure", "door interlock", "filtration", "dust collector"]],
  ["rotary", ["rotary", "chuck", "pneumatic chuck", "tube attachment"]],
  ["hydraulics", ["hydraulic"]],
  ["safety", ["iris", "laser safe", "estop", "e-stop", "emergency stop"]],
  ["installation", ["install", "commissioning", "power up"]],
  ["consumables", ["consumable", "nozzle list"]],
];

const SYMPTOM_CATALOG: Array<[string, string[]]> = [
  ["gas_pressure", ["gas pressure", "assist gas low", "low nitrogen", "low oxygen"]],
  ["piercing", ["pierce fail", "piercing", "can't pierce", "cant pierce"]],
  ["edge_quality", ["burr", "dross", "rough edge", "striations"]],
  ["alarm", ["alarm", "fault", "error code"]],
  ["no_beam", ["no beam", "no laser", "won't fire", "wont fire"]],
  ["chiller_fault", ["chiller fault", "coolant flow", "water flow"]],
  ["head_collision", ["head crash", "collision", "head crashed"]],
  ["software_crash", ["crash", "freeze", "hmi frozen"]],
  ["install", ["install", "commissioning"]],
  ["wiring", ["wiring", "connector", "plug", "solder"]],
];

const ERROR_CODE_RE = /\b(?:ERR|ALM|F|E|FAULT|ALARM)[ -]?([A-Z0-9]{2,5})\b/gi;

// Simple in-memory cache for catalog per cold-start.
let _catalogCache: CatalogRow[] | null = null;
let _catalogExpiresAt = 0;

export async function loadProductCatalog(db: SupabaseClient | null): Promise<CatalogRow[]> {
  const now = Date.now();
  if (_catalogCache && now < _catalogExpiresAt) return _catalogCache;
  if (!db) {
    _catalogCache = FALLBACK_CATALOG;
    _catalogExpiresAt = now + 5 * 60_000;
    return FALLBACK_CATALOG;
  }
  try {
    const { data } = await db
      .from("product_catalog")
      .select("slug,display_name,product_name,model_family,aliases,subsystems")
      .not("slug", "is", null)
      .eq("status", "active")
      .limit(200);
    const rows = (data as any as CatalogRow[] | null) ?? [];
    _catalogCache = rows.length ? rows : FALLBACK_CATALOG;
    _catalogExpiresAt = now + 5 * 60_000;
    return _catalogCache;
  } catch {
    _catalogCache = FALLBACK_CATALOG;
    _catalogExpiresAt = now + 5 * 60_000;
    return FALLBACK_CATALOG;
  }
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/[\s_]+/g, " ").trim();
}

function pickProduct(
  catalog: CatalogRow[],
  explicitModel: string | null,
  haystack: string,
): { row: CatalogRow | null; hit: string | null } {
  const h = normalize(haystack);
  if (explicitModel) {
    const em = normalize(explicitModel);
    for (const row of catalog) {
      const names = [row.slug, row.display_name, row.product_name]
        .filter(Boolean)
        .map((x) => normalize(String(x)));
      const aliases = (row.aliases ?? []).map(normalize);
      if (names.some((n) => n && (em === n || em.includes(n) || n.includes(em)))) {
        return { row, hit: `profile model ${explicitModel}` };
      }
      if (aliases.some((a) => a && em.includes(a))) {
        return { row, hit: `profile alias ${explicitModel}` };
      }
    }
  }

  let best: { row: CatalogRow; score: number; hit: string } | null = null;
  for (const row of catalog) {
    const aliases = [row.slug, ...(row.aliases ?? [])]
      .filter(Boolean)
      .map((x) => normalize(String(x)))
      .filter((x) => x.length >= 3);
    for (const a of aliases) {
      if (h.includes(a)) {
        // Prefer longer alias matches.
        if (!best || a.length > best.score) {
          best = { row, score: a.length, hit: `text alias "${a}"` };
        }
      }
    }
  }
  return best ? { row: best.row, hit: best.hit } : { row: null, hit: null };
}

function pickSubsystem(haystack: string): string | null {
  const h = haystack.toLowerCase();
  for (const [slug, aliases] of SUBSYSTEM_ALIASES) {
    for (const a of aliases) {
      if (h.includes(a)) return slug;
    }
  }
  return null;
}

function extractErrorCodes(haystack: string): string[] {
  const out = new Set<string>();
  let m: RegExpExecArray | null;
  ERROR_CODE_RE.lastIndex = 0;
  while ((m = ERROR_CODE_RE.exec(haystack)) !== null) {
    out.add(m[0].toUpperCase());
  }
  return Array.from(out).slice(0, 10);
}

function extractSymptomTags(haystack: string): string[] {
  const h = haystack.toLowerCase();
  const out = new Set<string>();
  for (const [tag, kws] of SYMPTOM_CATALOG) {
    if (kws.some((k) => h.includes(k))) out.add(tag);
  }
  return Array.from(out);
}

export function extractExplicitModelFromProfileBlock(block: string): string | null {
  const m = /Machine model:\s*(.+)/i.exec(block);
  if (!m) return null;
  const v = m[1]?.trim();
  if (!v || v === "—" || v.toLowerCase() === "none") return null;
  return v;
}

export async function resolveProduct(params: {
  db: SupabaseClient | null;
  profileBlock?: string | null;
  recentConversation?: string | null;
  currentUserMessage?: string | null;
}): Promise<ResolvedContext> {
  const catalog = await loadProductCatalog(params.db);

  const profileModel = params.profileBlock
    ? extractExplicitModelFromProfileBlock(params.profileBlock)
    : null;

  const currentMsg = params.currentUserMessage ?? "";
  const recent = params.recentConversation ?? "";
  const combined = [profileModel ?? "", currentMsg, recent, params.profileBlock ?? ""].join("\n");

  const { row, hit } = pickProduct(catalog, profileModel, combined);
  const subsystem = pickSubsystem(combined);
  const error_codes = extractErrorCodes(combined);
  const symptom_tags = extractSymptomTags(combined);

  const evidence: string[] = [];
  if (profileModel) evidence.push(`profile.machine_model=${profileModel}`);
  if (hit) evidence.push(`match:${hit}`);
  if (subsystem) evidence.push(`subsystem=${subsystem}`);
  if (error_codes.length) evidence.push(`error_codes=${error_codes.join(",")}`);
  if (symptom_tags.length) evidence.push(`symptoms=${symptom_tags.join(",")}`);

  let confidence = 0;
  if (row && profileModel) confidence = 0.95;
  else if (row) confidence = 0.75;
  else if (symptom_tags.length || error_codes.length) confidence = 0.25;

  return {
    product_slug: row?.slug ?? null,
    machine_family: row?.model_family ?? null,
    subsystem,
    error_codes,
    symptom_tags,
    confidence,
    evidence,
  };
}
