import { z } from "zod";
import type { SiteModel } from "../model/site.js";
import { extractJsonLdTypes } from "../adapters/nextjs/parse.js";
import { errorResult, jsonResult, loadSite } from "./helpers.js";

export const validateInputSchema = {
  projectRoot: z
    .string()
    .describe("Absolute path to the website repository root"),
  siteUrl: z.string().url().optional(),
  proposedFiles: z
    .array(
      z.object({
        path: z.string(),
        content: z.string(),
      }),
    )
    .optional()
    .describe("Optional proposed file contents to validate without writing"),
};

type Check = {
  id: string;
  ok: boolean;
  severity: "error" | "warning" | "info";
  message: string;
  path?: string;
};

export async function seoValidate(args: {
  projectRoot: string;
  siteUrl?: string;
  proposedFiles?: { path: string; content: string }[];
}) {
  try {
    const site = loadSite(args.projectRoot, args.siteUrl);
    const checks = [
      ...validateSite(site),
      ...validateProposed(args.proposedFiles ?? []),
    ];
    const errors = checks.filter((c) => !c.ok && c.severity === "error").length;
    const warnings = checks.filter(
      (c) => !c.ok && c.severity === "warning",
    ).length;

    return jsonResult({
      ok: errors === 0,
      tool: "seo.validate",
      summary: { errors, warnings, checks: checks.length },
      checks,
      notes: [
        "Read-only validation. Passing checks does not prove ranking impact.",
      ],
    });
  } catch (error) {
    return errorResult(error);
  }
}

export function validateSite(site: SiteModel): Check[] {
  const checks: Check[] = [];

  checks.push({
    id: "metadata-root-title",
    ok: site.metadata.hasRootTitle,
    severity: site.metadata.hasRootTitle ? "info" : "warning",
    message: site.metadata.hasRootTitle
      ? "Root title present"
      : "Root title missing",
    path: site.metadata.layoutFile,
  });

  checks.push({
    id: "metadata-base",
    ok: site.metadata.hasMetadataBase,
    severity: site.metadata.hasMetadataBase ? "info" : "warning",
    message: site.metadata.hasMetadataBase
      ? "metadataBase present"
      : "metadataBase missing",
    path: site.metadata.layoutFile,
  });

  checks.push({
    id: "robots-present",
    ok: site.robots.present,
    severity: site.robots.present ? "info" : "error",
    message: site.robots.present ? "Robots file present" : "Robots file missing",
    path: site.robots.file,
  });

  checks.push({
    id: "robots-not-blocking-all",
    ok: !site.robots.blocksAll,
    severity: site.robots.blocksAll ? "error" : "info",
    message: site.robots.blocksAll
      ? "Robots blocks all crawlers"
      : "Robots does not block all paths",
    path: site.robots.file,
  });

  checks.push({
    id: "sitemap-present",
    ok: site.sitemap.present,
    severity: site.sitemap.present ? "info" : "warning",
    message: site.sitemap.present ? "Sitemap present" : "Sitemap missing",
    path: site.sitemap.file,
  });

  if (site.blog.present) {
    const robotsContent = site.robots.content ?? "";
    const blocksBlog =
      /disallow\s*:\s*\/blog/i.test(robotsContent) ||
      (site.robots.blocksAll ?? false);
    checks.push({
      id: "robots-allows-blog",
      ok: !blocksBlog,
      severity: blocksBlog ? "error" : "info",
      message: blocksBlog
        ? "Robots appears to block /blog"
        : "Robots does not block /blog",
      path: site.robots.file,
    });

    if (site.sitemap.present) {
      const coversBlog =
        site.sitemap.routesHint.some((r) => r.includes("/blog")) ||
        /blog/i.test(
          site.files.find((f) => f.path === site.sitemap.file)?.content ?? "",
        );
      checks.push({
        id: "sitemap-includes-blog",
        ok: coversBlog,
        severity: coversBlog ? "info" : "warning",
        message: coversBlog
          ? "Sitemap references blog routes"
          : "Sitemap may not include blog routes",
        path: site.sitemap.file,
      });
    }
  }

  for (const route of site.routes.filter((r) => r.kind === "page")) {
    if (route.h1Count === 1) {
      checks.push({
        id: `h1-ok-${route.path}`,
        ok: true,
        severity: "info",
        message: `Single H1 on ${route.path}`,
        path: route.file,
      });
    } else if (route.h1Count === 0) {
      checks.push({
        id: `h1-missing-${route.path}`,
        ok: false,
        severity: "warning",
        message: `No H1 detected on ${route.path}`,
        path: route.file,
      });
    } else {
      checks.push({
        id: `h1-multi-${route.path}`,
        ok: false,
        severity: "warning",
        message: `Multiple H1s (${route.h1Count}) on ${route.path}`,
        path: route.file,
      });
    }
  }

  for (const file of site.structuredData.files) {
    const content = site.files.find((f) => f.path === file)?.content ?? "";
    const types = extractJsonLdTypes(content);
    const scriptBlocks = [
      ...content.matchAll(
        /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
      ),
    ];
    for (const [i, block] of scriptBlocks.entries()) {
      try {
        JSON.parse(block[1]);
        checks.push({
          id: `jsonld-parse-${file}-${i}`,
          ok: true,
          severity: "info",
          message: `JSON-LD parses in ${file}`,
          path: file,
        });
      } catch {
        checks.push({
          id: `jsonld-parse-${file}-${i}`,
          ok: false,
          severity: "error",
          message: `JSON-LD failed to parse in ${file}`,
          path: file,
        });
      }
    }
    if (types.length > 0 && scriptBlocks.length === 0) {
      checks.push({
        id: `jsonld-types-${file}`,
        ok: true,
        severity: "info",
        message: `Structured data types referenced: ${types.join(", ")}`,
        path: file,
      });
    }
  }

  return checks;
}

export function validateProposed(
  proposedFiles: { path: string; content: string }[],
): Check[] {
  const checks: Check[] = [];
  for (const file of proposedFiles) {
    if (/robots\.ts$/.test(file.path)) {
      checks.push({
        id: `proposed-robots-${file.path}`,
        ok: /MetadataRoute\.Robots|userAgent|allow/i.test(file.content),
        severity: "warning",
        message: "Proposed robots.ts looks like a robots route",
        path: file.path,
      });
    }
    if (/sitemap\.ts$/.test(file.path)) {
      checks.push({
        id: `proposed-sitemap-${file.path}`,
        ok: /MetadataRoute\.Sitemap|url\s*:/.test(file.content),
        severity: "warning",
        message: "Proposed sitemap.ts looks like a sitemap route",
        path: file.path,
      });
    }
    if (/\.mdx?$/.test(file.path) && /content\/blog\//.test(file.path)) {
      const required = ["title:", "description:", "date:", "author:"];
      const missing = required.filter((k) => !file.content.includes(k));
      checks.push({
        id: `proposed-frontmatter-${file.path}`,
        ok: missing.length === 0,
        severity: missing.length ? "error" : "info",
        message:
          missing.length === 0
            ? "Blog frontmatter includes required fields"
            : `Missing frontmatter fields: ${missing.join(", ")}`,
        path: file.path,
      });
    }

    const scriptBlocks = [
      ...file.content.matchAll(
        /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
      ),
    ];
    for (const [i, block] of scriptBlocks.entries()) {
      try {
        const parsed = JSON.parse(block[1]);
        const type = parsed["@type"] ?? parsed["@graph"]?.[0]?.["@type"];
        checks.push({
          id: `proposed-jsonld-${file.path}-${i}`,
          ok: true,
          severity: "info",
          message: `Proposed JSON-LD parses (${type ?? "unknown type"})`,
          path: file.path,
        });
      } catch {
        // Might be a JSX expression rather than literal JSON
        if (/JSON\.stringify/.test(file.content)) {
          checks.push({
            id: `proposed-jsonld-${file.path}-${i}`,
            ok: true,
            severity: "info",
            message: "Proposed file builds JSON-LD via JSON.stringify",
            path: file.path,
          });
        } else {
          checks.push({
            id: `proposed-jsonld-${file.path}-${i}`,
            ok: false,
            severity: "error",
            message: "Proposed JSON-LD block did not parse",
            path: file.path,
          });
        }
      }
    }

    if (
      /"@type"\s*:/.test(file.content) ||
      /@type:\s*["']/.test(file.content)
    ) {
      const types = extractJsonLdTypes(file.content);
      if (types.length > 0) {
        checks.push({
          id: `proposed-schema-types-${file.path}`,
          ok: true,
          severity: "info",
          message: `Schema types: ${types.join(", ")}`,
          path: file.path,
        });
      }
    }
  }
  return checks;
}
