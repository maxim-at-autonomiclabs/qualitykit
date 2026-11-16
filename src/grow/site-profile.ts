import { createHash } from "node:crypto";
import type { SiteModel } from "../model/site.js";
import {
  coveredSearchTerms,
  extractProductSignals,
  type ProductSignals,
} from "./product-signals.js";

export type SiteProfileFieldId =
  | "brandIdentity"
  | "icp"
  | "products"
  | "brandVoice"
  | "existingPages"
  | "keywordRelevance"
  | "competitors"
  | "conversionGoals";

export type SiteProfileSource = "user" | "agent";

export type StaleReason =
  | "ttl_expired"
  | "site_changed"
  | "new_gsc_queries"
  | "deployed"
  | "empty";

export type BrandFitBand = "high" | "adjacent" | "irrelevant";

export type OpportunityAction =
  | "improve"
  | "create"
  | "fix_overlap"
  | "deprioritise";

/** Fields that rewrite business truth — never applied without user approval. */
export const MATERIAL_FIELDS: ReadonlySet<SiteProfileFieldId> = new Set([
  "brandIdentity",
  "icp",
  "products",
]);

const DAY_MS = 24 * 60 * 60 * 1000;

export const FIELD_TTL_MS: Record<SiteProfileFieldId, number | null> = {
  brandIdentity: 30 * DAY_MS,
  icp: 30 * DAY_MS,
  products: null, // event-driven (site_changed)
  brandVoice: 30 * DAY_MS,
  existingPages: null, // event-driven (site_changed / deployed)
  keywordRelevance: 7 * DAY_MS,
  competitors: 30 * DAY_MS,
  conversionGoals: null, // user config only
};

export interface ProfileFieldValue {
  value: unknown;
  updatedAt: string;
  confidence: "high" | "medium" | "low";
  evidence: string[];
  source: SiteProfileSource;
}

export interface BrandIdentityValue {
  name: string;
  positioning: string;
  category?: string;
}

export interface IcpValue {
  audience: string;
  industries: string[];
  roles: string[];
  painPoints: string[];
}

export interface ProductItem {
  name: string;
  description?: string;
}

export interface BrandVoiceValue {
  tone: string;
  terminology: string[];
  standards: string[];
}

export interface ExistingPageItem {
  path: string;
  topic: string;
  intent?: string;
  title?: string;
}

export interface KeywordRelevanceItem {
  query: string;
  score: number;
  band: BrandFitBand;
  reason: string;
  updatedAt?: string;
}

export interface CompetitorItem {
  name: string;
  positioning?: string;
}

export interface ConversionGoalsValue {
  primary: string;
  secondary: string[];
}

export interface SiteProfileFields {
  brandIdentity?: ProfileFieldValue;
  icp?: ProfileFieldValue;
  products?: ProfileFieldValue;
  brandVoice?: ProfileFieldValue;
  existingPages?: ProfileFieldValue;
  keywordRelevance?: ProfileFieldValue;
  competitors?: ProfileFieldValue;
  conversionGoals?: ProfileFieldValue;
}

export interface SiteProfile {
  version: number;
  lastVerifiedAt: string | null;
  status: "fresh" | "stale";
  siteHash: string;
  fields: SiteProfileFields;
  pendingApproval?: Partial<
    Record<
      SiteProfileFieldId,
      ProfileFieldValue & { proposedAt: string; reason?: string }
    >
  >;
  stored: boolean;
}

export interface StaleFieldInfo {
  field: SiteProfileFieldId;
  reasons: StaleReason[];
  current?: ProfileFieldValue;
  evidence: string[];
}

export interface FreshnessReport {
  status: "fresh" | "stale";
  version: number;
  lastVerifiedAt: string | null;
  staleFields: StaleFieldInfo[];
  siteHash: string;
  stored: boolean;
}

export interface BrandFitScore {
  query: string;
  score: number;
  band: BrandFitBand;
  reason: string;
  matchedTerms: string[];
  overlappingPaths: string[];
}

export interface ScoredQueryOpportunity {
  id: string;
  query: string;
  pagePath?: string;
  impressions?: number;
  clicks?: number;
  ctr?: number;
  position?: number;
  trend?: string;
  brandFit: BrandFitScore;
  action: OpportunityAction;
  risk: string[];
  title: string;
  suggestedFix: string;
}

export function computeSiteHash(site: SiteModel): string {
  const routes = site.routes
    .map((r) =>
      [
        r.path,
        r.title ?? "",
        r.description ?? "",
        (r.headings ?? []).join("|"),
      ].join("\t"),
    )
    .sort()
    .join("\n");
  const meta = [
    site.metadata.rootTitle ?? "",
    site.metadata.rootDescription ?? "",
    site.business.name ?? "",
    site.business.description ?? "",
  ].join("\n");
  return createHash("sha256")
    .update(`${meta}\n${routes}`)
    .digest("hex")
    .slice(0, 16);
}

export function draftSiteProfileFromRepo(site: SiteModel): SiteProfile {
  const signals = extractProductSignals(site);
  const now = new Date().toISOString();
  const pages = buildExistingPages(site);
  const siteHash = computeSiteHash(site);

  const fields: SiteProfileFields = {
    brandIdentity: {
      value: {
        name: signals.brand,
        positioning:
          site.metadata.rootDescription ??
          site.business.description ??
          `${signals.brand} for ${signals.audience}`,
        category: signals.category,
      } satisfies BrandIdentityValue,
      updatedAt: now,
      confidence: signals.phrases.length > 0 ? "medium" : "low",
      evidence: signals.corpusEvidence.slice(0, 4),
      source: "agent",
    },
    icp: {
      value: {
        audience: signals.audience,
        industries: [],
        roles: [],
        painPoints: [],
      } satisfies IcpValue,
      updatedAt: now,
      confidence: "low",
      evidence: [`audience=${signals.audience}`, `category=${signals.category}`],
      source: "agent",
    },
    products: {
      value: signals.phrases.map(
        (p) =>
          ({
            name: p.phrase,
            description: p.evidence,
          }) satisfies ProductItem,
      ),
      updatedAt: now,
      confidence: signals.phrases.length > 0 ? "medium" : "low",
      evidence: signals.phrases.map((p) => p.evidence).slice(0, 6),
      source: "agent",
    },
    brandVoice: {
      value: {
        tone: "clear and practical",
        terminology: signals.phrases.map((p) => p.phrase).slice(0, 8),
        standards: [
          "Mark unverified claims with [verify]",
          "Do not invent stats, authors, or competitor claims",
        ],
      } satisfies BrandVoiceValue,
      updatedAt: now,
      confidence: "low",
      evidence: ["default-voice"],
      source: "agent",
    },
    existingPages: {
      value: pages,
      updatedAt: now,
      confidence: pages.length > 0 ? "high" : "low",
      evidence: [`routes=${pages.length}`, `siteHash=${siteHash}`],
      source: "agent",
    },
    keywordRelevance: {
      value: [] as KeywordRelevanceItem[],
      updatedAt: now,
      confidence: "low",
      evidence: ["empty-until-gsc"],
      source: "agent",
    },
    competitors: {
      value: [] as CompetitorItem[],
      updatedAt: now,
      confidence: "low",
      evidence: ["optional-empty"],
      source: "agent",
    },
    conversionGoals: {
      value: {
        primary: "Learn more or start using the product",
        secondary: [],
      } satisfies ConversionGoalsValue,
      updatedAt: now,
      confidence: "low",
      evidence: ["default-goal"],
      source: "agent",
    },
  };

  return {
    version: 0,
    lastVerifiedAt: null,
    status: "stale",
    siteHash,
    fields,
    stored: false,
  };
}

function buildExistingPages(site: SiteModel): ExistingPageItem[] {
  return site.routes
    .filter((r) => r.kind === "page")
    .map((r) => ({
      path: normalizePath(r.path),
      topic: r.title ?? r.path,
      intent: inferPathIntent(r.path),
      title: r.title,
    }));
}

function inferPathIntent(path: string): string | undefined {
  const p = path.toLowerCase();
  if (p.startsWith("/features")) return "feature";
  if (p.startsWith("/solutions")) return "solution";
  if (p.startsWith("/compare")) return "comparison";
  if (p.startsWith("/tools")) return "tool";
  if (p.startsWith("/guides")) return "guide";
  if (p === "/" || p === "") return "home";
  return undefined;
}

export function checkSiteProfileFreshness(
  profile: SiteProfile,
  opts: {
    siteHash: string;
    now?: Date;
    knownQueries?: string[];
    deployedSinceVerify?: boolean;
  },
): FreshnessReport {
  const now = opts.now ?? new Date();
  const staleFields: StaleFieldInfo[] = [];
  const fieldIds = Object.keys(FIELD_TTL_MS) as SiteProfileFieldId[];

  for (const field of fieldIds) {
    const current = profile.fields[field];
    const reasons: StaleReason[] = [];
    const evidence: string[] = [];

    if (!current) {
      reasons.push("empty");
      evidence.push("field-missing");
    } else {
      const ttl = FIELD_TTL_MS[field];
      if (ttl != null) {
        const age = now.getTime() - Date.parse(current.updatedAt);
        if (Number.isFinite(age) && age > ttl) {
          reasons.push("ttl_expired");
          evidence.push(`ageMs=${age}`, `ttlMs=${ttl}`);
        }
      }
    }

    if (
      (field === "products" || field === "existingPages") &&
      opts.siteHash !== profile.siteHash
    ) {
      reasons.push("site_changed");
      evidence.push(`profileHash=${profile.siteHash}`, `siteHash=${opts.siteHash}`);
    }

    if (field === "existingPages" && opts.deployedSinceVerify) {
      reasons.push("deployed");
      evidence.push("deployed-since-last-verify");
    }

    if (field === "keywordRelevance" && opts.knownQueries?.length) {
      const known = new Set(
        (asKeywordItems(current?.value) ?? []).map((k) =>
          k.query.toLowerCase(),
        ),
      );
      const unseen = opts.knownQueries.filter(
        (q) => !known.has(q.toLowerCase()),
      );
      if (unseen.length > 0) {
        reasons.push("new_gsc_queries");
        evidence.push(`unseen=${unseen.slice(0, 5).join("|")}`);
      }
    }

    if (reasons.length > 0) {
      staleFields.push({ field, reasons, current, evidence });
    }
  }

  return {
    status: staleFields.length > 0 ? "stale" : "fresh",
    version: profile.version,
    lastVerifiedAt: profile.lastVerifiedAt,
    staleFields,
    siteHash: opts.siteHash,
    stored: profile.stored,
  };
}

function asKeywordItems(value: unknown): KeywordRelevanceItem[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value as KeywordRelevanceItem[];
}

export function applySiteProfilePatch(
  profile: SiteProfile,
  patch: Partial<Record<SiteProfileFieldId, ProfileFieldValue>>,
  opts?: { approveMaterial?: boolean; now?: Date },
): {
  profile: SiteProfile;
  applied: SiteProfileFieldId[];
  pending: SiteProfileFieldId[];
} {
  const now = (opts?.now ?? new Date()).toISOString();
  const next: SiteProfile = {
    ...profile,
    fields: { ...profile.fields },
    pendingApproval: { ...(profile.pendingApproval ?? {}) },
  };
  const applied: SiteProfileFieldId[] = [];
  const pending: SiteProfileFieldId[] = [];

  for (const [key, fieldValue] of Object.entries(patch) as Array<
    [SiteProfileFieldId, ProfileFieldValue]
  >) {
    if (!fieldValue) continue;
    const normalized: ProfileFieldValue = {
      ...fieldValue,
      updatedAt: fieldValue.updatedAt || now,
    };

    if (MATERIAL_FIELDS.has(key) && !opts?.approveMaterial) {
      next.pendingApproval![key] = {
        ...normalized,
        proposedAt: now,
      };
      pending.push(key);
      continue;
    }

    next.fields[key] = normalized;
    if (next.pendingApproval?.[key]) {
      delete next.pendingApproval[key];
    }
    applied.push(key);
  }

  if (applied.length > 0) {
    next.version = profile.version + 1;
    next.lastVerifiedAt = now;
  }

  if (next.pendingApproval && Object.keys(next.pendingApproval).length === 0) {
    delete next.pendingApproval;
  }

  return { profile: next, applied, pending };
}

export function approvePendingSiteProfile(
  profile: SiteProfile,
  fields?: SiteProfileFieldId[],
  now = new Date(),
): SiteProfile {
  const pending = profile.pendingApproval ?? {};
  const keys = (fields ?? (Object.keys(pending) as SiteProfileFieldId[])).filter(
    (k) => pending[k],
  );
  if (keys.length === 0) return profile;

  const patch: Partial<Record<SiteProfileFieldId, ProfileFieldValue>> = {};
  for (const key of keys) {
    const p = pending[key]!;
    patch[key] = {
      value: p.value,
      updatedAt: now.toISOString(),
      confidence: p.confidence,
      evidence: p.evidence,
      source: "user",
    };
  }
  return applySiteProfilePatch(profile, patch, {
    approveMaterial: true,
    now,
  }).profile;
}

/** Build a scoring lexicon from the approved profile (pending ignored). */
export function profileLexicon(profile: SiteProfile): {
  brand: string;
  terms: string[];
  pages: ExistingPageItem[];
  voiceStandards: string[];
} {
  const brand =
    (profile.fields.brandIdentity?.value as BrandIdentityValue | undefined)
      ?.name ?? "the product";
  const terms = new Set<string>();
  const add = (text: string | undefined) => {
    if (!text) return;
    for (const t of tokenize(text)) terms.add(t);
    const lower = text.toLowerCase().trim();
    if (lower.length >= 4) terms.add(lower);
  };

  const identity = profile.fields.brandIdentity?.value as
    | BrandIdentityValue
    | undefined;
  add(identity?.name);
  add(identity?.positioning);
  add(identity?.category);

  const icp = profile.fields.icp?.value as IcpValue | undefined;
  add(icp?.audience);
  for (const x of icp?.industries ?? []) add(x);
  for (const x of icp?.roles ?? []) add(x);
  for (const x of icp?.painPoints ?? []) add(x);

  const products = profile.fields.products?.value as ProductItem[] | undefined;
  for (const p of products ?? []) {
    add(p.name);
    add(p.description);
  }

  const pages =
    (profile.fields.existingPages?.value as ExistingPageItem[] | undefined) ??
    [];
  for (const page of pages) {
    add(page.topic);
    add(page.title);
    add(page.path.replace(/\//g, " ").replace(/-/g, " "));
  }

  const voice = profile.fields.brandVoice?.value as BrandVoiceValue | undefined;
  for (const t of voice?.terminology ?? []) add(t);

  return {
    brand,
    terms: [...terms],
    pages,
    voiceStandards: voice?.standards ?? [],
  };
}

export function scoreQueryBrandFit(
  query: string,
  profile: SiteProfile,
): BrandFitScore {
  const lex = profileLexicon(profile);
  const qTokens = tokenize(query);
  if (qTokens.length === 0) {
    return {
      query,
      score: 0,
      band: "irrelevant",
      reason: "Empty query.",
      matchedTerms: [],
      overlappingPaths: [],
    };
  }

  const matchedTerms: string[] = [];
  let hits = 0;
  for (const token of qTokens) {
    const hit = lex.terms.some(
      (t) => t === token || t.includes(token) || token.includes(t),
    );
    if (hit) {
      hits += 1;
      matchedTerms.push(token);
    }
  }

  // Phrase-level: multi-word lexicon entries overlapping the query
  const qLower = query.toLowerCase();
  for (const term of lex.terms) {
    if (term.includes(" ") && qLower.includes(term) && !matchedTerms.includes(term)) {
      matchedTerms.push(term);
      hits += 2;
    }
  }

  const overlapRatio = hits / Math.max(qTokens.length, 1);
  let score = Math.round(Math.min(100, overlapRatio * 100));

  // Soft boost when brand name appears (branded search)
  if (lex.brand && qLower.includes(lex.brand.toLowerCase())) {
    score = Math.min(100, score + 15);
    if (!matchedTerms.includes(lex.brand.toLowerCase())) {
      matchedTerms.push(lex.brand.toLowerCase());
    }
  }

  const overlappingPaths = lex.pages
    .filter((p) => {
      const hay = `${p.path} ${p.topic} ${p.title ?? ""}`.toLowerCase();
      const matched = qTokens.filter((t) => t.length >= 3 && hasToken(hay, t));
      return matched.length >= Math.min(2, qTokens.length);
    })
    .map((p) => p.path);

  const band: BrandFitBand =
    score >= 70 ? "high" : score >= 40 ? "adjacent" : "irrelevant";

  const reason =
    band === "irrelevant"
      ? `No meaningful overlap with approved brand, ICP, or products for “${query}”.`
      : band === "adjacent"
        ? `Partial fit via ${matchedTerms.slice(0, 4).join(", ") || "related terms"}.`
        : `Strong fit with ${matchedTerms.slice(0, 4).join(", ")}.`;

  return {
    query,
    score,
    band,
    reason,
    matchedTerms: [...new Set(matchedTerms)].slice(0, 12),
    overlappingPaths: [...new Set(overlappingPaths)].slice(0, 8),
  };
}

export function classifyGscQuery(
  opp: {
    id: string;
    title?: string;
    pagePath?: string;
    query?: string;
    impressions?: number;
    clicks?: number;
    position?: number;
    trend?: string;
  },
  profile: SiteProfile,
  site: SiteModel,
): ScoredQueryOpportunity {
  const query = opp.query ?? opp.title ?? opp.id;
  const brandFit = scoreQueryBrandFit(query, profile);
  const impressions = opp.impressions;
  const clicks = opp.clicks;
  const ctr =
    impressions != null && impressions > 0 && clicks != null
      ? clicks / impressions
      : undefined;
  const position = opp.position;
  const paths = findOverlappingRoutes(query, site);
  const risk: string[] = [];

  let action: OpportunityAction = "deprioritise";
  let title = `Deprioritise “${query}”`;
  let suggestedFix = `Do not create content for “${query}” — brand fit is ${brandFit.band} (${brandFit.score}).`;

  if (brandFit.band === "irrelevant") {
    action = "deprioritise";
  } else if (paths.length >= 2) {
    action = "fix_overlap";
    title = `Fix overlapping keywords: “${query}”`;
    suggestedFix = `Consolidate intent for “${query}” across ${paths.join(", ")}. Pick one primary page and retarget the others.`;
    risk.push("cannibalisation");
  } else if (paths.length === 1) {
    const path = paths[0]!;
    action = "improve";
    title = `Improve ${path} CTR for “${query}”`;
    suggestedFix = `Optimise ${path} for “${query}” (title, intro, internal links) without changing product positioning.`;
    if (position != null && position > 10) risk.push("weak_ranking");
    if (ctr != null && ctr < 0.03 && (impressions ?? 0) > 100) {
      risk.push("low_ctr");
    }
  } else if (
    paths.length === 0 &&
    brandFit.overlappingPaths.length === 1 &&
    brandFit.band === "high"
  ) {
    // Strong brand fit + a single profile page already covering the topic
    const path = brandFit.overlappingPaths[0]!;
    action = "improve";
    title = `Improve ${path} CTR for “${query}”`;
    suggestedFix = `Optimise ${path} for “${query}” (title, intro, internal links) without changing product positioning.`;
    if (position != null && position > 10) risk.push("weak_ranking");
    if (ctr != null && ctr < 0.03 && (impressions ?? 0) > 100) {
      risk.push("low_ctr");
    }
  } else {
    action = "create";
    title = `Create page for “${query}”`;
    suggestedFix = `Create one dedicated page that answers “${query}” for the approved ICP. Follow brand voice; mark unverified claims with [verify].`;
    risk.push("brand_drift_if_off_icp");
  }

  if (brandFit.band === "adjacent" && action === "create") {
    risk.push("adjacent_demand");
  }

  return {
    id: opp.id.startsWith("gsc-") ? opp.id : `gsc-query-${slugId(query)}`,
    query,
    pagePath: opp.pagePath,
    impressions,
    clicks,
    ctr,
    position,
    trend: opp.trend,
    brandFit,
    action,
    risk,
    title,
    suggestedFix,
  };
}

function findOverlappingRoutes(query: string, site: SiteModel): string[] {
  const tokens = tokenize(query).filter((t) => t.length >= 3);
  if (tokens.length === 0) return [];
  const hits: string[] = [];
  for (const route of site.routes) {
    if (route.kind !== "page") continue;
    const hay = [
      route.path,
      route.title,
      route.description,
      ...(route.headings ?? []),
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    const matched = tokens.filter((t) => hasToken(hay, t)).length;
    if (matched >= Math.min(2, tokens.length) || matched === tokens.length) {
      hits.push(normalizePath(route.path));
    }
  }
  return [...new Set(hits)];
}

/** Whole-token match so "team" does not hit "teams" / "TaskFlow". */
function hasToken(hay: string, token: string): boolean {
  if (!token) return false;
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|[^a-z0-9])${escaped}(?:[^a-z0-9]|$)`, "i").test(hay);
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9.+]+/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 2 && !STOP.has(t));
}

const STOP = new Set([
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
  "a",
  "an",
  "of",
  "to",
  "in",
  "on",
  "or",
  "is",
  "are",
  "be",
  "as",
  "by",
  "at",
  "it",
  "free",
]);

function normalizePath(path: string): string {
  if (!path.startsWith("/")) return `/${path}`;
  if (path.length > 1 && path.endsWith("/")) return path.slice(0, -1);
  return path;
}

function slugId(query: string): string {
  return query
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
}

/** Refresh evidence for the agent — no model call. */
export function buildRefreshBrief(
  profile: SiteProfile,
  freshness: FreshnessReport,
  site: SiteModel,
  gscQueries: string[] = [],
): {
  instruction: string;
  staleFields: StaleFieldInfo[];
  evidence: {
    productSignals: ProductSignals;
    coveredTerms: string[];
    siteHash: string;
    sampleQueries: string[];
  };
} {
  const signals = extractProductSignals(site);
  return {
    instruction:
      "Reassess only the listed stale fields using the evidence below. Propose a patch via qualitykit.update_site_profile. Leave fresh fields untouched. Ask the user before changing brand identity, ICP, or product positioning.",
    staleFields: freshness.staleFields,
    evidence: {
      productSignals: signals,
      coveredTerms: [...coveredSearchTerms(site)].slice(0, 40),
      siteHash: freshness.siteHash,
      sampleQueries: gscQueries.slice(0, 20),
    },
  };
}

export function normalizeCloudProfile(
  raw: Record<string, unknown> | null | undefined,
): SiteProfile | null {
  if (!raw || typeof raw !== "object") return null;
  const fields = (raw.fields ?? {}) as SiteProfileFields;
  return {
    version: Number(raw.version ?? 0),
    lastVerifiedAt: (raw.lastVerifiedAt as string | null) ?? null,
    status: raw.status === "fresh" ? "fresh" : "stale",
    siteHash: String(raw.siteHash ?? ""),
    fields,
    pendingApproval: raw.pendingApproval as SiteProfile["pendingApproval"],
    stored: true,
  };
}
