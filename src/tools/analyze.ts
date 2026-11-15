import { z } from "zod";
import { stripFiles } from "../model/site.js";
import { errorResult, jsonResult, loadSite } from "./helpers.js";

export const analyzeInputSchema = {
  projectRoot: z
    .string()
    .describe("Absolute path to the website repository root"),
  siteUrl: z
    .string()
    .url()
    .optional()
    .describe(
      "Canonical site origin used only for generated metadata (not fetched)",
    ),
};

export async function codebaseAnalyze(args: {
  projectRoot: string;
  siteUrl?: string;
}) {
  try {
    const site = loadSite(args.projectRoot, args.siteUrl);
    return jsonResult({
      ok: true,
      tool: "codebase.analyze",
      analysis: stripFiles(site),
      notes: [
        "Read-only analysis. The coding agent must apply any file changes.",
        site.unsupportedReason,
      ].filter(Boolean),
    });
  } catch (error) {
    return errorResult(error);
  }
}
