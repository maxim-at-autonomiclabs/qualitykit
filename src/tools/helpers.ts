import type { SiteModel } from "../model/site.js";
import { analyzeProject } from "../adapters/index.js";
import {
  ProjectReadError,
  readProjectFiles,
  resolveSafeRoot,
} from "../project/read.js";

export function jsonResult(data: unknown, isError = false) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(data, null, 2),
      },
    ],
    isError,
  };
}

export function errorResult(error: unknown) {
  const message =
    error instanceof Error ? error.message : "Unknown error occurred";
  return jsonResult(
    {
      ok: false,
      error: message,
      hint:
        error instanceof ProjectReadError
          ? "Provide an absolute projectRoot that exists on disk."
          : undefined,
    },
    true,
  );
}

export function loadSite(
  projectRoot: string,
  siteUrl?: string,
): SiteModel {
  const root = resolveSafeRoot(projectRoot);
  const files = readProjectFiles(root);
  return analyzeProject(files, { siteUrl }, root);
}
