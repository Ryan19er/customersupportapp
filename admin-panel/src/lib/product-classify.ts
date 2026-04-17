// Deterministic product / subsystem / symptom-tag classifier used by
// ingest-correction. Mirrors the logic in
// supabase/functions/_shared/resolve_product.ts and scripts/ingest_knowledge.py.

const PRODUCT_ALIASES: Array<[string, string[]]> = [
  ["ss1510", ["ss1510", "compact fiber"]],
  ["ss3015cpr", ["ss3015cpr", "3015cpr", "cpr"]],
  ["ss3015cp", ["ss3015cp", "ss4015cp", "ss6015cp", "ss4020cp", "ss6020cp", "nighthawk cp"]],
  ["ss3015", ["ss3015", "ss4015", "ss6015", "ss4020", "ss6020", "nighthawk"]],
  ["sl3015cp", ["sl3015cp", "sl4020cp", "sl6020cp", "sl_3015", "sl-3015", "spirit", "maxpar"]],
  ["x3", ["x3 laser", "x3 cutter", "x3cp"]],
  ["ss2060a", ["ss2060a", "ss3060a", "auto loader", "bundle loader"]],
  ["ss2060", ["ss2060", "ss3060"]],
  ["slx1390", ["slx1390", "slx 1390", "co2 laser"]],
  ["marking_laser", ["fiber marking", "mini split", "marking laser"]],
  ["press_brake", ["press brake", "ep-press", "epress", "ibend"]],
  ["rapid_sander", ["rapid sander", "deburring"]],
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
  ["installation", ["install", "commissioning"]],
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

function normalize(s: string): string {
  return s.toLowerCase().replace(/[\s_]+/g, " ").trim();
}

export function classifyProduct(text: string, explicitModel: string | null = null): string | null {
  const haystack = normalize(`${explicitModel ?? ""} ${text ?? ""}`);
  let best: { slug: string; score: number } | null = null;
  for (const [slug, aliases] of PRODUCT_ALIASES) {
    for (const a of aliases) {
      const alias = normalize(a);
      if (alias && haystack.includes(alias)) {
        if (!best || alias.length > best.score) best = { slug, score: alias.length };
      }
    }
  }
  return best?.slug ?? null;
}

export function classifySubsystem(text: string): string | null {
  const h = (text ?? "").toLowerCase();
  for (const [slug, aliases] of SUBSYSTEM_ALIASES) {
    if (aliases.some((a) => h.includes(a))) return slug;
  }
  return null;
}

export function extractSymptomTags(text: string): string[] {
  const h = (text ?? "").toLowerCase();
  const out = new Set<string>();
  for (const [tag, kws] of SYMPTOM_CATALOG) {
    if (kws.some((k) => h.includes(k))) out.add(tag);
  }
  return Array.from(out);
}

export function extractErrorCodes(text: string): string[] {
  const out = new Set<string>();
  const re = new RegExp(ERROR_CODE_RE.source, "gi");
  let m: RegExpExecArray | null;
  while ((m = re.exec(text ?? "")) !== null) {
    out.add(m[0].toUpperCase());
  }
  return Array.from(out).slice(0, 10);
}
