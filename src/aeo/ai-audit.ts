import { sortFindings, type Finding } from "../model/finding.js";
import type { SiteModel } from "../model/site.js";
import type { RenderedPage } from "../integrations/fetch-html.js";

export interface AiAuditScores {
  crawlability: number;
  extractability: number;
  entityClarity: number;
  citationReadiness: number;
  structuredUnderstanding: number;
  topicalCoverage: number;
}

export interface AiAuditResult {
  scores: AiAuditScores;
  findings: Finding[];
  evidence: Record<keyof AiAuditScores, string[]>;
  caveats: string[];
}

export function runAiAudit(
  site: SiteModel,
  renderedPages: RenderedPage[] = [],
): AiAuditResult {
  const evidence: Record<keyof AiAuditScores, string[]> = {
    crawlability: [],
    extractability: [],
    entityClarity: [],
    citationReadiness: [],
    structuredUnderstanding: [],
    topicalCoverage: [],
  };
  const findings: Finding[] = [];

  const crawlability = scoreCrawlability(site, evidence.crawlability);
  const extractability = scoreExtractability(
    site,
    renderedPages,
    evidence.extractability,
    findings,
  );
  const entityClarity = scoreEntityClarity(
    site,
    renderedPages,
    evidence.entityClarity,
    findings,
  );
  const citationReadiness = scoreCitation(
    site,
    evidence.citationReadiness,
    findings,
  );
  const structuredUnderstanding = scoreStructured(
    site,
    renderedPages,
    evidence.structuredUnderstanding,
    findings,
  );
  const topicalCoverage = scoreTopical(
    site,
    evidence.topicalCoverage,
    findings,
  );

  return {
    scores: {
      crawlability,
      extractability,
      entityClarity,
      citationReadiness,
      structuredUnderstanding,
      topicalCoverage,
    },
    findings: sortFindings(findings),
    evidence,
    caveats: [
      "Scores are deterministic heuristics from local source" +
        (renderedPages.length ? " plus optional rendered HTML" : " only") +
        ".",
      "They do not predict rankings or AI citations.",
      "FAQ schema and llms.txt are optional assessments — never required for a passing score.",
    ],
  };
}

function clampScore(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)));
}

function scoreCrawlability(site: SiteModel, evidence: string[]): number {
  let score = 70;
  if (site.robots.blocksAll) {
    score -= 50;
    evidence.push("Robots blocks all paths");
  } else if (!site.robots.present) {
    score -= 5;
    evidence.push("No explicit robots file (Next default allow assumed)");
  } else {
    score += 10;
    evidence.push("Robots file present and not blocking all");
  }

  const disallowed = site.robots.aiCrawlers.filter((c) => c.status === "disallowed");
  if (disallowed.length) {
    score -= Math.min(25, disallowed.length * 5);
    evidence.push(`AI crawlers disallowed: ${disallowed.map((c) => c.name).join(", ")}`);
  } else if (site.robots.present) {
    score += 5;
    evidence.push("No AI crawler Disallow detected");
  }

  if (site.sitemap.present) {
    score += 10;
    evidence.push("Sitemap present");
  } else {
    score -= 10;
    evidence.push("Sitemap missing");
  }

  const pages = site.routes.filter((r) => r.kind === "page").length;
  evidence.push(`pageRoutes=${pages}`);
  if (pages === 0) score -= 20;
  else if (pages >= 2) score += 5;

  return clampScore(score);
}

function scoreExtractability(
  site: SiteModel,
  rendered: RenderedPage[],
  evidence: string[],
  findings: Finding[],
): number {
  let score = 45;
  const home =
    site.routes.find((r) => r.path === "/" && r.kind === "page") ??
    site.routes.find((r) => r.path === "/");
  const homeFile = home
    ? site.files.find((f) => f.path === home.file)
    : undefined;
  const source = homeFile?.content ?? "";
  const renderedHome = rendered.find((p) => p.path === "/" && p.ok);

  const headings = renderedHome?.headings?.length
    ? renderedHome.headings
    : home?.headings ?? [];
  evidence.push(`headings=${headings.length}`);
  if (headings.length >= 1) score += 15;
  else score -= 15;

  const text = (renderedHome?.html ?? source).slice(0, 3500);
  const hasDefinition =
    /\b(is a|are a|helps|platform|product|service|for teams|saas)\b/i.test(text);
  if (hasDefinition) {
    score += 20;
    evidence.push("Product/definition language detected near top of homepage");
  } else {
    score -= 10;
    evidence.push("Weak product definition / answer lead on homepage");
    findings.push({
      id: "ai-extractability-definition",
      kind: "opportunity",
      category: "ai",
      severity: "info",
      title: "Clarify the product definition above the fold",
      whyItMatters:
        "AI systems extract better when the page leads with a clear, self-contained statement of what the product is and who it is for.",
      evidence,
      suggestedFix:
        "Add a short answer-style intro: what it is, who it's for, and the primary outcome.",
      expectedImpact: "high",
      confidence: "medium",
      effort: "medium",
      fixSafety: "manual",
      verification: "Homepage opens with a clear 2–4 sentence product definition",
    });
  }

  const answerish =
    (text.match(/<p\b[^>]*>[\s\S]{40,280}<\/p>/gi) ?? []).length >= 1 ||
    /##\s+/.test(source);
  if (answerish) {
    score += 10;
    evidence.push("Paragraph or section structure suitable for extraction");
  } else {
    findings.push({
      id: "ai-extractability-answers",
      kind: "opportunity",
      category: "ai",
      severity: "info",
      title: "Add answer-focused sections for target questions",
      whyItMatters:
        "Self-contained headings and short factual answers improve extractability for AI search.",
      evidence: ["Limited answer-shaped content detected"],
      suggestedFix:
        "Add H2s that mirror real questions and answer them in the first paragraph under each.",
      expectedImpact: "high",
      confidence: "medium",
      effort: "medium",
      fixSafety: "manual",
      verification: "Key pages include question-aligned headings with direct answers",
    });
  }

  return clampScore(score);
}

function scoreEntityClarity(
  site: SiteModel,
  rendered: RenderedPage[],
  evidence: string[],
  findings: Finding[],
): number {
  let score = 40;
  if (site.business.name) {
    score += 15;
    evidence.push(`name=${site.business.name}`);
  } else {
    evidence.push("Business name unclear");
  }
  if (site.business.description) {
    score += 15;
    evidence.push(`description=${site.business.description.slice(0, 80)}`);
  }
  if (site.business.audienceHints.length) {
    score += 10;
    evidence.push(`audience=${site.business.audienceHints.join("; ")}`);
  }
  if (site.metadata.hasRootTitle && site.metadata.hasRootDescription) {
    score += 10;
    evidence.push("Root title+description present");
  }

  const orgTypes = site.structuredData.types.filter((t) =>
    /Organization|WebSite|SoftwareApplication|Product/i.test(t),
  );
  if (orgTypes.length) {
    score += 10;
    evidence.push(`schema=${orgTypes.join(",")}`);
  } else {
    findings.push({
      id: "ai-entity-schema",
      kind: "opportunity",
      category: "ai",
      severity: "info",
      title: "Strengthen entity clarity with consistent brand + schema",
      whyItMatters:
        "Systems identify the company more reliably when name, description, and Organization/WebSite markup agree with visible copy.",
      evidence: ["No Organization/WebSite/Product schema types detected"],
      suggestedFix:
        "Add Organization/WebSite JSON-LD matching visible brand fields (schema.plan).",
      expectedImpact: "medium",
      confidence: "medium",
      effort: "medium",
      fixSafety: "approval",
      verification: "JSON-LD name/description match homepage copy",
    });
  }

  const homeRendered = rendered.find((p) => p.path === "/" && p.ok);
  if (
    homeRendered?.title &&
    site.business.name &&
    !homeRendered.title.toLowerCase().includes(site.business.name.toLowerCase().slice(0, 8))
  ) {
    score -= 10;
    evidence.push(
      `Rendered title "${homeRendered.title}" weak match to brand "${site.business.name}"`,
    );
  }

  if (site.business.confidence < 0.5) {
    score -= 15;
    evidence.push(`businessConfidence=${site.business.confidence}`);
  }

  return clampScore(score);
}

function scoreCitation(
  site: SiteModel,
  evidence: string[],
  findings: Finding[],
): number {
  let score = 35;
  const mdx = site.files.filter((f) => /\.(md|mdx)$/.test(f.path));
  const withAuthor = mdx.filter((f) => /author\s*:/.test(f.content));
  const withDate = mdx.filter((f) => /date\s*:/.test(f.content));
  const withVerify = mdx.filter((f) => f.content.includes("[verify]"));

  evidence.push(`contentFiles=${mdx.length}`);
  if (withAuthor.length) {
    score += 15;
    evidence.push(`postsWithAuthor=${withAuthor.length}`);
  }
  if (withDate.length) {
    score += 10;
    evidence.push(`postsWithDate=${withDate.length}`);
  }
  if (withVerify.length) {
    score -= 20;
    evidence.push(`unverifiedMarkers=${withVerify.length}`);
    findings.push({
      id: "ai-citation-verify-markers",
      kind: "defect",
      category: "ai",
      severity: "medium",
      title: "Unverified [verify] markers in content",
      whyItMatters:
        "Publishing unverified claims undermines citation readiness and trust.",
      evidence: withVerify.slice(0, 5).map((f) => f.path),
      suggestedFix: "Resolve or remove every [verify] marker before publishing.",
      expectedImpact: "high",
      confidence: "high",
      effort: "medium",
      fixSafety: "manual",
      verification: "No [verify] markers remain in published content",
    });
  }

  const thinPages = site.routes.filter(
    (r) => r.kind === "page" && r.headings.length <= 1,
  );
  if (thinPages.length && !site.blog.present) {
    score -= 10;
    evidence.push(`possiblyThinPages=${thinPages.length}`);
  }

  if (!site.blog.present && mdx.length === 0) {
    evidence.push("No dated/authored articles detected");
    findings.push({
      id: "ai-citation-evidence",
      kind: "opportunity",
      category: "ai",
      severity: "info",
      title: "Strengthen verifiable product claims and supporting evidence",
      whyItMatters:
        "Citation-worthy pages include original explanations, named sources, authors, and dates — not generic filler.",
      evidence,
      suggestedFix:
        "Publish a small number of sourced guides with author, date, and evidence — avoid mass AI articles.",
      expectedImpact: "high",
      confidence: "medium",
      effort: "high",
      fixSafety: "approval",
      verification: "At least one verified article with author/date and sourced claims",
    });
  } else {
    score += 15;
  }

  return clampScore(score);
}

function scoreStructured(
  site: SiteModel,
  rendered: RenderedPage[],
  evidence: string[],
  findings: Finding[],
): number {
  let score = 40;
  if (site.structuredData.types.length) {
    score += 25;
    evidence.push(`types=${site.structuredData.types.join(",")}`);
  } else {
    evidence.push("No JSON-LD types in source");
    findings.push({
      id: "ai-structured-data",
      kind: "opportunity",
      category: "schema",
      severity: "info",
      title: "Add relevant, valid structured data",
      whyItMatters:
        "Valid JSON-LD that matches visible content aids machine understanding. It does not guarantee citations.",
      evidence,
      suggestedFix: "Implement Organization/WebSite and BlogPosting where content exists.",
      expectedImpact: "medium",
      confidence: "medium",
      effort: "medium",
      fixSafety: "approval",
      verification: "JSON-LD parses; @type matches visible entities",
    });
  }

  const renderedLd = rendered.flatMap((p) => p.jsonLd);
  if (rendered.length && renderedLd.length) {
    score += 15;
    evidence.push(`renderedJsonLdBlocks=${renderedLd.length}`);
  } else if (rendered.length && site.structuredData.types.length) {
    score -= 15;
    evidence.push("Source schema present but not observed in rendered HTML");
  }

  const hasFaq = site.structuredData.types.some((t) => /FAQPage/i.test(t));
  if (hasFaq) {
    evidence.push("FAQPage schema present — ensure it mirrors visible FAQs only");
  }

  const hasLlms = site.files.some(
    (f) => f.path === "llms.txt" || f.path === "public/llms.txt",
  );
  evidence.push(hasLlms ? "llms.txt present (optional)" : "llms.txt absent (optional)");

  return clampScore(score);
}

function scoreTopical(
  site: SiteModel,
  evidence: string[],
  findings: Finding[],
): number {
  let score = 50;
  const paths = site.routes.map((r) => r.path.toLowerCase());
  const checks: Array<{ id: string; label: string; test: (p: string) => boolean }> = [
    { id: "comparison", label: "comparison/alternative page", test: (p) => /compar|vs|alternativ/.test(p) },
    { id: "use-case", label: "use-case page", test: (p) => /use-case|usecase|solutions|for-/.test(p) },
    { id: "docs", label: "docs/guide page", test: (p) => /docs|guide|learn|blog|help/.test(p) },
    { id: "pricing", label: "pricing page", test: (p) => /pricing|plans/.test(p) },
    { id: "faq", label: "faq page", test: (p) => /faq/.test(p) },
  ];

  let hits = 0;
  const missing: string[] = [];
  for (const c of checks) {
    if (paths.some(c.test)) {
      hits += 1;
      evidence.push(`has:${c.label}`);
    } else {
      missing.push(c.label);
      evidence.push(`missing:${c.label}`);
    }
  }
  score = 30 + hits * 12;

  if (missing.length) {
    findings.push({
      id: "ai-topical-coverage",
      kind: "opportunity",
      category: "content",
      severity: "info",
      title: "Expand topical coverage for AI and search discoverability",
      whyItMatters:
        "Missing comparison, use-case, educational, or FAQ pages leaves common buyer questions unanswered.",
      evidence: missing.map((m) => `missing ${m}`),
      suggestedFix:
        "Prioritize a few high-intent pages from qualitykit.plan / content.brief — quality over volume.",
      expectedImpact: "high",
      confidence: "medium",
      effort: "high",
      fixSafety: "approval",
      verification: "New pages address real audience questions without thin overlap",
    });
  }

  if (site.business.topics.length) {
    evidence.push(`topics=${site.business.topics.slice(0, 8).join(",")}`);
  }

  return clampScore(score);
}
