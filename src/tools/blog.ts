import { z } from "zod";
import { nextjsAdapter } from "../adapters/nextjs/index.js";
import { errorResult, jsonResult, loadSite } from "./helpers.js";

export const blogScaffoldInputSchema = {
  projectRoot: z
    .string()
    .describe("Absolute path to the website repository root"),
  siteUrl: z.string().url().optional(),
  includeCategories: z.boolean().optional().default(true),
  contentSystem: z
    .enum(["mdx"])
    .optional()
    .default("mdx")
    .describe("v1 supports MDX only"),
};

export async function blogScaffold(args: {
  projectRoot: string;
  siteUrl?: string;
  includeCategories?: boolean;
  contentSystem?: "mdx";
}) {
  try {
    const site = loadSite(args.projectRoot, args.siteUrl);
    if (site.framework !== "nextjs") {
      return jsonResult({
        ok: false,
        tool: "blog.scaffold",
        error: "blog.scaffold requires a Next.js project in v1",
        framework: site.framework,
      }, true);
    }

    const recommendations = nextjsAdapter.planBlog(site, {
      includeCategories: args.includeCategories ?? true,
    });

    return jsonResult({
      ok: true,
      tool: "blog.scaffold",
      framework: site.framework,
      router: site.router,
      blogPresent: site.blog.present,
      recommendations,
      dependencies: ["gray-matter", "next-mdx-remote"],
      notes: [
        "Install dependencies in the target project before applying files.",
        "Skeletons include [verify] markers — do not publish unfinished articles.",
        "QualityKit never writes files; the coding agent applies specs after approval.",
      ],
    });
  } catch (error) {
    return errorResult(error);
  }
}
