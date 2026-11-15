import path from "node:path";
import { fileURLToPath } from "node:url";
import { qualitykitAudit } from "../dist/tools/qualitykit-audit.js";
import { qualitykitAiAudit } from "../dist/tools/qualitykit-ai-audit.js";
import { qualitykitPlan } from "../dist/tools/qualitykit-plan.js";
import { qualitykitFix } from "../dist/tools/qualitykit-fix.js";
import { qualitykitVerify } from "../dist/tools/qualitykit-verify.js";

const projectRoot = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../fixtures/bare-app",
);
const siteUrl = "https://example.com";

function parse(result) {
  return JSON.parse(result.content[0].text);
}

const audit = parse(await qualitykitAudit({ projectRoot, siteUrl }));
const ai = parse(await qualitykitAiAudit({ projectRoot, siteUrl }));
const plan = parse(await qualitykitPlan({ projectRoot, siteUrl }));
const fix = parse(
  await qualitykitFix({ projectRoot, siteUrl, safeAutoOnly: true }),
);

const robots = fix.diffs.find((d) => d.path.endsWith("robots.ts"));
const sitemap = fix.diffs.find((d) => d.path.endsWith("sitemap.ts"));
const proposedFiles = [robots, sitemap]
  .filter(Boolean)
  .map((d) => ({ path: d.path, content: d.fileSpec.content }));

const verify = parse(
  await qualitykitVerify({
    projectRoot,
    siteUrl,
    findingIds: [
      "missing-robots",
      "missing-sitemap",
      "missing-metadatabase",
    ],
    proposedFiles,
  }),
);

console.log(
  JSON.stringify(
    {
      projectRoot,
      audit: {
        summary: audit.summary,
        defects: audit.defects.map((f) => ({
          id: f.id,
          severity: f.severity,
          impact: f.expectedImpact,
          fixSafety: f.fixSafety,
        })),
        opportunities: audit.opportunities.map((f) => ({
          id: f.id,
          severity: f.severity,
        })),
        routeInventory: audit.routeInventory,
      },
      aiScores: ai.scores,
      aiFindingIds: ai.findings.map((f) => f.id),
      planBriefs: plan.opportunities.contentBriefs.map((b) => b.slug),
      blogRec: plan.opportunities.blogRecommendations.map((r) => r.id),
      fix: {
        mode: fix.mode,
        diffPaths: [...new Set(fix.diffs.map((d) => d.path))],
        robotsDiffOk: Boolean(
          robots?.diff?.includes("+++ b/") &&
            robots?.diff?.includes("MetadataRoute.Robots"),
        ),
      },
      verify,
    },
    null,
    2,
  ),
);
