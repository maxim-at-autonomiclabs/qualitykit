import { z } from "zod";
import { runAuditEngine } from "../audit/engine.js";
import {
  pathFromPageOpportunityId,
  routePathPresent,
} from "../grow/build-contract.js";
import { findGrowChangeById } from "../grow/impressions.js";
import type { ProjectFile } from "../model/site.js";
import { analyzeProject } from "../adapters/index.js";
import { resolveSafeRoot, readProjectFiles } from "../project/read.js";
import { withCoverageEnvelope } from "./envelope.js";
import { errorResult, jsonResult, loadSite } from "./helpers.js";
import { callMarkApplied } from "./monitor.js";

export const qualitykitVerifyInputSchema = {
  projectRoot: z
    .string()
    .describe("Absolute path to the website repository root"),
  siteUrl: z.string().url().optional(),
  findingIds: z
    .array(z.string())
    .optional()
    .describe("Limit finding verification to these finding IDs"),
  opportunityIds: z
    .array(z.string())
    .optional()
    .describe(
      "Grow/GSC page opportunity ids to check for route presence (page-*). Present ids are readyToShip.",
    ),
  paths: z
    .record(z.string())
    .optional()
    .describe("Optional map of opportunityId → path when grow lookup is unavailable"),
  apiBaseUrl: z.string().url().optional(),
  apiKey: z.string().optional(),
  markApplied: z
    .boolean()
    .optional()
    .describe(
      "When true (default) and Pro credentials are set, snapshot readyToShip ids via visibility.mark_applied",
    ),
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
  opportunityIds?: string[];
  paths?: Record<string, string>;
  apiBaseUrl?: string;
  apiKey?: string;
  markApplied?: boolean;
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

    const opportunityIds = args.opportunityIds ?? [];
    const findingWatch =
      args.findingIds?.length
        ? args.findingIds
        : opportunityIds.length
          ? []
          : before.findings.map((f) => f.id);

    const beforeMap = new Map(before.findings.map((f) => [f.id, f]));
    const afterMap = new Map(after.findings.map((f) => [f.id, f]));

    const fixed: string[] = [];
    const remaining: string[] = [];
    const regressed: string[] = [];

    for (const id of findingWatch) {
      const had = beforeMap.has(id);
      const has = afterMap.has(id);
      if (had && !has) fixed.push(id);
      else if (had && has) remaining.push(id);
      else if (!had && has) regressed.push(id);
    }

    if (!args.findingIds?.length && !opportunityIds.length) {
      for (const f of after.findings) {
        if (f.kind === "defect" && !beforeMap.has(f.id) && !regressed.includes(f.id)) {
          regressed.push(f.id);
        }
      }
    }

    const pageResults: Array<{
      id: string;
      path: string | null;
      present: boolean;
    }> = [];

    for (const id of opportunityIds) {
      const change = findGrowChangeById(beforeSite, before.findings, id);
      const pathFromEvidence = change?.evidence
        ?.find((e) => e.startsWith("path="))
        ?.slice("path=".length);
      const path =
        args.paths?.[id] ??
        change?.page?.path ??
        pathFromPageOpportunityId(id) ??
        (pathFromEvidence || null);
      const present = path
        ? routePathPresent(afterSite.routes, path)
        : false;
      pageResults.push({ id, path, present });
    }

    const readyPages = pageResults.filter((p) => p.present).map((p) => p.id);
    const readyToShip = [...new Set([...fixed, ...readyPages])];

    let shipped: number | null = null;
    let changeSetId: string | null = null;
    let markAppliedError: string | null = null;
    const shouldMark = args.markApplied !== false && readyToShip.length > 0;

    if (shouldMark) {
      const items = readyToShip.map((id) => {
        const page = pageResults.find((p) => p.id === id);
        return {
          id,
          path: page?.path ?? args.paths?.[id],
        };
      });
      const result = await callMarkApplied({
        apiBaseUrl: args.apiBaseUrl,
        apiKey: args.apiKey,
        changeIds: readyToShip,
        items,
        label: `verify-${new Date().toISOString().slice(0, 10)}`,
        alsoSiteBaseline: true,
      });
      if (result.ok) {
        shipped =
          typeof result.data.shipped === "number"
            ? result.data.shipped
            : readyToShip.length;
        const applied = result.data.applied as
          | { changeSetId?: string }
          | undefined;
        changeSetId = applied?.changeSetId ?? null;
      } else if (result.missingCreds) {
        markAppliedError = null; // expected offline — readyToShip only
      } else {
        markAppliedError = result.error;
      }
    }

    return jsonResult(
      withCoverageEnvelope(
        {
          ok: true,
          tool: "qualitykit.verify",
          summary: {
            fixed: fixed.length,
            remaining: remaining.length,
            regressed: regressed.length,
            pagesPresent: readyPages.length,
            pagesMissing: pageResults.filter((p) => !p.present).length,
            readyToShip: readyToShip.length,
            shipped: shipped ?? 0,
          },
          fixed,
          remaining,
          regressed,
          pageResults,
          readyToShip,
          shipped,
          changeSetId,
          afterSummary: after.summary,
          notes: [
            "Verification uses local analysis of current files plus optional proposedFiles.",
            "Does not prove ranking or AI citation improvements.",
            readyToShip.length && shipped == null
              ? "readyToShip is set — call visibility.mark_applied (or set QUALITYKIT_API_KEY + QUALITYKIT_API_BASE) to record the change set and ship backlog rows."
              : shipped != null
                ? `Recorded ${shipped} shipped via mark_applied.`
                : "Pass opportunityIds for page route checks after the host agent implements buildContracts.",
            ...(markAppliedError
              ? [`mark_applied failed: ${markAppliedError}`]
              : []),
          ],
        },
        {
          source: "completed",
          rendered: "not_run",
          live: "not_run",
          searchData: shipped != null ? "completed" : "not_connected",
        },
      ),
    );
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
