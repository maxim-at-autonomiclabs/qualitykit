import type {
  AnalyzeOptions,
  BlogOptions,
  ProjectFile,
  Recommendation,
  RouteInfo,
  SiteModel,
} from "../model/site.js";
import { scorePriority } from "../model/site.js";
import type { FrameworkAdapter } from "./types.js";
import { parsePackageJson } from "./nextjs/parse.js";

function isHtmlPath(path: string): boolean {
  return /(^|\/)index\.html$|\.html$/i.test(path) && !path.includes("node_modules");
}

function htmlToRoute(path: string): string | null {
  const normalized = path.replace(/\\/g, "/");
  if (
    normalized.includes("node_modules") ||
    normalized.includes("/dist/") ||
    normalized.startsWith("dist/") ||
    /(^|\/)404\.html$/i.test(normalized) ||
    normalized.startsWith("public/")
  ) {
    // public/* is copied to site root by Vite; only treat real page HTML as routes
    return null;
  }

  if (/(^|\/)index\.html$/i.test(normalized)) {
    const dir = normalized.replace(/(^|\/)index\.html$/i, "").replace(/\/$/, "");
    return dir ? `/${dir}/` : "/";
  }
  if (/\.html$/i.test(normalized)) {
    return `/${normalized.replace(/\.html$/i, "")}`;
  }
  return null;
}

function extractMeta(html: string): {
  title?: string;
  description?: string;
  jsonLdTypes: string[];
  hasCanonical: boolean;
  headings: string[];
  h1Count: number;
  internalLinks: string[];
} {
  const title = html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]?.trim();
  const description =
    html.match(
      /<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i,
    )?.[1] ||
    html.match(
      /<meta[^>]+content=["']([^"']*)["'][^>]+name=["']description["']/i,
    )?.[1];
  const jsonLdTypes: string[] = [];
  const collectTypes = (node: unknown) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const item of node) collectTypes(item);
      return;
    }
    const obj = node as Record<string, unknown>;
    const t = obj["@type"];
    if (typeof t === "string") jsonLdTypes.push(t);
    if (Array.isArray(t)) {
      for (const x of t) if (typeof x === "string") jsonLdTypes.push(x);
    }
    if (obj["@graph"]) collectTypes(obj["@graph"]);
  };
  const scriptRe =
    /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = scriptRe.exec(html))) {
    try {
      collectTypes(JSON.parse(m[1]!));
    } catch {
      /* ignore invalid json-ld */
    }
  }
  const headings = [...html.matchAll(/<h([1-3])[^>]*>([\s\S]*?)<\/h\1>/gi)].map(
    (x) => x[2]!.replace(/<[^>]+>/g, "").trim(),
  );
  const h1Count = (html.match(/<h1\b/gi) ?? []).length;
  const internalLinks: string[] = [];
  for (const link of html.matchAll(/<a[^>]+href=["']([^"']+)["']/gi)) {
    const href = link[1]!;
    if (href.startsWith("/") || href.startsWith("#")) {
      const path = href.split("#")[0] || "/";
      if (path) internalLinks.push(path);
    }
  }
  return {
    title,
    description,
    jsonLdTypes,
    hasCanonical: /rel=["']canonical["']/i.test(html),
    headings,
    h1Count,
    internalLinks,
  };
}

export const genericAdapter: FrameworkAdapter = {
  id: "generic",
  detect(files: ProjectFile[]): number {
    const htmlCount = files.filter((f) => isHtmlPath(f.path)).length;
    const hasVite = files.some(
      (f) => f.path === "vite.config.js" || f.path === "vite.config.ts",
    );
    if (hasVite && htmlCount > 0) return 0.55;
    if (htmlCount >= 2) return 0.45;
    if (htmlCount === 1) return 0.35;
    return 0.1;
  },
  analyze(files: ProjectFile[], options: AnalyzeOptions): SiteModel {
    const pkg = parsePackageJson(files);
    const htmlFiles = files.filter((f) => isHtmlPath(f.path));
    const routeSet = new Map<string, RouteInfo>();
    const allJsonLdTypes: string[] = [];
    const jsonLdFiles: string[] = [];
    for (const f of htmlFiles) {
      const route = htmlToRoute(f.path);
      if (!route || routeSet.has(route)) continue;
      const pageMeta = extractMeta(f.content);
      if (pageMeta.jsonLdTypes.length) {
        allJsonLdTypes.push(...pageMeta.jsonLdTypes);
        jsonLdFiles.push(f.path);
      }
      routeSet.set(route, {
        path: route,
        kind: "page",
        file: f.path,
        title: pageMeta.title,
        description: pageMeta.description,
        hasMetadata: Boolean(pageMeta.title || pageMeta.description),
        hasCanonical: pageMeta.hasCanonical,
        headings: pageMeta.headings,
        h1Count: pageMeta.h1Count,
        imagesMissingAlt: 0,
        internalLinks: pageMeta.internalLinks,
      });
    }
    const routes = [...routeSet.values()].sort((a, b) =>
      a.path.localeCompare(b.path),
    );

    const indexHtml =
      htmlFiles.find((f) => /(^|\/)index\.html$/i.test(f.path) && !f.path.includes("dist/")) ??
      htmlFiles[0];
    const meta = indexHtml
      ? extractMeta(indexHtml.content)
      : {
          jsonLdTypes: [] as string[],
          hasCanonical: false,
          headings: [] as string[],
          h1Count: 0,
          internalLinks: [] as string[],
        };

    const robotsFile = files.find((f) => /(^|\/)robots\.txt$/i.test(f.path));
    const sitemapFile = files.find((f) => /sitemap/i.test(f.path));
    const hasStaticHtml = htmlFiles.length > 0;
    const pkgJson = files.find((f) => f.path === "package.json")?.content ?? "";
    const mentionsVite = /"vite"\s*:/.test(pkgJson);
    const isStaticSite =
      hasStaticHtml &&
      (files.some((f) => f.path.startsWith("vite.config.")) ||
        mentionsVite ||
        htmlFiles.length >= 1);

    return {
      projectRoot: "",
      framework: "generic",
      frameworkConfidence: isStaticSite ? 0.55 : 0.2,
      router: isStaticSite ? "static-html" : "unknown",
      siteUrl: options.siteUrl,
      packageName: pkg.name,
      routes,
      metadata: {
        hasMetadataBase: Boolean(options.siteUrl),
        hasTitleTemplate: false,
        hasRootTitle: Boolean(meta.title),
        hasRootDescription: Boolean(meta.description),
        metadataBaseValue: options.siteUrl,
        rootTitle: meta.title,
        rootDescription: meta.description,
        layoutFile: indexHtml?.path,
      },
      robots: {
        present: Boolean(robotsFile),
        file: robotsFile?.path,
        source: robotsFile ? "public/robots.txt" : undefined,
        blocksAll: Boolean(
          robotsFile?.content &&
            /user-agent:\s*\*[\s\S]*?disallow:\s*\/\s*$/im.test(robotsFile.content),
        ),
        aiCrawlers: [],
      },
      sitemap: {
        present: Boolean(sitemapFile),
        file: sitemapFile?.path,
        routesHint: routes.map((r) => r.path),
      },
      redirects: { present: false, count: 0, snippets: [] },
      structuredData: {
        files: [...new Set(jsonLdFiles)],
        types: [...new Set(allJsonLdTypes.length ? allJsonLdTypes : meta.jsonLdTypes)],
      },
      blog: { present: false, routes: [], postCount: 0 },
      business: {
        audienceHints: [],
        topics: meta.title ? [meta.title] : [],
        packageName: pkg.name,
        confidence: isStaticSite ? 0.45 : 0.2,
      },
      unsupportedReason: isStaticSite
        ? "Static HTML / Vite site: route inventory and basic SEO checks run; deep Next.js App Router analysis is limited."
        : "Unsupported stack for v1. QualityKit currently implements deep analysis for Next.js (App Router). Astro, Nuxt, and WordPress adapters are planned.",
      files,
    };
  },
  planTechnicalFixes(site: SiteModel): Recommendation[] {
    const recs: Recommendation[] = [];
    if (!site.robots.present) {
      recs.push({
        id: "static-robots",
        title: "Add public/robots.txt",
        category: "technical-seo",
        severity: "info",
        impact: 3,
        confidence: 0.9,
        effort: 5,
        risk: 1,
        priority: scorePriority(3, 0.9, 5, 1),
        evidence: ["No robots.txt found"],
        rationale:
          "For static sites, publish robots.txt with Sitemap pointing at /sitemap.xml.",
        files: [
          {
            path: "public/robots.txt",
            kind: "create",
            content: `User-agent: *\nAllow: /\n\nSitemap: ${site.siteUrl ?? "https://example.com"}/sitemap.xml\n`,
            rationale: "Allow indexing and publish sitemap URL",
          },
        ],
      });
    }
    if (!site.sitemap.present) {
      const urls = (site.routes.length ? site.routes : [{ path: "/" }])
        .map((r) => {
          const origin = (site.siteUrl ?? "https://example.com").replace(/\/$/, "");
          const path = r.path === "/" ? "/" : r.path;
          return `  <url><loc>${origin}${path}</loc></url>`;
        })
        .join("\n");
      recs.push({
        id: "static-sitemap",
        title: "Add public/sitemap.xml",
        category: "technical-seo",
        severity: "info",
        impact: 3,
        confidence: 0.9,
        effort: 5,
        risk: 1,
        priority: scorePriority(3, 0.9, 5, 1),
        evidence: [`routes=${site.routes.length}`],
        rationale: "List indexable static HTML routes in sitemap.xml.",
        files: [
          {
            path: "public/sitemap.xml",
            kind: "create",
            content: `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`,
            rationale: "Cover static HTML routes",
          },
        ],
      });
    }
    if (recs.length === 0) {
      recs.push({
        id: "unsupported-stack",
        title: "Framework not supported for deep Next.js fixes",
        category: "technical-seo",
        severity: "info",
        impact: 1,
        confidence: 1,
        effort: 1,
        risk: 1,
        priority: scorePriority(1, 1, 1, 1),
        evidence: [site.unsupportedReason ?? "generic adapter"],
        rationale:
          "Static HTML sites get robots/sitemap recommendations. Full App Router fix plans require Next.js.",
        files: [],
      });
    }
    return recs;
  },
  planBlog(site: SiteModel, _options: BlogOptions): Recommendation[] {
    return [
      {
        id: "blog-unsupported-stack",
        title: "Blog scaffolding requires Next.js App Router",
        category: "blog",
        severity: "info",
        impact: 1,
        confidence: 1,
        effort: 1,
        risk: 1,
        priority: scorePriority(1, 1, 1, 1),
        evidence: [site.framework, site.router ?? "unknown"],
        rationale: "Switch to a Next.js project to use blog.scaffold, or add HTML posts manually.",
        files: [],
      },
    ];
  },
};
