import { z } from "zod";
import { runAuditEngine } from "../audit/engine.js";
import {
  fetchRenderedPages,
  type RenderedPage,
} from "../integrations/fetch-html.js";
import { errorResult, jsonResult, loadSite } from "./helpers.js";

export const auditInputSchema = {
  projectRoot: z
    .string()
    .describe("Absolute path to the website repository root"),
  siteUrl: z.string().url().optional(),
  includeRendered: z
    .boolean()
    .optional()
    .describe("When true and siteUrl is set, fetch rendered HTML for key routes"),
};

export async function seoAudit(args: {
  projectRoot: string;
  siteUrl?: string;
  includeRendered?: boolean;
}) {
  try {
    const site = loadSite(args.projectRoot, args.siteUrl);
    const rendered: RenderedPage[] = [];
    if (args.includeRendered && args.siteUrl) {
      const paths = [
        "/",
        ...site.routes
          .filter((r) => r.kind === "page" && !r.path.includes(":"))
          .map((r) => r.path)
          .filter((p) => p !== "/")
          .slice(0, 4),
      ];
      rendered.push(...(await fetchRenderedPages(args.siteUrl, { paths })));
    }
    const result = runAuditEngine(site, rendered);
    return jsonResult({
      ok: true,
      tool: "seo.audit",
      ...result,
      caveats: [
        args.includeRendered && args.siteUrl
          ? "Includes optional rendered HTML fetch for provided siteUrl."
          : "Offline static analysis only unless includeRendered=true with siteUrl.",
        "Findings separate defects from opportunities. Missing blog is never a defect.",
        "Ask the user before blocking or unblocking AI crawlers.",
        "No fabricated traffic or ranking projections.",
      ],
    });
  } catch (error) {
    return errorResult(error);
  }
}

/** @deprecated Prefer runAuditEngine — kept for tests */
export { runAuditEngine as buildAudit } from "../audit/engine.js";
