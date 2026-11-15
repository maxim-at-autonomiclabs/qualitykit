import { runAuditEngine, type EngineAuditResult } from "./audit-engine.js";
import {
  fetchRenderedPages,
  type FetchHtmlOptions,
  type RenderedPage,
} from "./fetch-html.js";
import { analyzeRobotsContent, AI_CRAWLERS } from "./robots.js";
import type { SiteModel } from "./site.js";
import type { CoverageMap, ReportEnvelope } from "./report.js";
import { wrapReport } from "./report.js";

const SITEMAP_CAP = 50;
const EXTRA_PATH_CAP = 8;

export interface LiveAuditOptions extends FetchHtmlOptions {
  projectName?: string;
  maxSitemapUrls?: number;
  maxExtraPaths?: number;
}

export interface LiveAuditResult {
  envelope: ReportEnvelope;
  audit: EngineAuditResult;
  pages: RenderedPage[];
  robotsText?: string;
  sitemapPaths: string[];
}

export async function runLiveAudit(
  siteUrl: string,
  options: LiveAuditOptions = {},
): Promise<LiveAuditResult> {
  const base = siteUrl.replace(/\/$/, "");
  const fetchImpl = options.fetchImpl ?? fetch;
  const maxSitemap = options.maxSitemapUrls ?? SITEMAP_CAP;
  const maxExtra = options.maxExtraPaths ?? EXTRA_PATH_CAP;

  const robotsText = await fetchText(`${base}/robots.txt`, fetchImpl);
  const sitemapXml = await fetchText(`${base}/sitemap.xml`, fetchImpl);
  const sitemapPaths = sitemapXml
    ? parseSitemapPaths(sitemapXml, maxSitemap)
    : [];

  const paths = [
    "/",
    ...sitemapPaths.filter((p) => p !== "/").slice(0, maxExtra),
  ];
  const pages = await fetchRenderedPages(base, {
    ...options,
    paths,
    fetchImpl,
  });

  const site = buildLiveSiteModel(base, robotsText, sitemapPaths, pages);
  const audit = runAuditEngine(site, pages);

  const coverage: CoverageMap = {
    source: "not_run",
    rendered: pages.some((p) => p.ok) ? "completed" : "not_run",
    live: pages.some((p) => p.ok) ? "completed" : "fail",
    searchData: "not_connected",
  };

  const envelope = wrapReport({
    project: options.projectName ?? new URL(base).hostname,
    mode: "live",
    coverage,
    findings: audit.findings.map((f) => ({
      ruleId: f.id,
      severity: f.severity === "critical" || f.severity === "high" ? "P1" : f.severity === "medium" ? "P2" : "P3",
      status: f.kind === "defect" ? "confirmed" : "needs_verification",
      confidence: f.confidence,
      affectedUrls: extractUrls(f.evidence, base),
      evidence: f.evidence,
      fixable: f.fixSafety === "auto" || f.fixSafety === "approval",
      requiresApproval: f.fixSafety !== "auto",
      title: f.title,
      kind: f.kind,
    })),
    summary: audit.summary,
  });

  return {
    envelope,
    audit,
    pages,
    robotsText: robotsText ?? undefined,
    sitemapPaths,
  };
}

function buildLiveSiteModel(
  siteUrl: string,
  robotsText: string | null,
  sitemapPaths: string[],
  pages: RenderedPage[],
): SiteModel {
  const home = pages.find((p) => p.path === "/" && p.ok);
  const robots = robotsText
    ? analyzeRobotsContent(robotsText)
    : {
        blocksAll: false,
        aiCrawlers: AI_CRAWLERS.map((name) => ({
          name,
          status: "unknown" as const,
          evidence: "robots.txt not fetched",
        })),
      };

  const routes = pages
    .filter((p) => p.ok)
    .map((p) => ({
      path: p.path,
      file: `live:${p.path}`,
      kind: "page" as const,
      title: p.title,
      description: p.description,
      hasMetadata: Boolean(p.title || p.description),
      hasCanonical: Boolean(p.canonical),
      headings: p.headings,
      h1Count: p.h1.length,
      imagesMissingAlt: 0,
      internalLinks: extractInternalHrefs(p.html ?? ""),
    }));

  const jsonTypes = new Set<string>();
  for (const page of pages) {
    for (const block of page.jsonLd) {
      const t = (block as { "@type"?: string })["@type"];
      if (typeof t === "string") jsonTypes.add(t);
      const graph = (block as { "@graph"?: Array<{ "@type"?: string }> })[
        "@graph"
      ];
      if (Array.isArray(graph)) {
        for (const node of graph) {
          if (typeof node["@type"] === "string") jsonTypes.add(node["@type"]);
        }
      }
    }
  }

  return {
    projectRoot: siteUrl,
    framework: "generic",
    frameworkConfidence: 0.4,
    router: "unknown",
    siteUrl,
    routes,
    metadata: {
      hasMetadataBase: true,
      hasTitleTemplate: false,
      hasRootTitle: Boolean(home?.title),
      hasRootDescription: Boolean(home?.description),
      rootTitle: home?.title,
      rootDescription: home?.description,
      metadataBaseValue: siteUrl,
    },
    robots: {
      present: Boolean(robotsText),
      content: robotsText ?? undefined,
      blocksAll: robots.blocksAll,
      aiCrawlers: robots.aiCrawlers,
      source: robotsText ? "public/robots.txt" : undefined,
      file: robotsText ? "robots.txt" : undefined,
    },
    sitemap: {
      present: sitemapPaths.length > 0,
      routesHint: sitemapPaths,
      source: sitemapPaths.length ? "public/sitemap.xml" : undefined,
      file: sitemapPaths.length ? "sitemap.xml" : undefined,
    },
    redirects: { present: false, count: 0, snippets: [] },
    structuredData: {
      files: pages.filter((p) => p.jsonLd.length).map((p) => `live:${p.path}`),
      types: [...jsonTypes],
    },
    blog: {
      present: sitemapPaths.some((p) => p.startsWith("/blog")),
      routes: sitemapPaths.filter((p) => p.startsWith("/blog")),
      postCount: sitemapPaths.filter((p) => /^\/blog\/.+/.test(p)).length,
    },
    business: {
      name: home?.title,
      description: home?.description,
      audienceHints: [],
      topics: [],
      confidence: home?.title ? 0.6 : 0.3,
    },
    files: [],
  };
}

async function fetchText(
  url: string,
  fetchImpl: typeof fetch,
): Promise<string | null> {
  try {
    const res = await fetchImpl(url, {
      redirect: "follow",
      headers: { "User-Agent": "QualityKitBot/0.3 (+https://qualitykit.dev)" },
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

function parseSitemapPaths(xml: string, cap: number): string[] {
  const paths: string[] = [];
  const re = /<loc>([^<]+)<\/loc>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) && paths.length < cap) {
    try {
      const u = new URL(m[1].trim());
      paths.push(u.pathname || "/");
    } catch {
      // skip
    }
  }
  return [...new Set(paths)];
}

function extractInternalHrefs(html: string): string[] {
  const links = new Set<string>();
  const re = /href=["'](\/[^"'#?]*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) links.add(m[1]);
  return [...links];
}

function extractUrls(evidence: string[], base: string): string[] {
  const urls: string[] = [];
  for (const e of evidence) {
    if (e.startsWith("http")) urls.push(e);
    else if (e.startsWith("/")) urls.push(`${base.replace(/\/$/, "")}${e}`);
  }
  return urls.length ? urls : ["/"];
}

export function diffRegressions(
  previousFindingIds: string[],
  current: EngineAuditResult,
): { newDefects: string[]; stillOpen: string[] } {
  const prev = new Set(previousFindingIds);
  const currentDefects = current.findings
    .filter((f) => f.kind === "defect")
    .map((f) => f.id);
  return {
    newDefects: currentDefects.filter((id) => !prev.has(id)),
    stillOpen: currentDefects.filter((id) => prev.has(id)),
  };
}
