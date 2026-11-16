import {
  sortFindings,
  type Confidence,
  type Effort,
  type Finding,
  type FixSafety,
  type Impact,
} from "../model/finding.js";
import type { SiteModel } from "../model/site.js";
import {
  coveredSearchTerms,
  extractProductSignals,
  phraseAlreadyCovered,
  slugifyPhrase,
  type ProductSignals,
} from "./product-signals.js";
import {
  checkSiteProfileFreshness,
  classifyGscQuery,
  computeSiteHash,
  draftSiteProfileFromRepo,
  type FreshnessReport,
  type ScoredQueryOpportunity,
  type SiteProfile,
} from "./site-profile.js";

export type ImpressionDriverId =
  | "indexability"
  | "coverage"
  | "intent"
  | "content"
  | "internal_links"
  | "authority"
  | "technical_seo";

export type DriverStatus = "blocking" | "limited" | "ok" | "not_measured";

export type PageIntent =
  | "feature"
  | "solution"
  | "comparison"
  | "tool"
  | "guide";

export interface DriverDiagnosis {
  id: ImpressionDriverId;
  title: string;
  status: DriverStatus;
  priority: number;
  evidence: string[];
  findingIds: string[];
  summary: string;
}

export type DemandSignal = "unverified" | "gsc_backed";

export interface GrowPageOpportunity {
  path: string;
  intent: PageIntent;
  demand: DemandSignal;
  whyNotDuplicate: string;
}

export interface GscOpportunityOverlay {
  id: string;
  title?: string;
  pagePath?: string;
  query?: string;
  impressions?: number;
  clicks?: number;
  position?: number;
  evidence?: string[];
  trend?: string;
}

export interface GrowChange {
  id: string;
  title: string;
  kind: "finding" | "page";
  driver: ImpressionDriverId;
  expectedImpact: Impact;
  confidence: Confidence;
  effort: Effort;
  fixSafety: FixSafety;
  evidence: string[];
  suggestedFix: string;
  verification: string;
  findingId?: string;
  page?: GrowPageOpportunity;
}

export interface GrowReport {
  why: DriverDiagnosis[];
  topChanges: GrowChange[];
  safeToImplement: GrowChange[];
  needsApproval: GrowChange[];
  indexabilityBlocked: boolean;
  notes: string[];
  profile?: {
    version: number;
    status: "fresh" | "stale" | "missing";
    stored: boolean;
    lastVerifiedAt: string | null;
    staleFields: FreshnessReport["staleFields"];
  };
  queries?: ScoredQueryOpportunity[];
  opportunities?: ScoredQueryOpportunity[];
  deprioritised?: ScoredQueryOpportunity[];
  withholdNewPages?: boolean;
}

const DRIVER_TITLES: Record<ImpressionDriverId, string> = {
  indexability: "Indexability",
  coverage: "Keyword coverage",
  intent: "Search intent",
  content: "Content quality",
  internal_links: "Internal linking",
  authority: "Authority",
  technical_seo: "Technical SEO",
};

const LOW_VALUE_FINDING_IDS = new Set([
  "llms-txt-optional",
  "pages-router",
  "unsupported-framework",
]);

const MAX_CHANGES = 10;
const MAX_PAGE_OPPORTUNITIES = 5;

/** All finding + page grow changes (not limited to top 10) for id resolution. */
export function listGrowChanges(
  site: SiteModel,
  findings: Finding[],
): GrowChange[] {
  const indexabilityBlocked = findings.some((f) => f.id === "robots-blocks-all");
  const pageChanges = indexabilityBlocked
    ? []
    : buildPageOpportunities(site).slice(0, MAX_PAGE_OPPORTUNITIES);
  const findingChanges = findingsToChanges(findings, indexabilityBlocked);
  return rankChanges([...findingChanges, ...pageChanges]);
}

export function findGrowChangeById(
  site: SiteModel,
  findings: Finding[],
  opportunityId: string,
): GrowChange | undefined {
  return listGrowChanges(site, findings).find((c) => c.id === opportunityId);
}

export function buildGrowReport(
  site: SiteModel,
  findings: Finding[],
  gscOpportunities: GscOpportunityOverlay[] = [],
  profileInput?: SiteProfile | null,
  opts?: { continueDespiteStaleProfile?: boolean },
): GrowReport {
  const indexabilityBlocked = findings.some((f) => f.id === "robots-blocks-all");
  const why = diagnoseDrivers(site, findings, indexabilityBlocked);
  const allChanges = listGrowChanges(site, findings);
  let topChanges = allChanges.slice(0, MAX_CHANGES);

  const siteHash = computeSiteHash(site);
  const profile = profileInput ?? draftSiteProfileFromRepo(site);
  const knownQueries = gscOpportunities
    .map((o) => o.query)
    .filter((q): q is string => Boolean(q));
  const freshness = checkSiteProfileFreshness(profile, {
    siteHash,
    knownQueries,
  });
  const materialStale = freshness.staleFields.some((f) =>
    ["brandIdentity", "icp", "products"].includes(f.field),
  );
  const withholdNewPages = opts?.continueDespiteStaleProfile
    ? false
    : !profile.stored || materialStale;

  let queries: ScoredQueryOpportunity[] = [];
  let opportunities: ScoredQueryOpportunity[] = [];
  let deprioritised: ScoredQueryOpportunity[] = [];

  if (gscOpportunities.length > 0) {
    const scored = applyBrandAlignedGsc(
      topChanges,
      gscOpportunities,
      profile,
      site,
      withholdNewPages,
    );
    topChanges = scored.topChanges;
    queries = scored.queries;
    opportunities = scored.opportunities;
    deprioritised = scored.deprioritised;
  }

  const safeToImplement = topChanges.filter((c) => c.fixSafety === "auto");
  const needsApproval = topChanges.filter((c) => c.fixSafety !== "auto");
  const gscBacked = topChanges.some(
    (c) => c.page?.demand === "gsc_backed" || c.evidence.includes("demand=gsc_backed"),
  );

  return {
    why,
    topChanges,
    safeToImplement,
    needsApproval,
    indexabilityBlocked,
    profile: {
      version: profile.version,
      status: freshness.status === "missing" ? "stale" : freshness.status,
      stored: profile.stored,
      lastVerifiedAt: profile.lastVerifiedAt,
      staleFields: freshness.staleFields,
    },
    queries,
    opportunities,
    deprioritised,
    withholdNewPages,
    notes: [
      profile.stored
        ? `Scoring against Site Profile v${profile.version} (${freshness.status}).`
        : "No stored Site Profile — using ephemeral repo draft (low confidence). Confirm via qualitykit.update_site_profile.",
      gscBacked
        ? "Some opportunities are backed by Google Search Console evidence (gsc_backed) and brand-fit scoring."
        : "Demand for new pages is unverified until Search Console or keyword data is connected.",
      withholdNewPages
        ? "New-page contracts withheld until brand/ICP/products are fresh and approved (or user explicitly continues)."
        : "Brand profile allows new-page recommendations when demand fits.",
      "QualityKit does not guarantee impression growth. Measure non-branded impressions, indexed pages, average position, clicks, and conversions after publish.",
      "Authority (backlinks and mentions) is not measured in the local MCP.",
      "No OpenAI key is used. The coding agent drafts approved copy.",
      indexabilityBlocked
        ? "Indexability is blocked (robots Disallow: /). Fix crawl access before building new pages."
        : "Indexability is not fully blocked; mix technical fixes with a few targeted pages.",
    ],
  };
}

/**
 * Brand-aligned GSC overlay: score queries, deprioritise irrelevant demand,
 * boost matching pages, and emit create/improve/overlap changes only for fit.
 */
export function applyBrandAlignedGsc(
  changes: GrowChange[],
  opportunities: GscOpportunityOverlay[],
  profile: SiteProfile,
  site: SiteModel,
  withholdNewPages: boolean,
): {
  topChanges: GrowChange[];
  queries: ScoredQueryOpportunity[];
  opportunities: ScoredQueryOpportunity[];
  deprioritised: ScoredQueryOpportunity[];
} {
  const queries = opportunities.map((opp) =>
    classifyGscQuery(opp, profile, site),
  );
  const deprioritised = queries.filter((q) => q.action === "deprioritise");
  const actionable = queries.filter((q) => q.action !== "deprioritise");

  const byId = new Map(changes.map((c) => [c.id, { ...c }]));
  const byPath = new Map(
    changes
      .filter((c) => c.page?.path)
      .map((c) => [normalizePath(c.page!.path), { ...c }]),
  );
  const matched = new Set<string>();
  const gscChanges: GrowChange[] = [];
  const keptOpportunities: ScoredQueryOpportunity[] = [];

  for (const scored of actionable) {
    if (scored.action === "create" && withholdNewPages) {
      continue;
    }

    keptOpportunities.push(scored);
    const path = scored.pagePath ? normalizePath(scored.pagePath) : null;
    const pathMatch =
      (path ? byPath.get(path) : undefined) ||
      (scored.brandFit.overlappingPaths[0]
        ? byPath.get(normalizePath(scored.brandFit.overlappingPaths[0]))
        : undefined);

    if (pathMatch && scored.action === "improve") {
      matched.add(pathMatch.id);
      const evidence = [
        ...pathMatch.evidence.filter((e) => !e.startsWith("demand=")),
        "demand=gsc_backed",
        `brandFit=${scored.brandFit.score}`,
        `brandBand=${scored.brandFit.band}`,
        `query=${scored.query}`,
      ];
      if (scored.impressions != null) {
        evidence.push(`gscImpressions=${scored.impressions}`);
      }
      if (scored.position != null) {
        evidence.push(`gscPosition=${scored.position}`);
      }
      const updated: GrowChange = {
        ...pathMatch,
        title: scored.title,
        confidence: "high",
        expectedImpact: "high",
        suggestedFix: scored.suggestedFix,
        evidence: [...new Set(evidence)],
        page: pathMatch.page
          ? { ...pathMatch.page, demand: "gsc_backed" }
          : pathMatch.page,
      };
      byId.set(updated.id, updated);
      continue;
    }

    gscChanges.push(scoredQueryToGrowChange(scored));
  }

  const boosted = [...matched].map((id) => byId.get(id)!);
  const rest = [...byId.values()].filter((c) => !matched.has(c.id));
  // Drop unverified page ideas that conflict with deprioritised query topics
  const depriorTerms = new Set(
    deprioritised.flatMap((d) =>
      d.query
        .toLowerCase()
        .split(/\s+/)
        .filter((t) => t.length >= 4),
    ),
  );
  const filteredRest = rest.filter((c) => {
    if (c.kind !== "page" || !c.page) return true;
    const hay = `${c.title} ${c.page.path}`.toLowerCase();
    return ![...depriorTerms].some((t) => hay.includes(t));
  });

  return {
    topChanges: rankChanges([...boosted, ...gscChanges, ...filteredRest]).slice(
      0,
      MAX_CHANGES,
    ),
    queries,
    opportunities: keptOpportunities.slice(0, MAX_CHANGES),
    deprioritised,
  };
}

function scoredQueryToGrowChange(scored: ScoredQueryOpportunity): GrowChange {
  const intentPath =
    scored.action === "create"
      ? `/guides/${scored.query
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, "")
          .slice(0, 48)}`
      : scored.pagePath
        ? normalizePath(scored.pagePath)
        : scored.brandFit.overlappingPaths[0];

  return {
    id: scored.id,
    title: scored.title,
    kind: "page",
    driver:
      scored.action === "fix_overlap" ? "coverage" : scored.action === "improve"
        ? "content"
        : "coverage",
    expectedImpact: scored.brandFit.band === "high" ? "high" : "medium",
    confidence: "high",
    effort: scored.action === "create" ? "high" : "medium",
    fixSafety: "approval",
    evidence: [
      "demand=gsc_backed",
      `brandFit=${scored.brandFit.score}`,
      `brandBand=${scored.brandFit.band}`,
      `action=${scored.action}`,
      `query=${scored.query}`,
      scored.impressions != null ? `gscImpressions=${scored.impressions}` : "",
      scored.position != null ? `gscPosition=${scored.position}` : "",
      ...scored.risk.map((r) => `risk=${r}`),
    ].filter(Boolean),
    suggestedFix: scored.suggestedFix,
    verification:
      "Re-check impressions, CTR, and average position in Search Console after publish.",
    page: intentPath
      ? {
          path: intentPath,
          intent: scored.action === "create" ? "guide" : "guide",
          demand: "gsc_backed",
          whyNotDuplicate: scored.brandFit.reason,
        }
      : undefined,
  };
}

/** @deprecated Prefer applyBrandAlignedGsc — kept for callers that only need path boost. */
export function applyGscOverlay(
  changes: GrowChange[],
  opportunities: GscOpportunityOverlay[],
  profile?: SiteProfile | null,
  site?: SiteModel,
): GrowChange[] {
  if (profile && site) {
    return applyBrandAlignedGsc(changes, opportunities, profile, site, false)
      .topChanges;
  }
  // Legacy: treat all GSC rows as high impact (no brand filter)
  const byId = new Map(changes.map((c) => [c.id, { ...c }]));
  const byPath = new Map(
    changes
      .filter((c) => c.page?.path)
      .map((c) => [normalizePath(c.page!.path), { ...c }]),
  );
  const matched = new Set<string>();
  const gscOnly: GrowChange[] = [];

  for (const opp of opportunities) {
    const path = opp.pagePath ? normalizePath(opp.pagePath) : null;
    const target =
      (opp.id && byId.get(opp.id)) ||
      (path ? byPath.get(path) : undefined);

    if (target) {
      matched.add(target.id);
      const evidence = [
        ...target.evidence.filter((e) => !e.startsWith("demand=")),
        ...(opp.evidence ?? []),
        "demand=gsc_backed",
      ];
      if (opp.impressions != null) {
        evidence.push(`gscImpressions=${opp.impressions}`);
      }
      if (opp.position != null) {
        evidence.push(`gscPosition=${opp.position}`);
      }
      const updated: GrowChange = {
        ...target,
        confidence: "high",
        expectedImpact: "high",
        evidence: [...new Set(evidence)],
        page: target.page
          ? { ...target.page, demand: "gsc_backed" }
          : target.page,
      };
      byId.set(updated.id, updated);
      if (updated.page?.path) {
        byPath.set(normalizePath(updated.page.path), updated);
      }
    } else {
      gscOnly.push({
        id: opp.id,
        title:
          opp.title ??
          `GSC opportunity: ${opp.query ?? opp.pagePath ?? opp.id}`,
        kind: "page",
        driver: "coverage",
        expectedImpact: "high",
        confidence: "high",
        effort: "medium",
        fixSafety: "approval",
        evidence: [
          ...(opp.evidence ?? []),
          "demand=gsc_backed",
          opp.query ? `query=${opp.query}` : "",
          opp.pagePath ? `path=${opp.pagePath}` : "",
        ].filter(Boolean),
        suggestedFix: opp.query
          ? `Create or improve a page that answers “${opp.query}” (GSC shows impressions with a weak average position).`
          : `Improve ${opp.pagePath ?? "this URL"} using Search Console evidence.`,
        verification:
          "Re-check impressions and average position in Search Console after publish.",
        page: opp.pagePath
          ? {
              path: normalizePath(opp.pagePath),
              intent: "guide",
              demand: "gsc_backed",
              whyNotDuplicate:
                "Surfaced from Search Console, not only codebase coverage.",
            }
          : undefined,
      });
    }
  }

  const boosted = [...matched].map((id) => byId.get(id)!);
  const rest = [...byId.values()].filter((c) => !matched.has(c.id));
  return rankChanges([...boosted, ...gscOnly, ...rest]).slice(0, MAX_CHANGES);
}

function diagnoseDrivers(
  site: SiteModel,
  findings: Finding[],
  indexabilityBlocked: boolean,
): DriverDiagnosis[] {
  const byDriver = new Map<ImpressionDriverId, Finding[]>();
  for (const id of Object.keys(DRIVER_TITLES) as ImpressionDriverId[]) {
    byDriver.set(id, []);
  }
  for (const finding of findings) {
    if (LOW_VALUE_FINDING_IDS.has(finding.id)) continue;
    const driver = driverForFinding(finding);
    byDriver.get(driver)!.push(finding);
  }

  const pageRoutes = site.routes.filter((r) => r.kind === "page");
  const staticPages = pageRoutes.filter((r) => !r.path.includes(":"));

  const drivers: DriverDiagnosis[] = [
    makeDriver("indexability", indexabilityBlocked ? "blocking" : statusFromFindings(byDriver.get("indexability")!), 1, byDriver.get("indexability")!, indexabilityBlocked
      ? "Google cannot reliably index the site until crawl access is restored."
      : byDriver.get("indexability")!.length
        ? "Discovery aids (robots/sitemap) are incomplete."
        : "Robots does not block all paths; sitemap presence checked."),
    makeDriver(
      "coverage",
      staticPages.length <= 2 ? "limited" : statusFromFindings(byDriver.get("coverage")!),
      2,
      byDriver.get("coverage")!,
      staticPages.length <= 2
        ? `Only ${staticPages.length} static page(s) inventoried — limited topical coverage.`
        : "Multiple pages exist; coverage gaps may remain without search data.",
    ),
    makeDriver(
      "intent",
      pageRoutes.some(isIntentLanding) ? "ok" : "limited",
      3,
      byDriver.get("intent")!,
      pageRoutes.some(isIntentLanding)
        ? "Some intent-shaped routes exist (features/solutions/guides)."
        : "No feature, solution, comparison, tool, or guide landing pages detected.",
    ),
    makeDriver(
      "content",
      statusFromFindings(byDriver.get("content")!),
      4,
      byDriver.get("content")!,
      byDriver.get("content")!.length
        ? "On-page content issues reduce clarity for searchers."
        : "No strong content defects detected in source.",
    ),
    makeDriver(
      "internal_links",
      statusFromFindings(byDriver.get("internal_links")!),
      5,
      byDriver.get("internal_links")!,
      byDriver.get("internal_links")!.length
        ? "Some pages lack inbound internal links from scanned sources."
        : "No orphan-page signals from scanned internal links.",
    ),
    {
      id: "authority",
      title: DRIVER_TITLES.authority,
      status: "not_measured",
      priority: 6,
      evidence: ["Backlinks and brand mentions are outside the local codebase audit."],
      findingIds: [],
      summary: "Authority is not measured without external link data.",
    },
    makeDriver(
      "technical_seo",
      statusFromFindings(byDriver.get("technical_seo")!),
      7,
      byDriver.get("technical_seo")!,
      byDriver.get("technical_seo")!.length
        ? "Metadata, schema, or related technical gaps remain."
        : "No major technical SEO findings beyond indexability checks.",
    ),
  ];

  return drivers.sort((a, b) => {
    const statusRank: Record<DriverStatus, number> = {
      blocking: 0,
      limited: 1,
      ok: 2,
      not_measured: 3,
    };
    if (statusRank[a.status] !== statusRank[b.status]) {
      return statusRank[a.status] - statusRank[b.status];
    }
    return a.priority - b.priority;
  });
}

function makeDriver(
  id: ImpressionDriverId,
  status: DriverStatus,
  priority: number,
  findings: Finding[],
  summary: string,
): DriverDiagnosis {
  return {
    id,
    title: DRIVER_TITLES[id],
    status,
    priority,
    evidence: findings.flatMap((f) => f.evidence).slice(0, 8),
    findingIds: findings.map((f) => f.id),
    summary,
  };
}

function statusFromFindings(findings: Finding[]): DriverStatus {
  if (findings.some((f) => f.id === "robots-blocks-all")) return "blocking";
  if (findings.some((f) => f.kind === "defect" || f.expectedImpact === "high")) {
    return "limited";
  }
  if (findings.length > 0) return "limited";
  return "ok";
}

function driverForFinding(finding: Finding): ImpressionDriverId {
  if (
    finding.id === "robots-blocks-all" ||
    finding.id === "missing-robots" ||
    finding.id === "missing-sitemap"
  ) {
    return "indexability";
  }
  if (finding.id.startsWith("orphan-")) return "internal_links";
  if (
    finding.id === "no-blog" ||
    finding.id.startsWith("heading-") ||
    finding.id.startsWith("alt-")
  ) {
    return "content";
  }
  if (finding.category === "content") return "content";
  if (finding.category === "links") return "internal_links";
  if (finding.category === "metadata" || finding.category === "schema") {
    return "technical_seo";
  }
  return "technical_seo";
}

function findingsToChanges(
  findings: Finding[],
  indexabilityBlocked: boolean,
): GrowChange[] {
  const sorted = sortFindings(findings);
  const out: GrowChange[] = [];
  for (const finding of sorted) {
    if (LOW_VALUE_FINDING_IDS.has(finding.id)) continue;
    if (finding.id.startsWith("ai-crawler-")) continue;
    if (
      indexabilityBlocked &&
      finding.id !== "robots-blocks-all" &&
      driverForFinding(finding) !== "indexability" &&
      driverForFinding(finding) !== "technical_seo"
    ) {
      // Keep crawl-related + technical metadata; drop content/blog/orphan until unblocked
      if (
        finding.category === "content" ||
        finding.category === "links" ||
        finding.id === "no-blog"
      ) {
        continue;
      }
    }
    out.push({
      id: finding.id,
      title: finding.title,
      kind: "finding",
      driver: driverForFinding(finding),
      expectedImpact: finding.expectedImpact,
      confidence: finding.confidence,
      effort: finding.effort,
      fixSafety: finding.fixSafety,
      evidence: finding.evidence,
      suggestedFix: finding.suggestedFix,
      verification: finding.verification,
      findingId: finding.id,
    });
  }
  return out;
}

function buildPageOpportunities(site: SiteModel): GrowChange[] {
  const existing = new Set(site.routes.map((r) => normalizePath(r.path)));
  const covered = coveredSearchTerms(site);
  const signals = extractProductSignals(site);
  const staticPageCount = site.routes.filter(
    (r) => r.kind === "page" && !r.path.includes(":"),
  ).length;
  const changes: GrowChange[] = [];

  for (const c of planOpportunityCandidates(signals, covered)) {
    const path = normalizePath(c.path);
    if (existing.has(path) || pathExistsPrefix(existing, path)) continue;
    if (changes.some((x) => x.page?.path === path)) continue;
    if (path === "/blog" || path.startsWith("/blog/")) continue;
    if (changes.length >= MAX_PAGE_OPPORTUNITIES) break;

    const confidence: Confidence =
      c.evidence.startsWith("matched:") || signals.phrases.length > 0
        ? "medium"
        : "low";

    changes.push({
      id: `page-${c.intent}-${slugifyPhrase(path)}`,
      title: c.title,
      kind: "page",
      driver: c.intent === "guide" ? "coverage" : "intent",
      expectedImpact: c.impact,
      confidence,
      effort: "high",
      fixSafety: "approval",
      evidence: [
        `brand=${signals.brand}`,
        `topic=${c.topic}`,
        `category=${signals.category}`,
        `staticPages=${staticPageCount}`,
        c.evidence,
        "demand=unverified",
        ...signals.corpusEvidence.slice(0, 2).map((e) => `corpus=${e.slice(0, 80)}`),
      ],
      suggestedFix: c.suggestedFix,
      verification:
        "Page is linked from a key route, indexed after publish, and measured in Search Console (impressions/clicks) — QualityKit does not predict those numbers.",
      page: {
        path,
        intent: c.intent,
        demand: "unverified",
        whyNotDuplicate: c.whyNotDuplicate,
      },
    });
  }

  return changes;
}

function planOpportunityCandidates(
  signals: ProductSignals,
  covered: Set<string>,
): Array<{
  intent: PageIntent;
  path: string;
  title: string;
  topic: string;
  impact: Impact;
  evidence: string;
  suggestedFix: string;
  whyNotDuplicate: string;
}> {
  const primary =
    signals.phrases.find((p) => !phraseAlreadyCovered(p.phrase, covered)) ??
    signals.phrases[0];
  const secondary = signals.phrases.find(
    (p) =>
      p.phrase !== primary?.phrase && !phraseAlreadyCovered(p.phrase, covered),
  );

  const out: Array<{
    intent: PageIntent;
    path: string;
    title: string;
    topic: string;
    impact: Impact;
    evidence: string;
    suggestedFix: string;
    whyNotDuplicate: string;
  }> = [];

  if (primary) {
    const featureSlug = primary.slug;
    out.push({
      intent: "feature",
      path: `/features/${featureSlug}`,
      title: `Add feature page: ${primary.phrase}`,
      topic: primary.phrase,
      impact: "high",
      evidence: primary.evidence,
      suggestedFix: `Create /features/${featureSlug} explaining how ${signals.brand} delivers “${primary.phrase}”. Lead with a direct answer; draft with the coding agent; mark unverified claims with [verify].`,
      whyNotDuplicate: `No existing route covers the feature intent for “${primary.phrase}”.`,
    });
  }

  out.push({
    intent: "solution",
    path: `/solutions/${signals.audienceSlug}`,
    title: `Add solution page for ${signals.audience}`,
    topic: signals.audience,
    impact: "high",
    evidence: `audience=${signals.audience}`,
    suggestedFix: `Create /solutions/${signals.audienceSlug} aimed at ${signals.audience}. Focus on workflow and outcomes, not a generic blog post.`,
    whyNotDuplicate: `No /solutions/${signals.audienceSlug} (or parent /solutions) route detected.`,
  });

  if (primary) {
    const compareSlug =
      signals.category === "developer-tool"
        ? "seo-mcp-tools"
        : `${primary.slug}-tools`;
    out.push({
      intent: "comparison",
      path: `/compare/${compareSlug}`,
      title: `Add comparison page: ${compareSlug.replace(/-/g, " ")}`,
      topic: primary.phrase,
      impact: "medium",
      evidence: primary.evidence,
      suggestedFix: `Create /compare/${compareSlug} with honest criteria for evaluating ${primary.phrase} tools. No unsourced competitor claims; use [verify] markers.`,
      whyNotDuplicate: `No comparison landing page for “${primary.phrase}” tools.`,
    });
  }

  const guidePhrase =
    secondary && !phraseAlreadyCovered(secondary.phrase, covered)
      ? secondary
      : primary && !phraseAlreadyCovered(`how to ${primary.phrase}`, covered)
        ? primary
        : undefined;
  if (guidePhrase) {
    const guideSlug =
      signals.category === "developer-tool" && /seo|next/i.test(guidePhrase.phrase)
        ? "nextjs-seo-audit"
        : guidePhrase.slug.startsWith("how-to-")
          ? guidePhrase.slug
          : `how-to-${guidePhrase.slug}`;
    // Skip if docs already cover the same core terms heavily
    if (!phraseAlreadyCovered(guidePhrase.phrase, covered)) {
      out.push({
        intent: "guide",
        path: `/guides/${guideSlug}`,
        title: `Add guide: ${guidePhrase.phrase}`,
        topic: guidePhrase.phrase,
        impact: "medium",
        evidence: guidePhrase.evidence,
        suggestedFix: `Create /guides/${guideSlug} as a practical how-to for “${guidePhrase.phrase}”. Prefer depth over volume; link back to product pages.`,
        whyNotDuplicate: `Existing docs/routes do not adequately cover “${guidePhrase.phrase}” as a dedicated guide.`,
      });
    }
  }

  if (signals.allowsCalculator && primary) {
    out.push({
      intent: "tool",
      path: `/tools/${primary.slug}-calculator`,
      title: `Add tool: ${primary.phrase} calculator`,
      topic: primary.phrase,
      impact: "medium",
      evidence: "calculator-signal",
      suggestedFix: `Create /tools/${primary.slug}-calculator only if the product genuinely supports that workflow. Do not invent metrics.`,
      whyNotDuplicate: `No calculator/tool route for “${primary.phrase}”.`,
    });
  } else if (
    secondary &&
    signals.category === "developer-tool" &&
    !phraseAlreadyCovered(secondary.phrase, covered)
  ) {
    out.push({
      intent: "feature",
      path: `/features/${secondary.slug}`,
      title: `Add feature page: ${secondary.phrase}`,
      topic: secondary.phrase,
      impact: "medium",
      evidence: secondary.evidence,
      suggestedFix: `Create /features/${secondary.slug} for the secondary capability “${secondary.phrase}”.`,
      whyNotDuplicate: `No feature page for “${secondary.phrase}”.`,
    });
  }

  return out;
}

function isIntentLanding(route: { path: string }): boolean {
  const p = route.path.toLowerCase();
  return (
    p.startsWith("/features") ||
    p.startsWith("/solutions") ||
    p.startsWith("/compare") ||
    p.startsWith("/tools") ||
    p.startsWith("/guides") ||
    p.startsWith("/use-cases")
  );
}

function rankChanges(changes: GrowChange[]): GrowChange[] {
  const impactRank: Record<Impact, number> = { high: 0, medium: 1, low: 2 };
  const confidenceRank: Record<Confidence, number> = {
    high: 0,
    medium: 1,
    low: 2,
  };
  const effortRank: Record<Effort, number> = { low: 0, medium: 1, high: 2 };
  const safetyRank: Record<FixSafety, number> = {
    auto: 0,
    approval: 1,
    manual: 2,
  };

  return [...changes].sort((a, b) => {
    // Indexability blocker first
    if (a.id === "robots-blocks-all") return -1;
    if (b.id === "robots-blocks-all") return 1;
    if (impactRank[a.expectedImpact] !== impactRank[b.expectedImpact]) {
      return impactRank[a.expectedImpact] - impactRank[b.expectedImpact];
    }
    if (confidenceRank[a.confidence] !== confidenceRank[b.confidence]) {
      return confidenceRank[a.confidence] - confidenceRank[b.confidence];
    }
    if (effortRank[a.effort] !== effortRank[b.effort]) {
      return effortRank[a.effort] - effortRank[b.effort];
    }
    if (safetyRank[a.fixSafety] !== safetyRank[b.fixSafety]) {
      return safetyRank[a.fixSafety] - safetyRank[b.fixSafety];
    }
    return a.id.localeCompare(b.id);
  });
}

function normalizePath(path: string): string {
  if (!path.startsWith("/")) return `/${path}`;
  if (path.length > 1 && path.endsWith("/")) return path.slice(0, -1);
  return path;
}

function pathExistsPrefix(existing: Set<string>, path: string): boolean {
  if (existing.has(path)) return true;
  // Treat /features as covering /features/foo for duplicate intent at parent
  const parts = path.split("/").filter(Boolean);
  if (parts.length >= 2) {
    const parent = `/${parts[0]}`;
    if (existing.has(parent)) return true;
  }
  return false;
}
