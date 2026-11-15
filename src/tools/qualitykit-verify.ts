import { z } from "zod";
import { runAuditEngine } from "../audit/engine.js";
import type { ProjectFile } from "../model/site.js";
import { analyzeProject } from "../adapters/index.js";
import { resolveSafeRoot, readProjectFiles } from "../project/read.js";
import { errorResult, jsonResult, loadSite } from "./helpers.js";

export const qualitykitVerifyInputSchema = {
  projectRoot: z
    .string()
    .describe("Absolute path to the website repository root"),
  siteUrl: z.string().url().optional(),
  findingIds: z
    .array(z.string())
    .optional()
    .describe("Limit verification to these finding IDs"),
  proposedFiles: z
    .array(
      z.object({
        path: z.string(),
        content: z.string(),
      }),
    )
    .optional()
    .describe("Proposed file contents to verify as if applied (not written)"),
};

export async function qualitykitVerify(args: {
  projectRoot: string;
  siteUrl?: string;
  findingIds?: string[];
  proposedFiles?: { path: string; content: string }[];
}) {
  try {
    const beforeSite = loadSite(args.projectRoot, args.siteUrl);
    const before = runAuditEngine(beforeSite);

    const root = resolveSafeRoot(args.projectRoot);
    const diskFiles = readProjectFiles(root);
    const merged = mergeProposed(diskFiles, args.proposedFiles ?? []);
    const afterSite = analyzeProject(merged, { siteUrl: args.siteUrl }, root);
    const after = runAuditEngine(afterSite);

    const watchIds =
      args.findingIds?.length
        ? args.findingIds
        : before.findings.map((f) => f.id);

    const beforeMap = new Map(before.findings.map((f) => [f.id, f]));
    const afterMap = new Map(after.findings.map((f) => [f.id, f]));

    const fixed: string[] = [];
    const remaining: string[] = [];
    const regressed: string[] = [];

    for (const id of watchIds) {
      const had = beforeMap.has(id);
      const has = afterMap.has(id);
      if (had && !has) fixed.push(id);
      else if (had && has) remaining.push(id);
      else if (!had && has) regressed.push(id);
    }

    // Also detect new defects not in watch list when full verify
    if (!args.findingIds?.length) {
      for (const f of after.findings) {
        if (f.kind === "defect" && !beforeMap.has(f.id) && !regressed.includes(f.id)) {
          regressed.push(f.id);
        }
      }
    }

    return jsonResult({
      ok: true,
      tool: "qualitykit.verify",
      summary: {
        fixed: fixed.length,
        remaining: remaining.length,
        regressed: regressed.length,
      },
      fixed,
      remaining,
      regressed,
      afterSummary: after.summary,
      notes: [
        "Verification uses local analysis of current files plus optional proposedFiles.",
        "Does not prove ranking or AI citation improvements.",
      ],
    });
  } catch (error) {
    return errorResult(error);
  }
}

function mergeProposed(
  files: ProjectFile[],
  proposed: { path: string; content: string }[],
): ProjectFile[] {
  const map = new Map(files.map((f) => [f.path, { ...f }]));
  for (const p of proposed) {
    map.set(p.path, {
      path: p.path,
      content: p.content,
      size: Buffer.byteLength(p.content, "utf8"),
    });
  }
  return [...map.values()].sort((a, b) => a.path.localeCompare(b.path));
}
