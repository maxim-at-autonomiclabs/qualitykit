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
};

export async function qualitykitGrow(args: {
  projectRoot: string;
  siteUrl?: string;
  apiBaseUrl?: string;
  apiKey?: string;
}) {
  try {
    const site = loadSite(args.projectRoot, args.siteUrl);
    const audit = runAuditEngine(site);

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

    const grow = buildGrowReport(site, audit.findings, gscOps);

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
            "Local code fixes stay free; GSC enrichment is a Pro Cloud feature.",
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
