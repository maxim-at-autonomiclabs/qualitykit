import { z } from "zod";
import type { LinkSuggestion, SiteModel } from "../model/site.js";
import { tokenize } from "../adapters/nextjs/parse.js";
import { errorResult, jsonResult, loadSite } from "./helpers.js";

export const linksPlanInputSchema = {
  projectRoot: z
    .string()
    .describe("Absolute path to the website repository root"),
  siteUrl: z.string().url().optional(),
  proposedPaths: z
    .array(z.string())
    .optional()
    .describe("Optional proposed routes such as /blog/understanding-x"),
  maxSuggestions: z.number().int().min(1).max(50).optional().default(15),
};

export async function linksPlan(args: {
  projectRoot: string;
  siteUrl?: string;
  proposedPaths?: string[];
  maxSuggestions?: number;
}) {
  try {
    const site = loadSite(args.projectRoot, args.siteUrl);
    const suggestions = buildLinkSuggestions(
      site,
      args.proposedPaths ?? [],
      args.maxSuggestions ?? 15,
    );
    return jsonResult({
      ok: true,
      tool: "links.plan",
      suggestionCount: suggestions.length,
      suggestions,
      notes: [
        "Contextual suggestions only — no mass rewrites.",
        "Apply links where they help readers; avoid forced keyword anchors.",
      ],
    });
  } catch (error) {
    return errorResult(error);
  }
}

export function buildLinkSuggestions(
  site: SiteModel,
  proposedPaths: string[],
  maxSuggestions: number,
): LinkSuggestion[] {
  const pages = site.routes.filter((r) => r.kind === "page");
  const targets: { href: string; terms: string[]; label: string }[] = [];

  for (const page of pages) {
    targets.push({
      href: page.path,
      label: page.title ?? page.path,
      terms: tokenize(
        page.title,
        page.description,
        ...page.headings,
        page.path,
      ),
    });
  }

  for (const href of proposedPaths) {
    targets.push({
      href,
      label: href,
      terms: tokenize(href),
    });
  }

  if (site.blog.present) {
    targets.push({
      href: "/blog",
      label: "Blog",
      terms: tokenize("blog", "articles", "guides", ...site.business.topics),
    });
  } else if (proposedPaths.some((p) => p.startsWith("/blog"))) {
    targets.push({
      href: "/blog",
      label: "Blog",
      terms: tokenize("blog", "guides", ...site.business.topics),
    });
  }

  const suggestions: LinkSuggestion[] = [];

  for (const source of pages) {
    const sourceTerms = new Set(
      tokenize(
        source.title,
        source.description,
        ...source.headings,
        source.path,
        ...site.business.topics,
      ),
    );
    const existing = new Set(source.internalLinks);

    for (const target of targets) {
      if (target.href === source.path) continue;
      if (existing.has(target.href)) continue;
      const shared = target.terms.filter((t) => sourceTerms.has(t));
      if (shared.length === 0) continue;

      suggestions.push({
        sourceFile: source.file,
        sourceRoute: source.path,
        targetHref: target.href,
        anchorText: suggestAnchor(target.label, shared),
        rationale: `Shared topical terms: ${shared.slice(0, 5).join(", ")}`,
        sharedTerms: shared.slice(0, 8),
      });
    }
  }

  suggestions.sort(
    (a, b) => b.sharedTerms.length - a.sharedTerms.length || a.sourceRoute.localeCompare(b.sourceRoute),
  );

  // Deduplicate by source+target
  const seen = new Set<string>();
  const deduped: LinkSuggestion[] = [];
  for (const s of suggestions) {
    const key = `${s.sourceFile}→${s.targetHref}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(s);
    if (deduped.length >= maxSuggestions) break;
  }
  return deduped;
}

function suggestAnchor(label: string, shared: string[]): string {
  if (label && label !== "/" && !label.startsWith("/")) return label;
  if (shared[0]) {
    return shared[0].charAt(0).toUpperCase() + shared[0].slice(1);
  }
  return label.replace(/^\//, "") || "Learn more";
}
