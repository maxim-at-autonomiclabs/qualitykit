import { z } from "zod";
import { detectAdapter } from "../adapters/index.js";
import { runAuditEngine } from "../audit/engine.js";
import {
  growChangeToContract,
  routePathPresent,
  toBuildContract,
  type BuildContract,
} from "../grow/build-contract.js";
import { listGrowChanges } from "../grow/impressions.js";
import { fileSpecToDiff } from "../fix/diff.js";
import type { FileSpec, Recommendation } from "../model/site.js";
import { withCoverageEnvelope } from "./envelope.js";
import { errorResult, jsonResult, loadSite } from "./helpers.js";

export const qualitykitFixInputSchema = {
  projectRoot: z
    .string()
    .describe("Absolute path to the website repository root"),
  siteUrl: z.string().url().optional(),
  findingIds: z
    .array(z.string())
    .optional()
    .describe("Finding IDs to generate technical/blog FileSpecs for"),
  opportunityIds: z
    .array(z.string())
    .optional()
    .describe(
      "Grow/GSC opportunity ids (page-*, gsc-query-*, or finding ids). Pages/queries return buildContracts for the host agent; findings still map to diffs.",
    ),
  safeAutoOnly: z
    .boolean()
    .optional()
    .describe("When true, only emit technical fixes marked fixSafety=auto (never page contracts)"),
};

const FINDING_TO_REC: Record<string, string[]> = {
  "missing-robots": ["tech-robots", "static-robots"],
  "missing-sitemap": ["tech-sitemap", "static-sitemap"],
  "missing-metadatabase": ["tech-metadatabase"],
  "missing-home-canonical": ["tech-canonical-home"],
  "missing-title-template": ["tech-title-template"],
  "missing-root-description": ["tech-root-description"],
  "robots-blocks-all": ["tech-robots-blocks-all"],
  "no-blog": ["blog-scaffold-mdx"],
  "no-jsonld": ["schema-organization"],
};

function isPageOrQueryId(id: string): boolean {
  return id.startsWith("page-") || id.startsWith("gsc-query-") || id.startsWith("gsc-page-");
}

export async function qualitykitFix(args: {
  projectRoot: string;
  siteUrl?: string;
  findingIds?: string[];
  opportunityIds?: string[];
  safeAutoOnly?: boolean;
}) {
  try {
    const site = loadSite(args.projectRoot, args.siteUrl);
    const audit = runAuditEngine(site);
    const growById = new Map(
      listGrowChanges(site, audit.findings).map((c) => [c.id, c]),
    );

    const requested = [
      ...(args.opportunityIds ?? []),
      ...(args.findingIds ?? []),
    ];
    const uniqueRequested = [...new Set(requested)];

    const findingIdSet = new Set(
      (args.findingIds?.length
        ? args.findingIds
        : uniqueRequested.filter((id) => !isPageOrQueryId(id))
      ).filter(Boolean),
    );
    // opportunityIds that are finding ids also count
    for (const id of args.opportunityIds ?? []) {
      if (!isPageOrQueryId(id)) findingIdSet.add(id);
    }

    let targets = audit.findings;
    if (args.findingIds?.length || args.opportunityIds?.length) {
      targets = audit.findings.filter((f) => findingIdSet.has(f.id));
    }
    if (args.safeAutoOnly) {
      targets = targets.filter((f) => f.fixSafety === "auto");
    }

    const { adapter } = detectAdapter(site.files);
    const tech = adapter.planTechnicalFixes(site);
    const blog = adapter.planBlog(site, {});
    const allRecs: Recommendation[] = [...tech, ...blog];

    const selectedRecs: Recommendation[] = [];
    const seen = new Set<string>();
    for (const finding of targets) {
      const recIds = [
        ...(FINDING_TO_REC[finding.id] ?? []),
        ...(finding.relatedIds ?? []),
      ];
      for (const id of recIds) {
        if (seen.has(id)) continue;
        const rec = allRecs.find((r) => r.id === id);
        if (rec) {
          seen.add(id);
          selectedRecs.push(rec);
        }
      }
    }

    const explicitIds =
      Boolean(args.findingIds?.length) || Boolean(args.opportunityIds?.length);
    // Only dump auto technical fixes when the caller did not pin specific ids.
    if (selectedRecs.length === 0 && args.safeAutoOnly && !explicitIds) {
      for (const rec of tech) {
        if (
          !rec.requiresUserApproval &&
          rec.files.some((f) => f.kind === "create" || f.kind === "edit")
        ) {
          selectedRecs.push(rec);
        }
      }
    }

    const diffs = [];
    for (const rec of selectedRecs) {
      for (const file of rec.files) {
        const existing = site.files.find((f) => f.path === file.path)?.content;
        diffs.push({
          findingIds: targets
            .filter(
              (t) =>
                (t.relatedIds ?? []).includes(rec.id) ||
                (FINDING_TO_REC[t.id] ?? []).includes(rec.id),
            )
            .map((t) => t.id),
          recommendationId: rec.id,
          requiresUserApproval: Boolean(rec.requiresUserApproval),
          ...fileSpecToDiff(file, existing),
          fileSpec: file as FileSpec,
        });
      }
    }

    const buildContracts: BuildContract[] = [];
    const skipped: Array<{ id: string; reason: string }> = [];

    for (const id of findingIdSet) {
      if (isPageOrQueryId(id)) continue;
      if (audit.findings.some((f) => f.id === id)) continue;
      skipped.push({
        id,
        reason: "Finding not present in current audit — nothing to fix.",
      });
    }

    const pageQueryIds = (args.opportunityIds ?? []).filter(isPageOrQueryId);

    if (args.safeAutoOnly && pageQueryIds.length) {
      for (const id of pageQueryIds) {
        skipped.push({
          id,
          reason:
            "safeAutoOnly=true — page/query opportunities need host-agent buildContracts (omit safeAutoOnly).",
        });
      }
    } else {
      const decorate = (contract: BuildContract): BuildContract => {
        if (site.framework === "generic" && contract.kind === "page" && contract.path) {
          const staticPath = `${contract.path.replace(/^\//, "").replace(/\/$/, "")}/index.html`;
          return {
            ...contract,
            suggestedFix: `Create static HTML at ${staticPath} matching this site's existing design (not App Router page.tsx). ${contract.suggestedFix}`,
            constraints: [
              ...contract.constraints,
              `Static HTML site — implement as ${staticPath} (or equivalent), reuse existing CSS/layout patterns from index.html.`,
            ],
            acceptance: [
              ...contract.acceptance.filter((a) => !a.includes("App Router")),
              `File ${staticPath} exists and is inventoried as route ${contract.path}.`,
            ],
          };
        }
        return contract;
      };

      for (const id of pageQueryIds) {
        const change = growById.get(id);
        if (change?.kind === "page" && change.page?.path) {
          if (routePathPresent(site.routes, change.page.path)) {
            skipped.push({
              id,
              reason: `Path ${change.page.path} already present — call qualitykit.verify then visibility.mark_applied.`,
            });
            continue;
          }
          buildContracts.push(decorate(growChangeToContract(change)));
          continue;
        }

        if (id.startsWith("page-")) {
          // Not in topChanges (e.g. already built or filtered) — still emit a minimal contract
          const contract = toBuildContract({ id, kind: "page" });
          if (contract.path && routePathPresent(site.routes, contract.path)) {
            skipped.push({
              id,
              reason: `Path ${contract.path} already present — call qualitykit.verify then visibility.mark_applied.`,
            });
            continue;
          }
          buildContracts.push(decorate(contract));
          continue;
        }

        // gsc-query / gsc-page
        buildContracts.push(
          decorate(
            toBuildContract({
              id,
              kind: id.startsWith("gsc-query-") ? "query" : "page",
              title: change?.title,
              suggestedFix: change?.suggestedFix,
              path: change?.page?.path,
            }),
          ),
        );
      }
    }

    // Unmatched opportunityIds that aren't findings and weren't handled
    for (const id of args.opportunityIds ?? []) {
      if (isPageOrQueryId(id)) continue;
      if (audit.findings.some((f) => f.id === id)) continue;
      if (skipped.some((s) => s.id === id)) continue;
      skipped.push({
        id,
        reason: "Unknown opportunity id — not a current finding or page/query opportunity.",
      });
    }

    return jsonResult(
      withCoverageEnvelope(
        {
          ok: true,
          tool: "qualitykit.fix",
          mode: "advise-only",
          selectedFindings: targets.map((t) => ({
            id: t.id,
            kind: t.kind,
            fixSafety: t.fixSafety,
            title: t.title,
          })),
          diffs,
          buildContracts,
          skipped,
          notes: [
            "Advise-only: QualityKit never writes the repository.",
            "Apply technical diffs with the coding agent after user approval.",
            "For buildContracts: implement pages/edits in-repo matching project patterns, then qualitykit.verify({ opportunityIds }) and visibility.mark_applied.",
            "Prefer safeAutoOnly=true for low-risk technical creates/edits only.",
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
