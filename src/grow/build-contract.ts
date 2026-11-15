import type { PageIntent, GrowChange } from "./impressions.js";

export type BuildContractKind = "page" | "query" | "finding";

export type BuildContract = {
  opportunityId: string;
  kind: BuildContractKind;
  path?: string;
  query?: string;
  intent?: PageIntent;
  title: string;
  outline: string[];
  acceptance: string[];
  suggestedFix: string;
  constraints: string[];
  verification: string;
};

export type BuildContractInput = {
  id: string;
  title?: string;
  kind?: string;
  path?: string;
  query?: string;
  intent?: PageIntent;
  suggestedFix?: string;
  verification?: string;
  evidence?: string[];
  page?: { path?: string; intent?: PageIntent };
};

const DEFAULT_CONSTRAINTS = [
  "Implement in-repo with the host coding agent — QualityKit does not write files.",
  "Mark unverified claims with [verify]; do not invent stats, authors, or competitor claims.",
  "Do not mass-generate articles or thin doorway pages.",
  "Match the project's existing layout, components, and content patterns.",
];

function normalizePath(path: string): string {
  if (!path.startsWith("/")) return `/${path}`;
  if (path.length > 1 && path.endsWith("/")) return path.slice(0, -1);
  return path;
}

function inferKind(input: BuildContractInput): BuildContractKind {
  if (input.kind === "page" || input.page?.path || input.id.startsWith("page-")) {
    return "page";
  }
  if (
    input.kind === "query" ||
    input.query ||
    input.id.startsWith("gsc-query-")
  ) {
    return "query";
  }
  return "finding";
}

const INTENT_PATH_PREFIX: Record<PageIntent, string> = {
  feature: "/features",
  solution: "/solutions",
  comparison: "/compare",
  tool: "/tools",
  guide: "/guides",
};

function inferIntent(input: BuildContractInput): PageIntent | undefined {
  if (input.intent) return input.intent;
  if (input.page?.intent) return input.page.intent;
  const m = input.id.match(/^page-(feature|solution|comparison|tool|guide)-/);
  if (m) return m[1] as PageIntent;
  const path = input.path ?? input.page?.path;
  if (!path) return undefined;
  if (path.startsWith("/features")) return "feature";
  if (path.startsWith("/solutions")) return "solution";
  if (path.startsWith("/compare")) return "comparison";
  if (path.startsWith("/tools")) return "tool";
  if (path.startsWith("/guides")) return "guide";
  return undefined;
}

/**
 * Recover a path from page-{intent}-{slugified-path} when grow lookup misses.
 * Example: page-feature-features-seo-audit → /features/seo-audit
 */
export function pathFromPageOpportunityId(id: string): string | undefined {
  const m = id.match(/^page-(feature|solution|comparison|tool|guide)-(.+)$/);
  if (!m) return undefined;
  const intent = m[1] as PageIntent;
  const slug = m[2]!;
  const prefix = INTENT_PATH_PREFIX[intent];
  const prefixSlug = prefix.replace(/^\//, "");
  if (slug === prefixSlug) return prefix;
  if (slug.startsWith(`${prefixSlug}-`)) {
    return `${prefix}/${slug.slice(prefixSlug.length + 1)}`;
  }
  return `${prefix}/${slug}`;
}

function outlineFor(
  kind: BuildContractKind,
  intent: PageIntent | undefined,
  path: string | undefined,
  query: string | undefined,
): string[] {
  if (kind === "query" && query) {
    return [
      `Identify the best existing page (or create one) that should rank for “${query}”.`,
      "Improve title/H1 and opening answer so the query intent is explicit.",
      "Add or tighten supporting sections; link from a relevant hub page.",
      "Ensure the page is indexable and included in the sitemap after publish.",
    ];
  }

  switch (intent) {
    case "feature":
      return [
        `Create ${path ?? "/features/..."} explaining the product capability.`,
        "Lead with a direct answer / what it does; then how it works and who it is for.",
        "Include a clear CTA and links to related solution or guide pages.",
        "Use [verify] for any unverified product claims.",
      ];
    case "solution":
      return [
        `Create ${path ?? "/solutions/..."} aimed at the target audience workflow.`,
        "Focus on outcomes and steps, not a generic blog post.",
        "Link back to the primary product/feature pages.",
        "Use [verify] for any unverified outcome claims.",
      ];
    case "comparison":
      return [
        `Create ${path ?? "/compare/..."} with honest evaluation criteria.`,
        "No unsourced competitor claims — use [verify] or omit specifics.",
        "Help the reader choose; include a fair summary table if appropriate.",
        "Link to product pages without keyword stuffing.",
      ];
    case "tool":
      return [
        `Create ${path ?? "/tools/..."} describing the tool and when to use it.`,
        "Explain inputs/outputs or workflow; keep copy practical.",
        "Link related guides and feature pages.",
      ];
    case "guide":
      return [
        `Create ${path ?? "/guides/..."} as a practical how-to.`,
        "Prefer depth over volume; one clear topic per page.",
        "Link back to product/feature pages where relevant.",
        "Mark unverified tips with [verify].",
      ];
    default:
      return [
        path
          ? `Implement route ${path} matching this repo's page patterns.`
          : "Implement the opportunity using existing site conventions.",
        "Add metadata (title, description) and a clear H1.",
        "Link from a relevant hub; include in sitemap if applicable.",
      ];
  }
}

function acceptanceFor(
  kind: BuildContractKind,
  path: string | undefined,
  query: string | undefined,
): string[] {
  const checks: string[] = [];
  if (path) {
    checks.push(`Route ${path} exists in the project route inventory.`);
    checks.push(`Page is linked from at least one key route (nav, hub, or related content).`);
  }
  if (query) {
    checks.push(
      `On-page copy clearly addresses the query “${query}” (title/H1/opening).`,
    );
  }
  if (kind === "page") {
    checks.push("No unsourced competitor claims or invented statistics.");
  }
  checks.push(
    "After deploy: call qualitykit.verify with this opportunity id, then visibility.mark_applied to record shipped + GSC baseline.",
  );
  return checks;
}

/** Deterministic agent-build contract — no FileSpecs, no LLM. */
export function toBuildContract(input: BuildContractInput): BuildContract {
  const kind = inferKind(input);
  const pathRaw =
    input.path ?? input.page?.path ?? pathFromPageOpportunityId(input.id);
  const path = pathRaw ? normalizePath(pathRaw) : undefined;
  const query =
    input.query ??
    (kind === "query" && input.id.startsWith("gsc-query-")
      ? input.id
          .slice("gsc-query-".length)
          .replace(/-/g, " ")
      : undefined);
  const intent = inferIntent(input);
  const title =
    input.title ??
    (path
      ? `Build ${path}`
      : query
        ? `Improve coverage for “${query}”`
        : `Implement ${input.id}`);
  const suggestedFix =
    input.suggestedFix ??
    (path
      ? `Create ${path} using this repo's existing page patterns; draft with the coding agent; mark unverified claims with [verify].`
      : query
        ? `Improve the best matching page for “${query}” (title, H1, opening answer, internal links).`
        : `Implement opportunity ${input.id} with the coding agent.`);

  return {
    opportunityId: input.id,
    kind,
    path,
    query,
    intent,
    title,
    outline: outlineFor(kind, intent, path, query),
    acceptance: acceptanceFor(kind, path, query),
    suggestedFix,
    constraints: [...DEFAULT_CONSTRAINTS],
    verification:
      input.verification ??
      (path
        ? `qualitykit.verify({ opportunityIds: ["${input.id}"] }) reports path ${path} present; then visibility.mark_applied.`
        : `Implement, then visibility.mark_applied with id ${input.id}; measure via visibility.report (GSC lag 1–3 days).`),
  };
}

export function growChangeToContract(change: GrowChange): BuildContract {
  return toBuildContract({
    id: change.id,
    title: change.title,
    kind: change.kind,
    path: change.page?.path,
    intent: change.page?.intent,
    suggestedFix: change.suggestedFix,
    verification: change.verification,
    evidence: change.evidence,
    page: change.page,
  });
}

export function routePathPresent(
  routes: Array<{ path: string }>,
  targetPath: string,
): boolean {
  const want = normalizePath(targetPath);
  const set = new Set(routes.map((r) => normalizePath(r.path)));
  return set.has(want);
}
