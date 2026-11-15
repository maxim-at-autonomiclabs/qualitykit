import { z } from "zod";
import { runAuditEngine } from "../audit/engine.js";
import { fetchRenderedPages, type RenderedPage } from "../integrations/fetch-html.js";
import { errorResult, jsonResult, loadSite } from "./helpers.js";

export const qualitykitAuditInputSchema = {
  projectRoot: z
    .string()
    .describe("Absolute path to the website repository root"),
  siteUrl: z.string().url().optional(),
  includeRendered: z
    .boolean()
    .optional()
    .describe("Fetch rendered HTML when siteUrl is provided"),
};

export async function qualitykitAudit(args: {
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
    const defects = result.findings.filter((f) => f.kind === "defect");
    const opportunities = result.findings.filter((f) => f.kind === "opportunity");
    return jsonResult({
      ok: true,
      tool: "qualitykit.audit",
      routeInventory: result.routeInventory,
      summary: result.summary,
      defects,
      opportunities,
      findings: result.findings,
      site: result.site,
      rendered: result.rendered,
      caveats: [
        "Defects are issues to fix; opportunities are growth recommendations.",
        "Missing robots/blog/title-template are not automatically critical.",
        "No ranking or AI-citation guarantees.",
      ],
    });
  } catch (error) {
    return errorResult(error);
  }
}
