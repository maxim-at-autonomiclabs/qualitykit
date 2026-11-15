import type {
  AnalyzeOptions,
  BlogOptions,
  ProjectFile,
  Recommendation,
  SiteModel,
} from "../../model/site.js";
import type { FrameworkAdapter } from "../types.js";
import { analyzeNextjs } from "./analyze.js";
import { planBlog as planBlogImpl } from "./plan-blog.js";
import { planTechnicalFixes as planTechnicalFixesImpl } from "./plan-technical.js";
import { parsePackageJson } from "./parse.js";

export const nextjsAdapter: FrameworkAdapter = {
  id: "nextjs",
  detect(files: ProjectFile[]): number {
    const pkg = parsePackageJson(files);
    if (pkg.nextVersion) return 0.98;
    const hasNextConfig = files.some((f) =>
      /^next\.config\.(js|mjs|cjs|ts)$/.test(f.path),
    );
    const hasApp = files.some(
      (f) => f.path.startsWith("app/") || f.path.startsWith("src/app/"),
    );
    const hasPages = files.some(
      (f) => f.path.startsWith("pages/") || f.path.startsWith("src/pages/"),
    );
    if (hasNextConfig && (hasApp || hasPages)) return 0.9;
    if (hasNextConfig) return 0.7;
    if (hasApp || hasPages) return 0.4;
    return 0;
  },
  analyze(files: ProjectFile[], options: AnalyzeOptions): SiteModel {
    return analyzeNextjs(files, options);
  },
  planTechnicalFixes(site: SiteModel): Recommendation[] {
    return planTechnicalFixesImpl(site);
  },
  planBlog(site: SiteModel, options: BlogOptions): Recommendation[] {
    return planBlogImpl(site, options);
  },
};

export { analyzeNextjs, planBlogImpl as planBlog, planTechnicalFixesImpl as planTechnicalFixes };
