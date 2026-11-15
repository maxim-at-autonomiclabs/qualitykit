import { z } from "zod";
import { nextjsAdapter } from "../adapters/nextjs/index.js";
import { genericAdapter } from "../adapters/generic.js";
import { errorResult, jsonResult, loadSite } from "./helpers.js";

export const planChangesInputSchema = {
  projectRoot: z
    .string()
    .describe("Absolute path to the website repository root"),
  siteUrl: z.string().url().optional(),
  includeBlogHints: z
    .boolean()
    .optional()
    .describe("Include a high-level blog recommendation when justified"),
};

export async function seoPlanChanges(args: {
  projectRoot: string;
  siteUrl?: string;
  includeBlogHints?: boolean;
}) {
  try {
    const site = loadSite(args.projectRoot, args.siteUrl);
    const adapter =
      site.framework === "nextjs" ? nextjsAdapter : genericAdapter;
    const recommendations = adapter.planTechnicalFixes(site);

    if (args.includeBlogHints && site.framework === "nextjs") {
      const blogRecs = adapter.planBlog(site, {});
      const hint = blogRecs.find((r) => r.id === "blog-scaffold-mdx");
      if (hint) {
        recommendations.push({
          ...hint,
          files: hint.files.slice(0, 0),
          rationale:
            hint.rationale +
            " Call blog.scaffold for full file specs after user approval.",
        });
        recommendations.sort(
          (a, b) => b.priority - a.priority || a.id.localeCompare(b.id),
        );
      }
    }

    return jsonResult({
      ok: true,
      tool: "seo.plan_changes",
      framework: site.framework,
      router: site.router,
      recommendationCount: recommendations.length,
      recommendations,
      scoring:
        "priority = impact * confidence / (effort + risk). Higher is better.",
      implementationNote:
        "Apply create/edit file specs yourself. QualityKit does not write the repository.",
    });
  } catch (error) {
    return errorResult(error);
  }
}
