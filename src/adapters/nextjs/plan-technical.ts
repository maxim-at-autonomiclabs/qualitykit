import type { Recommendation, SiteModel } from "../../model/site.js";
import { scorePriority } from "../../model/site.js";
import { appDirPrefix } from "./parse.js";

export function planTechnicalFixes(site: SiteModel): Recommendation[] {
  const recs: Recommendation[] = [];
  const appPrefix = appDirPrefix(site.files);
  const origin = site.siteUrl ?? site.metadata.metadataBaseValue ?? "https://example.com";

  if (!site.robots.present) {
    const path = `${appPrefix}/robots.ts`;
    recs.push(
      makeRec({
        id: "tech-robots",
        title: "Add app/robots.ts",
        severity: "info",
        impact: 5,
        confidence: 0.95,
        effort: 2,
        risk: 1,
        evidence: ["No robots.ts or robots.txt found", "Next.js default allows crawlers"],
        rationale:
          "Explicit robots is useful for sitemap pointers and AI crawler policy — not automatically a crawl failure. Do not block AI crawlers without user approval.",
        files: [
          {
            path,
            kind: "create",
            content: robotsTsTemplate(origin),
            rationale: "Standard Next.js MetadataRoute.Robots allowing indexing",
          },
        ],
      }),
    );
  } else if (site.robots.blocksAll) {
    recs.push(
      makeRec({
        id: "tech-robots-blocks-all",
        title: "Robots currently blocks all crawlers",
        severity: "critical",
        impact: 10,
        confidence: 0.9,
        effort: 2,
        risk: 3,
        evidence: [
          site.robots.file ?? "robots",
          "User-agent * Disallow: / detected",
        ],
        rationale:
          "Sitewide Disallow: / prevents indexing. Confirm this is intentional (staging) before changing production crawl rules.",
        files: [
          {
            path: site.robots.file ?? `${appPrefix}/robots.ts`,
            kind: "note",
            rationale:
              "Review robots rules. If this is production, replace Disallow: / with Allow: /. Ask the user before changing AI crawler rules.",
          },
        ],
        requiresUserApproval: true,
      }),
    );
  }

  const disallowedAi = site.robots.aiCrawlers.filter(
    (c) => c.status === "disallowed",
  );
  if (disallowedAi.length > 0) {
    recs.push(
      makeRec({
        id: "tech-ai-crawlers",
        title: "AI crawlers are disallowed",
        severity: "medium",
        impact: 6,
        confidence: 0.85,
        effort: 2,
        risk: 2,
        evidence: disallowedAi.map(
          (c) => `${c.name}: ${c.evidence ?? "disallowed"}`,
        ),
        rationale:
          "Blocking AI crawlers reduces AEO visibility. Report the current policy and ask the user before allowing or keeping blocks.",
        files: [
          {
            path: site.robots.file ?? `${appPrefix}/robots.ts`,
            kind: "note",
            rationale:
              "Do not automatically remove AI crawler Disallow rules. Present the list and wait for user approval.",
          },
        ],
        requiresUserApproval: true,
      }),
    );
  }

  if (!site.sitemap.present) {
    const path = `${appPrefix}/sitemap.ts`;
    const staticPaths = [
      ...new Set(
        site.routes
          .filter((r) => r.kind === "page" && !r.path.includes(":"))
          .map((r) => r.path),
      ),
    ];
    const multiPage = staticPaths.length >= 2;
    recs.push(
      makeRec({
        id: "tech-sitemap",
        title: "Add app/sitemap.ts",
        severity: multiPage ? "medium" : "info",
        impact: multiPage ? 7 : 4,
        confidence: 0.95,
        effort: 3,
        risk: 1,
        evidence: ["No sitemap.ts or sitemap.xml found"],
        rationale:
          "A sitemap helps discovery of indexable routes. Extend it when a blog is added.",
        files: [
          {
            path,
            kind: "create",
            content: sitemapTsTemplate(origin, staticPaths),
            rationale: "MetadataRoute.Sitemap covering detected static routes",
          },
        ],
      }),
    );
  }

  if (!site.metadata.hasMetadataBase && site.metadata.layoutFile) {
    recs.push(
      makeRec({
        id: "tech-metadatabase",
        title: "Set metadataBase on root layout",
        severity: "medium",
        impact: 7,
        confidence: 0.9,
        effort: 2,
        risk: 2,
        evidence: [site.metadata.layoutFile, "metadataBase not detected"],
        rationale:
          "metadataBase makes Open Graph and canonical URLs resolve correctly in the App Router.",
        files: [
          {
            path: site.metadata.layoutFile,
            kind: "edit",
            anchor: "export const metadata",
            snippet: `metadataBase: new URL("${origin}"),`,
            rationale: `Insert metadataBase: new URL("${origin}") into the root metadata object`,
          },
        ],
      }),
    );
  } else if (!site.metadata.hasMetadataBase) {
    recs.push(
      makeRec({
        id: "tech-metadatabase-missing-layout",
        title: "Add root layout metadata with metadataBase",
        severity: "high",
        impact: 7,
        confidence: 0.8,
        effort: 3,
        risk: 2,
        evidence: ["No root layout metadataBase detected"],
        rationale: "Root layout should export Metadata including metadataBase.",
        files: [
          {
            path: `${appPrefix}/layout.tsx`,
            kind: "note",
            rationale: `Ensure root layout exports metadata with metadataBase: new URL("${origin}")`,
          },
        ],
      }),
    );
  }

  if (!site.metadata.hasTitleTemplate && site.metadata.layoutFile) {
    const brand = site.business.name ?? site.packageName ?? "Site";
    recs.push(
      makeRec({
        id: "tech-title-template",
        title: "Add title template",
        severity: "medium",
        impact: 5,
        confidence: 0.75,
        effort: 2,
        risk: 1,
        evidence: [site.metadata.layoutFile],
        rationale:
          "A title template keeps page titles consistent and brand-safe across routes.",
        files: [
          {
            path: site.metadata.layoutFile,
            kind: "edit",
            anchor: "title:",
            snippet: `title: {\n    default: "${brand}",\n    template: "%s | ${brand}",\n  },`,
            rationale: "Replace or extend title export with default + template",
          },
        ],
      }),
    );
  }

  if (!site.metadata.hasRootDescription) {
    recs.push(
      makeRec({
        id: "tech-root-description",
        title: "Add root meta description",
        severity: "medium",
        impact: 5,
        confidence: 0.8,
        effort: 2,
        risk: 1,
        evidence: [site.metadata.layoutFile ?? `${appPrefix}/layout.tsx`],
        rationale:
          "A clear root description improves SERP snippets and entity clarity for the homepage.",
        files: [
          {
            path: site.metadata.layoutFile ?? `${appPrefix}/layout.tsx`,
            kind: "edit",
            anchor: "export const metadata",
            snippet: `description: "${site.business.description ?? "Describe what this business offers and who it helps."}",`,
            rationale: "Add description to root metadata",
          },
        ],
      }),
    );
  }

  const pagesMissingCanonical = site.routes.filter(
    (r) => r.kind === "page" && !r.hasCanonical && r.path === "/",
  );
  if (pagesMissingCanonical.length > 0 && site.metadata.layoutFile) {
    recs.push(
      makeRec({
        id: "tech-canonical-home",
        title: "Add canonical for homepage",
        severity: "medium",
        impact: 6,
        confidence: 0.7,
        effort: 2,
        risk: 1,
        evidence: pagesMissingCanonical.map((p) => p.file),
        rationale:
          "Explicit homepage canonical reduces duplicate-URL ambiguity when query params or mirrors exist.",
        files: [
          {
            path: site.metadata.layoutFile,
            kind: "edit",
            anchor: "export const metadata",
            snippet: `alternates: {\n    canonical: "/",\n  },`,
            rationale: "Add alternates.canonical on root metadata",
          },
        ],
      }),
    );
  }

  const multiH1 = site.routes.filter((r) => r.kind === "page" && r.h1Count > 1);
  if (multiH1.length > 0) {
    recs.push(
      makeRec({
        id: "tech-multi-h1",
        title: "Multiple H1 headings on pages",
        severity: "low",
        impact: 3,
        confidence: 0.6,
        effort: 3,
        risk: 2,
        evidence: multiH1.slice(0, 5).map((p) => `${p.file} (h1=${p.h1Count})`),
        rationale:
          "Prefer a single clear H1 per page for answer extractability. Review and demote decorative headings.",
        files: multiH1.slice(0, 5).map((p) => ({
          path: p.file,
          kind: "note" as const,
          rationale: `Reduce to one primary H1 on ${p.path}`,
        })),
      }),
    );
  }

  const missingAlt = site.routes.filter((r) => r.imagesMissingAlt > 0);
  if (missingAlt.length > 0) {
    recs.push(
      makeRec({
        id: "tech-image-alt",
        title: "Images missing alt text",
        severity: "low",
        impact: 3,
        confidence: 0.7,
        effort: 4,
        risk: 1,
        evidence: missingAlt
          .slice(0, 5)
          .map((p) => `${p.file} (missing≈${p.imagesMissingAlt})`),
        rationale:
          "Descriptive alt text improves accessibility and image understanding for crawlers.",
        files: missingAlt.slice(0, 5).map((p) => ({
          path: p.file,
          kind: "note" as const,
          rationale: "Add meaningful alt attributes to Image/img tags",
        })),
      }),
    );
  }

  return sortRecs(recs);
}

function makeRec(
  input: Omit<Recommendation, "priority" | "category"> & {
    category?: Recommendation["category"];
  },
): Recommendation {
  return {
    ...input,
    category: input.category ?? "technical-seo",
    priority: scorePriority(
      input.impact,
      input.confidence,
      input.effort,
      input.risk,
    ),
  };
}

function sortRecs(recs: Recommendation[]): Recommendation[] {
  return [...recs].sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));
}

function robotsTsTemplate(origin: string): string {
  const sitemapUrl = origin.replace(/\/$/, "") + "/sitemap.xml";
  return `import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
    },
    sitemap: "${sitemapUrl}",
  };
}
`;
}

function sitemapTsTemplate(origin: string, paths: string[]): string {
  const base = origin.replace(/\/$/, "");
  const unique = paths.length > 0 ? paths : ["/"];
  const entries = unique
    .map(
      (p) => `    {
      url: "${base}${p === "/" ? "" : p}",
      lastModified: new Date(),
      changeFrequency: "weekly" as const,
      priority: ${p === "/" ? "1" : "0.7"},
    }`,
    )
    .join(",\n");

  return `import type { MetadataRoute } from "next";

export default function sitemap(): MetadataRoute.Sitemap {
  return [
${entries}
  ];
}
`;
}
