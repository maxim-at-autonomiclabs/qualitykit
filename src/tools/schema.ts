import { z } from "zod";
import type { FileSpec, Recommendation, SiteModel } from "../model/site.js";
import { scorePriority } from "../model/site.js";
import { appDirPrefix } from "../adapters/nextjs/parse.js";
import { errorResult, jsonResult, loadSite } from "./helpers.js";

export const schemaPlanInputSchema = {
  projectRoot: z
    .string()
    .describe("Absolute path to the website repository root"),
  siteUrl: z.string().url().optional(),
  includeBlogPosting: z.boolean().optional().default(true),
};

export async function schemaPlan(args: {
  projectRoot: string;
  siteUrl?: string;
  includeBlogPosting?: boolean;
}) {
  try {
    const site = loadSite(args.projectRoot, args.siteUrl);
    const recommendations = buildSchemaPlan(
      site,
      args.includeBlogPosting ?? true,
    );
    return jsonResult({
      ok: true,
      tool: "schema.plan",
      recommendations,
      notes: [
        "JSON-LD must match visible page content.",
        "Do not add FAQ schema sitewide.",
        "Schema does not guarantee AI citations.",
      ],
    });
  } catch (error) {
    return errorResult(error);
  }
}

export function buildSchemaPlan(
  site: SiteModel,
  includeBlogPosting: boolean,
): Recommendation[] {
  const recs: Recommendation[] = [];
  const origin =
    site.siteUrl ?? site.metadata.metadataBaseValue ?? "https://example.com";
  const name = site.business.name ?? site.packageName ?? "Organization";
  const description =
    site.business.description ??
    "Describe the organization accurately based on visible homepage copy.";
  const appPrefix = appDirPrefix(site.files);
  const layout = site.metadata.layoutFile ?? `${appPrefix}/layout.tsx`;

  const hasOrg = site.structuredData.types.some((t) =>
    /Organization|WebSite/i.test(t),
  );

  if (!hasOrg) {
    const jsonLd = {
      "@context": "https://schema.org",
      "@graph": [
        {
          "@type": "Organization",
          name,
          url: origin.replace(/\/$/, "") + "/",
          description,
        },
        {
          "@type": "WebSite",
          name,
          url: origin.replace(/\/$/, "") + "/",
          description,
          publisher: { "@type": "Organization", name },
        },
      ],
    };

    const snippet = `{
  "@context": "https://schema.org",
  "@graph": ${JSON.stringify(jsonLd["@graph"], null, 2)}
}`;

    const files: FileSpec[] = [
      {
        path: layout,
        kind: "edit",
        anchor: "return (",
        snippet: `      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(${JSON.stringify(jsonLd)}),
        }}
      />`,
        rationale:
          "Inject Organization + WebSite JSON-LD in the root layout body, matching visible brand info",
      },
      {
        path: "schema/organization-website.json",
        kind: "note",
        content: snippet,
        rationale: "Reference JSON-LD payload for validation",
      },
    ];

    recs.push({
      id: "schema-organization",
      title: "Add Organization and WebSite JSON-LD",
      category: "schema",
      severity: "medium",
      impact: 6,
      confidence: 0.8,
      effort: 3,
      risk: 2,
      priority: scorePriority(6, 0.8, 3, 2),
      evidence: site.structuredData.types.length
        ? site.structuredData.types
        : ["No Organization/WebSite types detected"],
      rationale:
        "Entity clarity helps search and answer engines understand the business. Keep fields consistent with visible content.",
      files,
    });
  }

  if (includeBlogPosting) {
    const hasBlogPosting = site.structuredData.types.some((t) =>
      /BlogPosting|Article/i.test(t),
    );
    if (!hasBlogPosting) {
      recs.push({
        id: "schema-blogposting",
        title: "Add BlogPosting + BreadcrumbList on posts",
        category: "schema",
        severity: "medium",
        impact: 7,
        confidence: 0.85,
        effort: 3,
        risk: 2,
        priority: scorePriority(7, 0.85, 3, 2),
        evidence: site.blog.present
          ? site.blog.routes
          : ["Will apply when blog posts exist"],
        rationale:
          "BlogPosting fields must mirror rendered title, description, dates, and author. Breadcrumbs aid navigation understanding.",
        files: [
          {
            path: `${appPrefix}/blog/[slug]/page.tsx`,
            kind: site.blog.present ? "edit" : "note",
            rationale:
              "Emit BlogPosting and BreadcrumbList JSON-LD from post frontmatter (see blog.scaffold template)",
            snippet: `"@type": "BlogPosting"`,
          },
        ],
      });
    }
  }

  return recs.sort((a, b) => b.priority - a.priority);
}
