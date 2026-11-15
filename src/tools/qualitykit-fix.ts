import { z } from "zod";
import { nextjsAdapter } from "../adapters/nextjs/index.js";
import { runAuditEngine } from "../audit/engine.js";
import { fileSpecToDiff } from "../fix/diff.js";
import type { FileSpec, Recommendation } from "../model/site.js";
import { errorResult, jsonResult, loadSite } from "./helpers.js";

export const qualitykitFixInputSchema = {
  projectRoot: z
    .string()
    .describe("Absolute path to the website repository root"),
  siteUrl: z.string().url().optional(),
  findingIds: z
    .array(z.string())
    .optional()
    .describe("Finding IDs to generate fixes for"),
  safeAutoOnly: z
    .boolean()
    .optional()
    .describe("When true, only emit fixes marked fixSafety=auto"),
};

const FINDING_TO_REC: Record<string, string[]> = {
  "missing-robots": ["tech-robots"],
  "missing-sitemap": ["tech-sitemap"],
  "missing-metadatabase": ["tech-metadatabase"],
  "missing-home-canonical": ["tech-canonical-home"],
  "missing-title-template": ["tech-title-template"],
  "missing-root-description": ["tech-root-description"],
  "robots-blocks-all": ["tech-robots-blocks-all"],
  "no-blog": ["blog-scaffold-mdx"],
  "no-jsonld": ["schema-organization"],
};

export async function qualitykitFix(args: {
  projectRoot: string;
  siteUrl?: string;
  findingIds?: string[];
  safeAutoOnly?: boolean;
}) {
  try {
    const site = loadSite(args.projectRoot, args.siteUrl);
    const audit = runAuditEngine(site);
    let targets = audit.findings;
    if (args.findingIds?.length) {
      targets = targets.filter((f) => args.findingIds!.includes(f.id));
    }
    if (args.safeAutoOnly) {
      targets = targets.filter((f) => f.fixSafety === "auto");
    }

    const tech = nextjsAdapter.planTechnicalFixes(site);
    const blog = nextjsAdapter.planBlog(site, {});
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

    // If no mapping, still include auto technical fixes when safeAutoOnly
    if (selectedRecs.length === 0 && args.safeAutoOnly) {
      for (const rec of tech) {
        if (!rec.requiresUserApproval && rec.files.some((f) => f.kind === "create" || f.kind === "edit")) {
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
            .filter((t) =>
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

    return jsonResult({
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
      notes: [
        "Advise-only: QualityKit never writes the repository.",
        "Apply diffs with the coding agent after user approval.",
        "Prefer safeAutoOnly=true for low-risk technical creates/edits.",
      ],
    });
  } catch (error) {
    return errorResult(error);
  }
}
