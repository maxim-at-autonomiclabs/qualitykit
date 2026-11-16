import { z } from "zod";
import { runAuditEngine } from "../audit/engine.js";
import {
  buildGrowReport,
  type GscOpportunityOverlay,
} from "../grow/impressions.js";
import { withCoverageEnvelope } from "./envelope.js";
import { errorResult, jsonResult, loadSite } from "./helpers.js";
import { fetchVisibilityOverlay } from "./monitor.js";
import { syncGrowToBacklog } from "./opportunities.js";
import { resolveSiteProfile } from "./site-profile.js";

export const qualitykitGrowInputSchema = {
  projectRoot: z
    .string()
    .describe("Absolute path to the website repository root"),
  siteUrl: z.string().url().optional(),
  apiBaseUrl: z
    .string()
    .url()
    .optional()
    .describe(
      "Optional QualityKit Cloud base (or QUALITYKIT_API_BASE) to enrich with Search Console",
    ),
  apiKey: z
    .string()
    .optional()
    .describe("Optional Pro API key (or QUALITYKIT_API_KEY) for GSC enrichment"),
  continueDespiteStaleProfile: z
    .boolean()
    .optional()
    .describe(
      "When true, allow new-page recommendations even if brand/ICP/products are stale (user explicitly continues).",
    ),
};

export async function qualitykitGrow(args: {
  projectRoot: string;
  siteUrl?: string;
  apiBaseUrl?: string;
  apiKey?: string;
  continueDespiteStaleProfile?: boolean;
}) {
  try {
    const site = loadSite(args.projectRoot, args.siteUrl);
    const audit = runAuditEngine(site);

    const { profile, freshness } = await resolveSiteProfile({
      projectRoot: args.projectRoot,
      siteUrl: args.siteUrl,
      apiBaseUrl: args.apiBaseUrl,
      apiKey: args.apiKey,
    });

    const overlay = await fetchVisibilityOverlay({
      apiBaseUrl: args.apiBaseUrl,
      apiKey: args.apiKey,
    });
    const gscOps = (overlay?.rankedOpportunities ??
      []) as unknown as GscOpportunityOverlay[];
    const searchData =
      (overlay?.searchData as
        | "completed"
        | "not_connected"
        | "fail"
        | "not_run"
        | "not_applicable"
        | undefined) ?? "not_connected";

    const scoringProfile = {
      ...profile,
      status: (freshness.status === "missing" ? "stale" : freshness.status) as
        | "fresh"
        | "stale",
    };

    const grow = buildGrowReport(site, audit.findings, gscOps, scoringProfile, {
      continueDespiteStaleProfile: Boolean(args.continueDespiteStaleProfile),
    });

    // Fire-and-forget: keep Pro dashboard backlog warm when Cloud creds exist
    void syncGrowToBacklog({
      apiBaseUrl: args.apiBaseUrl,
      apiKey: args.apiKey,
      items: grow.topChanges.map((c) => ({
        id: c.id,
        title: c.title,
        kind: c.kind,
        expectedImpact: c.expectedImpact,
        confidence: c.confidence,
        effort: c.effort,
        evidence: c.evidence,
        page: c.page ? { path: c.page.path } : undefined,
      })),
    });

    return jsonResult(
      withCoverageEnvelope(
        {
          ok: true,
          tool: "qualitykit.grow",
          mode: "impressions",
          indexabilityBlocked: grow.indexabilityBlocked,
          why: grow.why,
          topChanges: grow.topChanges,
          safeToImplement: grow.safeToImplement,
          needsApproval: grow.needsApproval,
          profile: grow.profile,
          queries: grow.queries ?? [],
          opportunities: grow.opportunities ?? [],
          deprioritised: grow.deprioritised ?? [],
          withholdNewPages: grow.withholdNewPages ?? false,
          summary: {
            driversLimited: grow.why.filter(
              (d) => d.status === "blocking" || d.status === "limited",
            ).length,
            topChangeCount: grow.topChanges.length,
            autoCount: grow.safeToImplement.length,
            approvalCount: grow.needsApproval.length,
            gscBackedCount: grow.topChanges.filter(
              (c) =>
                c.page?.demand === "gsc_backed" ||
                c.evidence.includes("demand=gsc_backed"),
            ).length,
            deprioritisedCount: (grow.deprioritised ?? []).length,
            profileVersion: grow.profile?.version ?? 0,
            profileStatus: grow.profile?.status ?? "stale",
          },
          notes: [
            ...grow.notes,
            "Advise-only: qualitykit.fix with finding IDs (safeAutoOnly for technical) or opportunityIds for page-* → buildContracts; host agent implements; then qualitykit.verify + mark_applied.",
            searchData === "completed"
              ? "Search Console enrichment applied via QualityKit Cloud."
              : "Search Console not connected in this response — set QUALITYKIT_API_KEY + QUALITYKIT_API_BASE after connecting GSC in the Pro dashboard.",
            "When Pro credentials are set, topChanges are upserted to the Cloud opportunity backlog (statuses preserved).",
          ],
          caveats: [
            "No keyword volumes from third-party datasets.",
            "Impression growth is not guaranteed.",
            "Local code fixes stay free; GSC enrichment and stored Site Profile are Pro Cloud features.",
            "Optimise for relevant demand, not maximum keywords.",
          ],
        },
        {
          source: "completed",
          rendered: "not_run",
          live: "not_run",
          searchData,
        },
        site.business.name ?? site.packageName ?? "local",
        "full",
      ),
    );
  } catch (error) {
    return errorResult(error);
  }
}
