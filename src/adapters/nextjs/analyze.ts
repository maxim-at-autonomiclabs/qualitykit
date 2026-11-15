import type {
  AnalyzeOptions,
  BlogSignals,
  BusinessHints,
  MetadataSignals,
  ProjectFile,
  RedirectSignals,
  RobotsSignals,
  SiteModel,
  SitemapSignals,
  StructuredDataSignals,
} from "../../model/site.js";
import { findFile } from "../../project/read.js";
import {
  AI_CRAWLERS,
  analyzeRobotsContent,
  appDirPrefix,
  buildRouteInfo,
  detectRouter,
  extractJsonLdTypes,
  extractMetadataBase,
  extractStringProp,
  extractTitleTemplate,
  parsePackageJson,
  tokenize,
} from "./parse.js";

export function analyzeNextjs(
  files: ProjectFile[],
  options: AnalyzeOptions = {},
  projectRoot = "",
): SiteModel {
  const pkg = parsePackageJson(files);
  const router = detectRouter(files);
  const appPrefix = appDirPrefix(files);

  const routes = files
    .map((f) => buildRouteInfo(f, router === "unknown" ? "app" : router, appPrefix))
    .filter((r): r is NonNullable<typeof r> => r !== null);

  const metadata = extractMetadata(files, appPrefix);
  const robots = extractRobots(files, appPrefix);
  const sitemap = extractSitemap(files, appPrefix);
  const redirects = extractRedirects(files);
  const structuredData = extractStructuredData(files);
  const blog = extractBlog(files, routes.map((r) => r.path));
  const business = extractBusinessHints(files, metadata, pkg.name);

  return {
    projectRoot,
    framework: "nextjs",
    frameworkConfidence: pkg.nextVersion ? 0.98 : 0.85,
    router,
    siteUrl: options.siteUrl ?? metadata.metadataBaseValue,
    packageName: pkg.name,
    nextVersion: pkg.nextVersion,
    routes,
    metadata,
    robots,
    sitemap,
    redirects,
    structuredData,
    blog,
    business,
    files,
  };
}

function extractMetadata(
  files: ProjectFile[],
  appPrefix: string,
): MetadataSignals {
  const layout =
    findFile(
      files,
      `${appPrefix}/layout.tsx`,
      `${appPrefix}/layout.ts`,
      `${appPrefix}/layout.jsx`,
      `${appPrefix}/layout.js`,
    ) ??
    files.find((f) => f.path.endsWith("/layout.tsx") && f.path.includes("app/"));

  if (!layout) {
    return {
      hasMetadataBase: false,
      hasTitleTemplate: false,
      hasRootTitle: false,
      hasRootDescription: false,
    };
  }

  const metadataBaseValue = extractMetadataBase(layout.content);
  const titleTemplate = extractTitleTemplate(layout.content);
  const rootTitle =
    extractStringProp(layout.content, "default") ??
    extractStringProp(layout.content, "title");
  const rootDescription = extractStringProp(layout.content, "description");

  return {
    hasMetadataBase: Boolean(metadataBaseValue) || /metadataBase\s*:/.test(layout.content),
    hasTitleTemplate: Boolean(titleTemplate),
    hasRootTitle: Boolean(rootTitle) || /title\s*:/.test(layout.content),
    hasRootDescription: Boolean(rootDescription),
    metadataBaseValue,
    titleTemplate,
    rootTitle,
    rootDescription,
    layoutFile: layout.path,
  };
}

function extractRobots(files: ProjectFile[], appPrefix: string): RobotsSignals {
  const robotsTs = findFile(
    files,
    `${appPrefix}/robots.ts`,
    `${appPrefix}/robots.js`,
  );
  const robotsTxt = findFile(
    files,
    `${appPrefix}/robots.txt`,
    "public/robots.txt",
    "robots.txt",
  );

  if (robotsTs) {
    const synthetic = robotsContentFromTs(robotsTs.content);
    const analyzed = analyzeRobotsContent(synthetic);
    return {
      present: true,
      source: "app/robots.ts",
      file: robotsTs.path,
      content: robotsTs.content,
      blocksAll: analyzed.blocksAll,
      aiCrawlers: analyzed.aiCrawlers,
    };
  }

  if (robotsTxt) {
    const analyzed = analyzeRobotsContent(robotsTxt.content);
    const source =
      robotsTxt.path === "public/robots.txt"
        ? "public/robots.txt"
        : robotsTxt.path.includes("app/")
          ? "app/robots.txt"
          : "public/robots.txt";
    return {
      present: true,
      source,
      file: robotsTxt.path,
      content: robotsTxt.content,
      blocksAll: analyzed.blocksAll,
      aiCrawlers: analyzed.aiCrawlers,
    };
  }

  return {
    present: false,
    aiCrawlers: AI_CRAWLERS.map((name) => ({
      name,
      status: "unknown" as const,
      evidence: "No robots.txt / robots.ts found",
    })),
  };
}

function robotsContentFromTs(source: string): string {
  // Best-effort: if the file returns MetadataRoute.Robots with disallow arrays
  if (/disallow\s*:\s*\[\s*["']\/["']\s*\]/.test(source)) {
    return "User-agent: *\nDisallow: /\n";
  }
  const rules: string[] = ["User-agent: *"];
  const disallowMatches = source.matchAll(/disallow\s*:\s*\[([^\]]*)\]/gi);
  for (const m of disallowMatches) {
    const paths = m[1].match(/["']([^"']+)["']/g) ?? [];
    for (const p of paths) {
      rules.push(`Disallow: ${p.replace(/['"]/g, "")}`);
    }
  }
  if (rules.length === 1) {
    rules.push("Allow: /");
  }
  // Detect named AI crawler blocks
  for (const bot of AI_CRAWLERS) {
    if (new RegExp(`userAgent\\s*:\\s*["']${bot}["']`, "i").test(source)) {
      const block = source.slice(
        source.toLowerCase().indexOf(bot.toLowerCase()),
      );
      if (/disallow\s*:\s*\[\s*["']\/["']\s*\]/.test(block.slice(0, 400))) {
        rules.push(`User-agent: ${bot}`, "Disallow: /");
      }
    }
  }
  return rules.join("\n");
}

function extractSitemap(
  files: ProjectFile[],
  appPrefix: string,
): SitemapSignals {
  const sitemapTs = findFile(
    files,
    `${appPrefix}/sitemap.ts`,
    `${appPrefix}/sitemap.js`,
    `${appPrefix}/sitemap.tsx`,
  );
  const sitemapXml = findFile(files, "public/sitemap.xml", "sitemap.xml");

  if (sitemapTs) {
    const routesHint = [
      ...sitemapTs.content.matchAll(/["'`](\/[^"'`]*)["'`]/g),
    ].map((m) => m[1]);
    return {
      present: true,
      source: "app/sitemap.ts",
      file: sitemapTs.path,
      routesHint: [...new Set(routesHint)],
    };
  }

  if (sitemapXml) {
    const routesHint = [
      ...sitemapXml.content.matchAll(/<loc>([^<]+)<\/loc>/g),
    ].map((m) => {
      try {
        return new URL(m[1]).pathname;
      } catch {
        return m[1];
      }
    });
    return {
      present: true,
      source: "public/sitemap.xml",
      file: sitemapXml.path,
      routesHint: [...new Set(routesHint)],
    };
  }

  return { present: false, routesHint: [] };
}

function extractRedirects(files: ProjectFile[]): RedirectSignals {
  const config = findFile(
    files,
    "next.config.ts",
    "next.config.js",
    "next.config.mjs",
    "next.config.cjs",
  );
  if (!config) {
    return { present: false, count: 0, snippets: [] };
  }
  const hasRedirects = /async\s+redirects\s*\(|redirects\s*:\s*async|redirects\s*\(/.test(
    config.content,
  );
  const snippets = [
    ...config.content.matchAll(/\{\s*source\s*:\s*["'`][^"'`]+["'`][\s\S]*?\}/g),
  ]
    .slice(0, 5)
    .map((m) => m[0].replace(/\s+/g, " ").slice(0, 160));

  return {
    present: hasRedirects || snippets.length > 0,
    file: config.path,
    count: snippets.length,
    snippets,
  };
}

function extractStructuredData(files: ProjectFile[]): StructuredDataSignals {
  const hits = files.filter(
    (f) =>
      f.content.includes("application/ld+json") ||
      f.content.includes("@type") ||
      f.content.includes("schema.org"),
  );
  const types = new Set<string>();
  for (const f of hits) {
    for (const t of extractJsonLdTypes(f.content)) types.add(t);
  }
  return {
    files: hits.map((f) => f.path),
    types: [...types],
  };
}

function extractBlog(
  files: ProjectFile[],
  routePaths: string[],
): BlogSignals {
  const blogRoutes = routePaths.filter(
    (p) => p === "/blog" || p.startsWith("/blog/"),
  );
  const contentPosts = files.filter(
    (f) =>
      /content\/blog\/.+\.(md|mdx)$/.test(f.path) ||
      /src\/content\/blog\/.+\.(md|mdx)$/.test(f.path) ||
      /app\/blog\/.+\/page\.(tsx|ts|mdx)$/.test(f.path) ||
      /src\/app\/blog\/.+\/page\.(tsx|ts|mdx)$/.test(f.path),
  );
  const contentDir = files.some((f) => f.path.startsWith("src/content/blog/"))
    ? "src/content/blog"
    : files.some((f) => f.path.startsWith("content/blog/"))
      ? "content/blog"
      : undefined;

  const present = blogRoutes.length > 0 || contentPosts.length > 0;
  return {
    present,
    routes: [...new Set(blogRoutes)],
    contentDir,
    postCount: contentPosts.filter((f) => /\.(md|mdx)$/.test(f.path)).length,
  };
}

function extractBusinessHints(
  files: ProjectFile[],
  metadata: MetadataSignals,
  packageName?: string,
): BusinessHints {
  const home =
    files.find((f) => /^(src\/)?app\/page\.(tsx|ts|jsx|js|mdx)$/.test(f.path)) ??
    files.find((f) => /^(src\/)?pages\/index\.(tsx|ts|jsx|js)$/.test(f.path));

  const textBits = [
    metadata.rootTitle,
    metadata.rootDescription,
    packageName,
    home?.content.slice(0, 4000),
  ];
  const blob = textBits.filter(Boolean).join(" ").toLowerCase();

  const topics: string[] = [];
  const titleTagline = metadata.rootTitle?.split(/\s+[—–|-]\s+/).slice(1).join(" — ").trim();
  if (titleTagline) topics.push(titleTagline);
  else if (metadata.rootTitle) topics.push(metadata.rootTitle);
  if (metadata.rootDescription) topics.push(metadata.rootDescription);

  // Keep a few useful tokens for pattern matching, but prefer phrases above
  for (const token of tokenize(...textBits).slice(0, 12)) {
    if (!topics.some((t) => t.toLowerCase().includes(token))) {
      topics.push(token);
    }
  }

  const audienceHints: string[] = [];
  if (/\b(mcp|next\.?js|developer|api|sdk|coding agent)\b/.test(blob)) {
    audienceHints.push("Next.js developers and coding agents");
  }
  if (/saas|software|platform|api|developer/.test(blob)) {
    audienceHints.push("software buyers / developers");
  }
  if (/agency|consult|service/.test(blob)) {
    audienceHints.push("service clients");
  }
  if (/shop|store|ecommerce/.test(blob)) {
    audienceHints.push("online shoppers");
  }
  if (audienceHints.length === 0) {
    audienceHints.push("general website visitors");
  }

  let confidence = 0.4;
  if (metadata.rootTitle) confidence += 0.2;
  if (metadata.rootDescription) confidence += 0.2;
  if (home) confidence += 0.1;
  if (packageName) confidence += 0.05;

  const brandName =
    metadata.rootTitle?.split(/\s+[—–|-]\s+/)[0]?.trim() ??
    packageName;

  return {
    name: brandName,
    description: metadata.rootDescription,
    audienceHints,
    topics: [...new Set(topics)].slice(0, 16),
    packageName,
    confidence: Math.min(confidence, 0.95),
  };
}
