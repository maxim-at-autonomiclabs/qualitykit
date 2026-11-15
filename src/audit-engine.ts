import {
  buildRouteInventory,
  sortFindings,
  summarizeFindings,
  type Finding,
  type RouteInventoryItem,
} from "./finding.js";
import type { SiteModel } from "./site.js";
import { stripFiles } from "./site.js";
import type { RenderedPage } from "./fetch-html.js";

export interface EngineAuditResult {
  site: Omit<SiteModel, "files">;
  routeInventory: RouteInventoryItem[];
  findings: Finding[];
  summary: ReturnType<typeof summarizeFindings>;
  rendered?: {
    fetched: boolean;
    pages: Array<{ url: string; ok: boolean; error?: string }>;
  };
}

export function buildAuditFindings(
  site: SiteModel,
  renderedPages: RenderedPage[] = [],
): Finding[] {
  const findings: Finding[] = [];
  const pageRoutes = site.routes.filter((r) => r.kind === "page");
  const staticPages = pageRoutes.filter((r) => !r.path.includes(":"));

  if (site.framework === "generic") {
    const staticHtml = site.router === "static-html" || site.routes.length > 0;
    findings.push({
      id: "unsupported-framework",
      kind: "opportunity",
      category: "technical-seo",
      severity: "info",
      title: staticHtml
        ? "Static HTML site — limited deep App Router analysis"
        : "Unsupported framework for deep audit",
      whyItMatters:
        site.unsupportedReason ??
        "Only Next.js receives full technical SEO analysis in this release.",
      evidence: staticHtml
        ? [`routes=${site.routes.length}`, `router=${site.router ?? "unknown"}`]
        : [],
      suggestedFix: staticHtml
        ? "Use public/robots.txt + public/sitemap.xml + JSON-LD in HTML. For blog scaffolding, use a Next.js App Router project."
        : "Point QualityKit at a Next.js App Router project.",
      expectedImpact: "low",
      confidence: "high",
      effort: staticHtml ? "low" : "high",
      fixSafety: "manual",
      verification: staticHtml
        ? "robots.txt and sitemap.xml present; routes inventoried"
        : "codebase.analyze reports framework=nextjs",
    });
  }

  if (site.robots.blocksAll) {
    findings.push({
      id: "robots-blocks-all",
      kind: "defect",
      category: "technical-seo",
      severity: "critical",
      title: "Robots disallows all paths",
      whyItMatters:
        "User-agent * Disallow: / prevents search and AI crawlers from indexing the site.",
      evidence: [site.robots.file ?? "robots", "Disallow: / detected"],
      suggestedFix:
        "If this is production, replace Disallow: / with Allow: /. Confirm staging intent first.",
      expectedImpact: "high",
      confidence: "high",
      effort: "low",
      fixSafety: "approval",
      verification: "robots no longer blocks all paths",
      relatedIds: ["tech-robots-blocks-all"],
    });
  } else if (!site.robots.present) {
    const staticHtml = site.router === "static-html";
    findings.push({
      id: "missing-robots",
      kind: "opportunity",
      category: "technical-seo",
      severity: "info",
      title: staticHtml
        ? "No robots.txt"
        : "No explicit robots.ts / robots.txt",
      whyItMatters: staticHtml
        ? "An explicit robots.txt publishes crawl policy and a sitemap URL for static hosts."
        : "Next.js defaults to allowing crawlers. An explicit robots file is useful to publish a sitemap URL and document AI crawler policy — not automatically a crawl failure.",
      evidence: ["No robots.ts or robots.txt found"],
      suggestedFix: staticHtml
        ? "Add public/robots.txt allowing / and pointing at /sitemap.xml."
        : "Add app/robots.ts allowing / and pointing at /sitemap.xml when you want an explicit policy.",
      expectedImpact: "medium",
      confidence: "high",
      effort: "low",
      fixSafety: "auto",
      verification: "robots file present and does not block all paths",
      relatedIds: ["tech-robots"],
    });
  }

  for (const crawler of site.robots.aiCrawlers) {
    if (crawler.status === "disallowed") {
      findings.push({
        id: `ai-crawler-${crawler.name}`,
        kind: "defect",
        category: "ai",
        severity: "medium",
        title: `${crawler.name} is disallowed`,
        whyItMatters:
          "Blocking this crawler may reduce AI search discoverability. Policy should be an explicit product decision.",
        evidence: [crawler.evidence ?? "disallowed", site.robots.file ?? "robots"],
        suggestedFix:
          "Ask the site owner before changing. Only remove Disallow if AI crawling is desired.",
        expectedImpact: "medium",
        confidence: "high",
        effort: "low",
        fixSafety: "approval",
        verification: `${crawler.name} is allowed or intentionally documented as blocked`,
        relatedIds: ["tech-ai-crawlers"],
      });
    }
  }

  if (!site.sitemap.present) {
    const multiPage = staticPages.length >= 2;
    findings.push({
      id: "missing-sitemap",
      kind: multiPage ? "defect" : "opportunity",
      category: "technical-seo",
      severity: multiPage ? "medium" : "info",
      title: "Missing sitemap",
      whyItMatters: multiPage
        ? "Multiple indexable routes without a sitemap can slow discovery of non-linked pages."
        : "A sitemap helps discovery as the site grows; a single discoverable homepage is less urgent.",
      evidence: [
        `staticPages=${staticPages.length}`,
        ...staticPages.map((p) => p.path),
      ],
      suggestedFix:
        site.router === "static-html"
          ? "Add public/sitemap.xml covering static indexable HTML routes."
          : "Add app/sitemap.ts covering static indexable routes (and blog posts when present).",
      expectedImpact: multiPage ? "medium" : "low",
      confidence: "high",
      effort: "low",
      fixSafety: "auto",
      verification: "sitemap present and lists key routes",
      relatedIds: ["tech-sitemap"],
    });
  }

  if (!site.metadata.hasMetadataBase && site.router === "app") {
    findings.push({
      id: "missing-metadatabase",
      kind: "defect",
      category: "metadata",
      severity: "medium",
      title: "metadataBase not set",
      whyItMatters:
        "Without metadataBase, App Router absolute Open Graph and canonical URLs can resolve incorrectly.",
      evidence: site.metadata.layoutFile
        ? [site.metadata.layoutFile]
        : ["No metadataBase detected"],
      suggestedFix: `Set metadataBase: new URL("${site.siteUrl ?? "https://example.com"}") on the root layout metadata export.`,
      expectedImpact: "medium",
      confidence: "high",
      effort: "low",
      fixSafety: "auto",
      verification: "Root layout exports metadataBase",
      relatedIds: ["tech-metadatabase", "missing-home-canonical"],
      rootCauseId: "missing-metadatabase",
    });
  }

  if (!site.metadata.hasRootTitle && site.router === "app") {
    findings.push({
      id: "missing-root-title",
      kind: "defect",
      category: "metadata",
      severity: "medium",
      title: "Root title missing",
      whyItMatters: "Search results and browser tabs lack a clear brand/title default.",
      evidence: site.metadata.layoutFile ? [site.metadata.layoutFile] : [],
      suggestedFix: "Export a default title (and optional template) from the root layout.",
      expectedImpact: "medium",
      confidence: "high",
      effort: "low",
      fixSafety: "auto",
      verification: "Root metadata includes title",
    });
  }

  if (!site.metadata.hasRootDescription && site.router === "app") {
    findings.push({
      id: "missing-root-description",
      kind: "defect",
      category: "metadata",
      severity: "medium",
      title: "Root description missing",
      whyItMatters:
        "A missing meta description weakens SERP snippets and entity clarity for the homepage.",
      evidence: site.metadata.layoutFile ? [site.metadata.layoutFile] : [],
      suggestedFix: "Add a concise business-focused description to root metadata.",
      expectedImpact: "medium",
      confidence: "high",
      effort: "low",
      fixSafety: "auto",
      verification: "Root metadata includes description",
      relatedIds: ["tech-root-description"],
    });
  }

  if (
    site.framework === "nextjs" &&
    !site.metadata.hasTitleTemplate &&
    site.metadata.hasRootTitle
  ) {
    findings.push({
      id: "missing-title-template",
      kind: "opportunity",
      category: "metadata",
      severity: "info",
      title: "Title template not set",
      whyItMatters:
        "A %s | Brand template keeps titles consistent; check rendered titles before treating this as urgent.",
      evidence: site.metadata.layoutFile ? [site.metadata.layoutFile] : [],
      suggestedFix: `Use title: { default: "...", template: "%s | Brand" } on the root layout.`,
      expectedImpact: "low",
      confidence: "medium",
      effort: "low",
      fixSafety: "auto",
      verification: "Title template present in root metadata",
      relatedIds: ["tech-title-template"],
    });
  }

  const home = pageRoutes.find((r) => r.path === "/");
  const layoutHasCanonical =
    Boolean(site.metadata.layoutFile) &&
    site.routes.some(
      (r) => r.file === site.metadata.layoutFile && r.hasCanonical,
    );
  // Prefer reading layout file content via site.files
  const layoutFile = site.files.find((f) => f.path === site.metadata.layoutFile);
  const layoutCanonical =
    layoutHasCanonical ||
    (layoutFile
      ? /alternates\s*:[\s\S]*canonical|canonical\s*:/.test(layoutFile.content)
      : false);

  if (home && !home.hasCanonical && !layoutCanonical) {
    const duplicateRisk = !site.metadata.hasMetadataBase;
    findings.push({
      id: "missing-home-canonical",
      kind: duplicateRisk ? "defect" : "opportunity",
      category: "metadata",
      severity: duplicateRisk ? "medium" : "info",
      title: "Homepage canonical not explicit",
      whyItMatters: duplicateRisk
        ? "No metadataBase and no explicit homepage canonical increases duplicate-URL ambiguity for absolute metadata."
        : "An explicit homepage canonical is helpful when query params or mirrors exist; confirm intended production URL first.",
      evidence: [home.file, ...(site.metadata.layoutFile ? [site.metadata.layoutFile] : [])],
      suggestedFix:
        "Add alternates.canonical for / after confirming the production origin.",
      expectedImpact: "medium",
      confidence: duplicateRisk ? "medium" : "low",
      effort: "low",
      fixSafety: "approval",
      verification: "Homepage or root layout declares canonical /",
      relatedIds: ["tech-canonical-home"],
      rootCauseId: duplicateRisk ? "missing-metadatabase" : undefined,
    });
  }

  for (const route of pageRoutes) {
    if (route.h1Count === 0) {
      findings.push({
        id: `heading-clarity-${route.path}`,
        kind: "opportunity",
        category: "content",
        severity: "info",
        title: `No clear H1 detected on ${route.path}`,
        whyItMatters:
          "A clear primary heading helps humans and answer engines understand the page topic. Exact H1 count is not a ranking rule.",
        evidence: [route.file, `h1Count=${route.h1Count}`],
        suggestedFix: "Ensure the main topic is expressed in a prominent heading.",
        expectedImpact: "low",
        confidence: "medium",
        effort: "low",
        fixSafety: "manual",
        verification: "Rendered page has a clear primary heading",
      });
    } else if (route.h1Count > 1) {
      findings.push({
        id: `heading-clarity-multi-${route.path}`,
        kind: "opportunity",
        category: "content",
        severity: "info",
        title: `Multiple H1-like headings on ${route.path}`,
        whyItMatters:
          "Several top-level headings can dilute the primary topic. Prefer clear hierarchy over a rigid single-H1 rule.",
        evidence: [route.file, `h1Count=${route.h1Count}`, ...route.headings.slice(0, 5)],
        suggestedFix: "Keep one primary topic heading; demote decorative headings.",
        expectedImpact: "low",
        confidence: "medium",
        effort: "medium",
        fixSafety: "manual",
        verification: "Heading hierarchy is clear on the rendered page",
        relatedIds: ["tech-multi-h1"],
      });
    }

    if (route.imagesMissingAlt > 0) {
      findings.push({
        id: `alt-${route.path}`,
        kind: "defect",
        category: "content",
        severity: "low",
        title: `Informative images may be missing alt on ${route.path}`,
        whyItMatters:
          "Missing alt harms accessibility and reduces image understanding for crawlers when the image conveys meaning.",
        evidence: [route.file, `imagesMissingAlt≈${route.imagesMissingAlt}`],
        suggestedFix:
          "Add meaningful alt text for informative images; use empty alt only for decorative images.",
        expectedImpact: "low",
        confidence: "medium",
        effort: "medium",
        fixSafety: "manual",
        verification: "Informative images have descriptive alt attributes",
        relatedIds: ["tech-image-alt"],
      });
    }
  }

  if (!site.blog.present && site.framework === "nextjs") {
    findings.push({
      id: "no-blog",
      kind: "opportunity",
      category: "content",
      severity: "info",
      title: "No blog architecture detected",
      whyItMatters:
        "A blog can help answer buyer questions and build topical coverage — only if content quality is high. Not a defect.",
      evidence: [`business=${site.business.name ?? "unknown"}`],
      suggestedFix:
        "If justified, use qualitykit.plan / blog.scaffold for App Router MDX architecture (approval required).",
      expectedImpact: "high",
      confidence: "medium",
      effort: "high",
      fixSafety: "approval",
      verification: "Blog routes exist with at least one verified article",
      relatedIds: ["blog-scaffold-mdx"],
    });
  }

  if (site.structuredData.types.length === 0) {
    findings.push({
      id: "no-jsonld",
      kind: "opportunity",
      category: "schema",
      severity: "info",
      title: "No structured data detected",
      whyItMatters:
        "Valid Organization/WebSite (and BlogPosting on articles) can improve machine understanding. Schema does not guarantee AI citations.",
      evidence: [],
      suggestedFix:
        "Add JSON-LD that mirrors visible brand/content via schema.plan — not sitewide FAQ spam.",
      expectedImpact: "medium",
      confidence: "medium",
      effort: "medium",
      fixSafety: "approval",
      verification: "JSON-LD parses and @type matches visible content",
      relatedIds: ["schema-organization", "schema-blogposting"],
    });
  }

  // Orphan-ish pages: pages with no inbound internal links from other pages
  const inbound = new Set<string>();
  for (const r of pageRoutes) {
    for (const href of r.internalLinks) inbound.add(href);
  }
  for (const r of pageRoutes) {
    if (r.path === "/") continue;
    if (!inbound.has(r.path) && !r.path.includes(":")) {
      findings.push({
        id: `orphan-${r.path}`,
        kind: "opportunity",
        category: "links",
        severity: "info",
        title: `Possible orphan page ${r.path}`,
        whyItMatters:
          "No inbound internal links were detected from other scanned pages; the page may be hard to discover.",
        evidence: [r.file, "No inbound links in scanned page sources"],
        suggestedFix: "Add a contextual internal link from a related page.",
        expectedImpact: "medium",
        confidence: "low",
        effort: "low",
        fixSafety: "manual",
        verification: "At least one relevant page links to this route",
      });
    }
  }

  if (site.router === "pages") {
    findings.push({
      id: "pages-router",
      kind: "opportunity",
      category: "technical-seo",
      severity: "info",
      title: "Pages Router detected",
      whyItMatters:
        "Audit depth is limited versus App Router. Blog scaffolding requires App Router in this release.",
      evidence: [],
      suggestedFix: "Use App Router for new SEO features, or apply Pages-specific metadata manually.",
      expectedImpact: "low",
      confidence: "high",
      effort: "high",
      fixSafety: "manual",
      verification: "N/A",
    });
  }

  // Optional llms.txt / FAQ schema notes — assessed, never required
  const hasLlms = site.files.some((f) => f.path === "public/llms.txt" || f.path === "llms.txt");
  if (!hasLlms) {
    findings.push({
      id: "llms-txt-optional",
      kind: "opportunity",
      category: "ai",
      severity: "info",
      title: "No llms.txt (optional)",
      whyItMatters:
        "llms.txt is optional documentation for AI agents. It is not a ranking requirement and does not guarantee citations.",
      evidence: ["llms.txt not found"],
      suggestedFix: "Only add if you want a human-maintained AI-oriented site summary — never as a trick.",
      expectedImpact: "low",
      confidence: "low",
      effort: "low",
      fixSafety: "manual",
      verification: "N/A — optional artifact",
    });
  }

  findings.push(...findingsFromRendered(site, renderedPages));

  return sortFindings(findings);
}

function findingsFromRendered(
  site: SiteModel,
  pages: RenderedPage[],
): Finding[] {
  const out: Finding[] = [];
  for (const page of pages) {
    if (!page.ok || !page.html) continue;

    if (site.metadata.rootTitle && page.title) {
      // soft mismatch check
      const root = site.metadata.rootTitle.toLowerCase();
      if (!page.title.toLowerCase().includes(root.split("|")[0].trim().slice(0, 12))) {
        out.push({
          id: `rendered-title-mismatch-${page.path}`,
          kind: "opportunity",
          category: "metadata",
          severity: "info",
          title: `Rendered title may diverge on ${page.path}`,
          whyItMatters:
            "Source metadata and live HTML titles should stay consistent for entity clarity.",
          evidence: [
            `sourceTitle≈${site.metadata.rootTitle}`,
            `renderedTitle=${page.title}`,
            page.url,
          ],
          suggestedFix: "Align generateMetadata/title exports with the intended rendered title.",
          expectedImpact: "low",
          confidence: "low",
          effort: "medium",
          fixSafety: "manual",
          verification: "Live title matches intended brand/page title",
        });
      }
    }

    if (!page.canonical && page.path === "/") {
      out.push({
        id: `rendered-missing-canonical-${page.path}`,
        kind: "opportunity",
        category: "metadata",
        severity: "info",
        title: "Rendered homepage has no canonical link",
        whyItMatters:
          "Confirm on the live page before treating source-only canonical plans as complete.",
        evidence: [page.url],
        suggestedFix: "Ensure metadata alternates.canonical appears in rendered HTML.",
        expectedImpact: "medium",
        confidence: "medium",
        effort: "low",
        fixSafety: "manual",
        verification: "link[rel=canonical] present on live homepage",
      });
    }

    if (page.jsonLd.length === 0 && site.structuredData.types.length > 0) {
      out.push({
        id: `rendered-jsonld-missing-${page.path}`,
        kind: "defect",
        category: "schema",
        severity: "medium",
        title: `Structured data in source but not in rendered HTML (${page.path})`,
        whyItMatters:
          "Crawlers and AI systems see rendered output; source-only schema does not help.",
        evidence: [page.url, ...site.structuredData.types],
        suggestedFix: "Ensure JSON-LD is emitted in the document body for this route.",
        expectedImpact: "medium",
        confidence: "high",
        effort: "medium",
        fixSafety: "manual",
        verification: "application/ld+json present in rendered HTML",
      });
    }
  }
  return out;
}

export function runAuditEngine(
  site: SiteModel,
  renderedPages: RenderedPage[] = [],
): EngineAuditResult {
  const findings = buildAuditFindings(site, renderedPages);
  return {
    site: stripFiles(site),
    routeInventory: buildRouteInventory(site.routes),
    findings,
    summary: summarizeFindings(findings),
    rendered: {
      fetched: renderedPages.length > 0,
      pages: renderedPages.map((p) => ({
        url: p.url,
        ok: p.ok,
        error: p.error,
      })),
    },
  };
}
