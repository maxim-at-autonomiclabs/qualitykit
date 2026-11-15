import type { SiteModel } from "../model/site.js";

export interface ProductPhrase {
  phrase: string;
  slug: string;
  evidence: string;
}

export interface ProductSignals {
  brand: string;
  audience: string;
  audienceSlug: string;
  category:
    | "developer-tool"
    | "saas"
    | "agency"
    | "ecommerce"
    | "content"
    | "unknown";
  phrases: ProductPhrase[];
  allowsCalculator: boolean;
  corpusEvidence: string[];
}

/** Known multi-word search intents matched against homepage / metadata corpus. Lower rank = better. */
const KNOWN_PHRASES: Array<{ re: RegExp; phrase: string; rank: number }> = [
  { re: /\bseo\s+mcp\b/i, phrase: "seo mcp", rank: 0 },
  { re: /\bseo\s*\+?\s*aeo\b/i, phrase: "seo aeo", rank: 1 },
  { re: /\baeo\s+mcp\b/i, phrase: "aeo mcp", rank: 2 },
  { re: /\bnext\.?js\s+seo\b/i, phrase: "next.js seo", rank: 3 },
  { re: /\bseo\s+audit\b/i, phrase: "seo audit", rank: 4 },
  { re: /\bai\s+visibility\b/i, phrase: "ai visibility", rank: 5 },
  { re: /\bai\s+discoverability\b/i, phrase: "ai discoverability", rank: 6 },
  { re: /\btechnical\s+seo\b/i, phrase: "technical seo", rank: 7 },
  { re: /\bmcp\s+server\b/i, phrase: "mcp server", rank: 8 },
  { re: /\binternal\s+linking\b/i, phrase: "internal linking", rank: 9 },
  { re: /\bstructured\s+data\b/i, phrase: "structured data", rank: 10 },
  { re: /\bjson-?ld\b/i, phrase: "json-ld", rank: 11 },
  { re: /\bsearch\s+console\b/i, phrase: "search console", rank: 12 },
  { re: /\bproduct\s+analytics\b/i, phrase: "product analytics", rank: 13 },
  { re: /\bmarketing\s+analytics\b/i, phrase: "marketing analytics", rank: 14 },
  { re: /\bautomated\s+reporting\b/i, phrase: "automated reporting", rank: 15 },
  { re: /\broi\s+calculator\b/i, phrase: "roi calculator", rank: 16 },
  { re: /\bcontent\s+brief\b/i, phrase: "content brief", rank: 17 },
  { re: /\bcoding\s+agent\b/i, phrase: "coding agent", rank: 18 },
  // Brand-ish, not a strong search intent on its own
  { re: /\bopen[\s-]?source\s+mcp\b/i, phrase: "open source mcp", rank: 40 },
];

const PHRASE_RANK = new Map(KNOWN_PHRASES.map((k) => [k.phrase, k.rank]));

const CHROME_TITLE_RE =
  /^(home|docs?|pricing|blog|about|contact|login|signup|privacy|terms|404)\b/i;

const STOP_PHRASE_PARTS = new Set([
  "the",
  "and",
  "for",
  "with",
  "your",
  "our",
  "this",
  "that",
  "from",
  "into",
  "codebases",
  "website",
  "page",
]);

export function extractProductSignals(site: SiteModel): ProductSignals {
  const home = homepageRoute(site);
  const brand = inferBrand(site, home);
  const corpusParts = [
    site.metadata.rootTitle,
    site.metadata.rootDescription,
    home?.title,
    home?.description,
    ...(home?.headings ?? []),
    site.business.description,
    site.business.name,
    site.packageName,
    ...site.business.topics,
  ].filter(Boolean) as string[];

  const corpus = corpusParts.join("\n");
  const corpusLower = corpus.toLowerCase();
  const corpusEvidence = corpusParts.slice(0, 6);

  const phrases: ProductPhrase[] = [];
  const seen = new Set<string>();

  const pushPhrase = (phrase: string, evidence: string) => {
    const cleaned = cleanPhrase(phrase, brand);
    if (!cleaned) return;
    const key = cleaned.toLowerCase();
    if (seen.has(key)) return;
    if (CHROME_TITLE_RE.test(cleaned)) return;
    seen.add(key);
    phrases.push({
      phrase: cleaned,
      slug: slugifyPhrase(cleaned),
      evidence,
    });
  };

  for (const { re, phrase } of KNOWN_PHRASES) {
    if (re.test(corpus)) pushPhrase(phrase, `matched:${phrase}`);
  }

  // Also synthesize from "SEO + AEO MCP" style titles even when spaced oddly
  if (/\bseo\b/i.test(corpus) && /\bmcp\b/i.test(corpus)) {
    pushPhrase("seo mcp", "synthesized:seo+mcp");
  }
  if (/\bseo\b/i.test(corpus) && /\baeo\b/i.test(corpus)) {
    pushPhrase("seo aeo", "synthesized:seo+aeo");
  }
  if (/\bnext\.?js\b/i.test(corpus) && /\bseo\b/i.test(corpus)) {
    pushPhrase("next.js seo", "synthesized:nextjs+seo");
  }

  for (const raw of [
    descriptiveTitlePart(site.metadata.rootTitle ?? home?.title, brand),
    site.metadata.rootDescription ?? home?.description,
    home?.headings?.[0],
  ]) {
    if (!raw) continue;
    for (const chunk of splitIntoCandidatePhrases(raw, brand)) {
      pushPhrase(chunk, `source:${raw.slice(0, 60)}`);
    }
  }

  // Prefer ranked known intents, then other phrases by specificity
  phrases.sort((a, b) => {
    const aRank = PHRASE_RANK.get(a.phrase) ?? 100;
    const bRank = PHRASE_RANK.get(b.phrase) ?? 100;
    if (aRank !== bRank) return aRank - bRank;
    return b.phrase.length - a.phrase.length;
  });

  const category = inferCategory(corpusLower, site);
  const audience = inferAudience(corpusLower, site, category);

  return {
    brand,
    audience,
    audienceSlug: audienceSlug(audience, category),
    category,
    phrases: phrases.slice(0, 8),
    allowsCalculator:
      /\b(roi|calculator|analytics|reporting|dashboard|metrics)\b/i.test(
        corpusLower,
      ) && !/\bmcp\b/i.test(corpusLower),
    corpusEvidence,
  };
}

/** Terms already covered by existing routes (path, title, headings, description). */
export function coveredSearchTerms(site: SiteModel): Set<string> {
  const out = new Set<string>();
  for (const route of site.routes) {
    const hay = [
      route.path,
      route.title,
      route.description,
      ...(route.headings ?? []),
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    for (const token of hay.split(/[^a-z0-9.+]+/)) {
      if (token.length >= 3) out.add(token);
    }
    // Multi-word path segments: /docs/ai-audit → "ai audit"
    const segs = route.path
      .toLowerCase()
      .split("/")
      .filter(Boolean)
      .map((s) => s.replace(/-/g, " "));
    for (const seg of segs) {
      if (seg.length >= 4) out.add(seg);
    }
  }
  return out;
}

export function phraseAlreadyCovered(
  phrase: string,
  covered: Set<string>,
): boolean {
  const lower = phrase.toLowerCase().replace(/\s+/g, " ").trim();
  if (covered.has(lower)) return true;
  const hyphen = lower.replace(/\s+/g, "-");
  if (covered.has(hyphen)) return true;
  const parts = lower.split(/\s+/).filter((p) => p.length >= 3);
  if (parts.length < 2) return covered.has(parts[0] ?? "");
  // Require an existing path/title segment that carries the same multi-word intent
  const spaced = parts.join(" ");
  const dashed = parts.join("-");
  if (covered.has(spaced) || covered.has(dashed)) return true;
  // Partial: first two words already a route segment (e.g. docs/ai-audit vs "ai audit mode")
  if (parts.length >= 2) {
    const head = `${parts[0]} ${parts[1]}`;
    if (covered.has(head) || covered.has(`${parts[0]}-${parts[1]}`)) return true;
  }
  return false;
}

function homepageRoute(site: SiteModel) {
  return (
    site.routes.find((r) => r.path === "/" || r.path === "") ??
    site.routes.find((r) => r.file === "index.html" || r.file.endsWith("/index.html") && r.file.split("/").length <= 2)
  );
}

function inferBrand(
  site: SiteModel,
  home?: { title?: string; headings: string[] },
): string {
  const fromBusiness = site.business.name?.trim();
  if (
    fromBusiness &&
    !/website|untitled/i.test(fromBusiness) &&
    fromBusiness !== site.packageName
  ) {
    // Prefer short brand if title is "Brand — tagline"
    const part = fromBusiness.split(/\s+[—–|-]\s+/)[0]?.trim();
    if (part && part.length <= 40) return part;
  }

  const title = site.metadata.rootTitle ?? home?.title;
  if (title) {
    const brandPart = title.split(/\s+[—–|-]\s+/)[0]?.trim();
    if (brandPart && !CHROME_TITLE_RE.test(brandPart) && brandPart.length <= 40) {
      return brandPart;
    }
  }

  const h1 = home?.headings?.[0];
  if (h1 && h1.length <= 40 && !/audit seo/i.test(h1)) return h1;

  const pkg = site.packageName?.replace(/-website$/i, "").replace(/-/g, " ");
  if (pkg) return capitalizeWords(pkg);

  return "the product";
}

function descriptiveTitlePart(
  title: string | undefined,
  brand: string,
): string | undefined {
  if (!title) return undefined;
  const parts = title.split(/\s+[—–|-]\s+/);
  if (parts.length >= 2) return parts.slice(1).join(" — ").trim();
  const withoutBrand = title.replace(new RegExp(`^${escapeRegExp(brand)}\\s*`, "i"), "").trim();
  return withoutBrand || title;
}

function splitIntoCandidatePhrases(text: string, brand: string): string[] {
  const cleaned = text
    .replace(/<[^>]+>/g, " ")
    .replace(/\b(open-source|opensource)\b/gi, "open source")
    .replace(/\s+/g, " ")
    .trim();
  const chunks = cleaned
    .split(/[.;:]/)
    .map((c) => c.trim())
    .filter((c) => c.length >= 8 && c.length <= 80);

  const out: string[] = [];
  for (const chunk of chunks) {
    // Prefer noun-ish tails: "MCP that audits Next.js sites for SEO" → keep shorter cores
    const withoutBrand = chunk
      .replace(new RegExp(`\\b${escapeRegExp(brand)}\\b`, "gi"), " ")
      .replace(/\s+/g, " ")
      .trim();
    if (withoutBrand.length >= 8) out.push(withoutBrand);

    // Pull "X for Y" cores
    const forMatch = withoutBrand.match(
      /\b([a-z0-9.+]+(?:\s+[a-z0-9.+]+){1,4})\s+for\s+([a-z0-9.+]+(?:\s+[a-z0-9.+]+){0,3})\b/i,
    );
    if (forMatch) {
      out.push(forMatch[1]!);
      out.push(`${forMatch[1]} for ${forMatch[2]}`);
    }
  }
  return out;
}

function cleanPhrase(phrase: string, brand: string): string | null {
  let p = phrase
    .toLowerCase()
    .replace(/[—–]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  p = p.replace(new RegExp(`\\b${escapeRegExp(brand.toLowerCase())}\\b`, "g"), "").trim();
  p = p.replace(/^(a|an|the)\s+/i, "").trim();
  // Drop leading filler verbs
  p = p.replace(
    /^(is|are|audits?|helps?|provides?|returns?|proposes?|that|which)\s+/i,
    "",
  ).trim();
  const words = p.split(/\s+/).filter((w) => !STOP_PHRASE_PARTS.has(w));
  if (words.length < 2 && !KNOWN_PHRASES.some((k) => k.phrase === p)) {
    if (words.length === 1 && words[0]!.length >= 5) {
      // single technical term ok only if known pattern family
      return null;
    }
    return null;
  }
  p = words.length >= 2 ? words.join(" ") : p;
  if (p.length < 5 || p.length > 48) return null;
  if (CHROME_TITLE_RE.test(p)) return null;
  return p;
}

function inferCategory(
  corpus: string,
  site: SiteModel,
): ProductSignals["category"] {
  if (/\b(mcp|next\.?js|developer|api|sdk|cli|open source)\b/i.test(corpus)) {
    return "developer-tool";
  }
  if (/\b(agency|consult)\b/i.test(corpus)) return "agency";
  if (/\b(shop|ecommerce|store)\b/i.test(corpus)) return "ecommerce";
  if (/\b(blog|content|publisher)\b/i.test(corpus)) return "content";
  if (
    /\b(saas|platform|analytics|software)\b/i.test(corpus) ||
    site.business.audienceHints.some((a) => /software|saas/i.test(a))
  ) {
    return "saas";
  }
  return "unknown";
}

function inferAudience(
  corpus: string,
  site: SiteModel,
  category: ProductSignals["category"],
): string {
  if (site.business.audienceHints[0] && !/general website/i.test(site.business.audienceHints[0])) {
    return site.business.audienceHints[0];
  }
  if (category === "developer-tool" || /\bnext\.?js\b/i.test(corpus)) {
    return "Next.js developers and coding agents";
  }
  if (category === "agency") return "agencies";
  if (category === "ecommerce") return "ecommerce teams";
  if (category === "saas") return "SaaS teams";
  return "teams evaluating this product";
}

function audienceSlug(
  audience: string,
  category: ProductSignals["category"],
): string {
  if (category === "developer-tool") return "nextjs-developers";
  if (/agency/i.test(audience)) return "agencies";
  if (/ecommerce|shop/i.test(audience)) return "ecommerce";
  if (/saas/i.test(audience)) return "saas-teams";
  return slugifyPhrase(audience).slice(0, 32) || "teams";
}

export function slugifyPhrase(input: string): string {
  return input
    .toLowerCase()
    .replace(/\+/g, " ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
}

function capitalizeWords(s: string): string {
  return s
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
