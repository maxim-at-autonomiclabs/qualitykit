import { z } from "zod";
import { runAiAudit } from "../aeo/ai-audit.js";
import {
  fetchRenderedPages,
  type RenderedPage,
} from "../integrations/fetch-html.js";
import { withCoverageEnvelope } from "./envelope.js";
import { errorResult, jsonResult, loadSite } from "./helpers.js";

export const qualitykitAiAuditInputSchema = {
  projectRoot: z
    .string()
    .describe("Absolute path to the website repository root"),
  siteUrl: z.string().url().optional(),
  includeRendered: z.boolean().optional(),
};

export async function qualitykitAiAudit(args: {
  projectRoot: string;
  siteUrl?: string;
  includeRendered?: boolean;
}) {
  try {
    const site = loadSite(args.projectRoot, args.siteUrl);
    const rendered: RenderedPage[] = [];
    if (args.includeRendered && args.siteUrl) {
      rendered.push(
        ...(await fetchRenderedPages(args.siteUrl, { paths: ["/"] })),
      );
    }
    const result = runAiAudit(site, rendered);
    const renderedRan = Boolean(args.includeRendered && args.siteUrl);
    return jsonResult(
      withCoverageEnvelope(
        {
          ok: true,
          tool: "qualitykit.ai_audit",
          scores: result.scores,
          findings: result.findings,
          evidence: result.evidence,
          caveats: result.caveats,
        },
        {
          source: "completed",
          rendered: renderedRan ? "completed" : "not_run",
          live: "not_run",
          searchData: "not_connected",
        },
      ),
    );
  } catch (error) {
    return errorResult(error);
  }
}
