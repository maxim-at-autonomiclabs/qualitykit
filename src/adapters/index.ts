import { genericAdapter } from "./generic.js";
import { nextjsAdapter } from "./nextjs/index.js";
import type { DetectResult, FrameworkAdapter } from "./types.js";
import type { AnalyzeOptions, ProjectFile, SiteModel } from "../model/site.js";

const adapters: FrameworkAdapter[] = [nextjsAdapter, genericAdapter];

export function detectAdapter(files: ProjectFile[]): DetectResult {
  let best: DetectResult = {
    adapter: genericAdapter,
    confidence: genericAdapter.detect(files),
  };
  for (const adapter of adapters) {
    if (adapter.id === "generic") continue;
    const confidence = adapter.detect(files);
    if (confidence > best.confidence) {
      best = { adapter, confidence };
    }
  }
  if (best.confidence < 0.5) {
    return { adapter: genericAdapter, confidence: best.confidence };
  }
  return best;
}

export function analyzeProject(
  files: ProjectFile[],
  options: AnalyzeOptions = {},
  projectRoot = "",
): SiteModel {
  const { adapter, confidence } = detectAdapter(files);
  const site = adapter.analyze(files, options);
  site.projectRoot = projectRoot;
  site.frameworkConfidence = Math.max(site.frameworkConfidence, confidence);
  return site;
}

export { nextjsAdapter, genericAdapter };
export type { FrameworkAdapter, DetectResult };
