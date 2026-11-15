import type {
  AnalyzeOptions,
  BlogOptions,
  ProjectFile,
  Recommendation,
  SiteModel,
} from "../model/site.js";
import { scorePriority } from "../model/site.js";
import type { FrameworkAdapter } from "./types.js";
import { parsePackageJson } from "./nextjs/parse.js";

export const genericAdapter: FrameworkAdapter = {
  id: "generic",
  detect(_files: ProjectFile[]): number {
    return 0.1;
  },
  analyze(files: ProjectFile[], options: AnalyzeOptions): SiteModel {
    const pkg = parsePackageJson(files);
    return {
      projectRoot: "",
      framework: "generic",
      frameworkConfidence: 0.2,
      router: "unknown",
      siteUrl: options.siteUrl,
      packageName: pkg.name,
      routes: [],
      metadata: {
        hasMetadataBase: false,
        hasTitleTemplate: false,
        hasRootTitle: false,
        hasRootDescription: false,
      },
      robots: {
        present: files.some((f) => f.path.endsWith("robots.txt")),
        aiCrawlers: [],
      },
      sitemap: {
        present: files.some((f) => /sitemap/i.test(f.path)),
        routesHint: [],
      },
      redirects: { present: false, count: 0, snippets: [] },
      structuredData: { files: [], types: [] },
      blog: { present: false, routes: [], postCount: 0 },
      business: {
        audienceHints: [],
        topics: [],
        packageName: pkg.name,
        confidence: 0.2,
      },
      unsupportedReason:
        "Unsupported stack for v1. QualityKit currently implements deep analysis for Next.js (App Router). Astro, Nuxt, and WordPress adapters are planned.",
      files,
    };
  },
  planTechnicalFixes(site: SiteModel): Recommendation[] {
    return [
      {
        id: "unsupported-stack",
        title: "Framework not supported in v1",
        category: "technical-seo",
        severity: "info",
        impact: 1,
        confidence: 1,
        effort: 1,
        risk: 1,
        priority: scorePriority(1, 1, 1, 1),
        evidence: [site.unsupportedReason ?? "generic adapter"],
        rationale:
          "Use a Next.js App Router project, or wait for a dedicated adapter. Manual SEO audit still applies outside this MCP.",
        files: [],
      },
    ];
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
        evidence: [site.framework],
        rationale: "Switch to a Next.js project to use blog.scaffold.",
        files: [],
      },
    ];
  },
};
