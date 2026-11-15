import { z } from "zod";
import { nextjsAdapter } from "../adapters/nextjs/index.js";
import { buildContentBriefs } from "./content.js";
import { buildLinkSuggestions } from "./links.js";
import { buildSchemaPlan } from "./schema.js";
import { withCoverageEnvelope } from "./envelope.js";
import { errorResult, jsonResult, loadSite } from "./helpers.js";

export const qualitykitPlanInputSchema = {
  projectRoot: z
    .string()
    .describe("Absolute path to the website repository root"),
  siteUrl: z.string().url().optional(),
  includeBlog: z.boolean().optional().default(true),
};

export async function qualitykitPlan(args: {
  projectRoot: string;
  siteUrl?: string;
  includeBlog?: boolean;
}) {
  try {
    const site = loadSite(args.projectRoot, args.siteUrl);
    const briefs = buildContentBriefs(site, 3);
    const links = buildLinkSuggestions(site, briefs.map((b) => `/blog/${b.slug}`), 12);
    const schema = buildSchemaPlan(site, true);
    const blog =
      args.includeBlog !== false && site.framework === "nextjs"
        ? nextjsAdapter.planBlog(site, { includeCategories: true })
        : [];

    return jsonResult(
      withCoverageEnvelope(
        {
          ok: true,
          tool: "qualitykit.plan",
          opportunities: {
            contentBriefs: briefs,
            blogRecommendations: blog,
            schemaRecommendations: schema,
            internalLinks: links,
          },
          notes: [
            "All items are opportunities unless also flagged as defects by qualitykit.audit.",
            "QualityKit does not write files. Apply approved specs via the coding agent.",
            "Do not mass-generate articles.",
          ],
        },
        {
          source: "completed",
          rendered: "not_run",
          live: "not_run",
          searchData: "not_connected",
        },
      ),
    );
  } catch (error) {
    return errorResult(error);
  }
}
