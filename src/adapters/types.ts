import type {
  AnalyzeOptions,
  BlogOptions,
  FrameworkId,
  ProjectFile,
  Recommendation,
  SiteModel,
} from "../model/site.js";

/**
 * Framework adapter interface.
 * v1 implements `nextjs` and a `generic` fallback.
 * Future adapters (astro, nuxt, wordpress) should implement this same contract.
 */
export interface FrameworkAdapter {
  id: FrameworkId;
  detect(files: ProjectFile[]): number;
  analyze(files: ProjectFile[], options: AnalyzeOptions): SiteModel;
  planTechnicalFixes(site: SiteModel): Recommendation[];
  planBlog(site: SiteModel, options: BlogOptions): Recommendation[];
}

export interface DetectResult {
  adapter: FrameworkAdapter;
  confidence: number;
}
