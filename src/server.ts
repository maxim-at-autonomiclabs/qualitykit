import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getRuleByUri, RULE_RESOURCES } from "./rules/index.js";
import {
  analyzeInputSchema,
  codebaseAnalyze,
} from "./tools/analyze.js";
import { auditInputSchema, seoAudit } from "./tools/audit.js";
import { blogScaffold, blogScaffoldInputSchema } from "./tools/blog.js";
import { contentBrief, contentBriefInputSchema } from "./tools/content.js";
import { linksPlan, linksPlanInputSchema } from "./tools/links.js";
import {
  planChangesInputSchema,
  seoPlanChanges,
} from "./tools/plan-changes.js";
import {
  qualitykitAiAudit,
  qualitykitAiAuditInputSchema,
} from "./tools/qualitykit-ai-audit.js";
import {
  qualitykitAudit,
  qualitykitAuditInputSchema,
} from "./tools/qualitykit-audit.js";
import {
  qualitykitFix,
  qualitykitFixInputSchema,
} from "./tools/qualitykit-fix.js";
import {
  qualitykitPlan,
  qualitykitPlanInputSchema,
} from "./tools/qualitykit-plan.js";
import {
  qualitykitVerify,
  qualitykitVerifyInputSchema,
} from "./tools/qualitykit-verify.js";
import {
  monitorStatus,
  monitorStatusInputSchema,
  visibilityReport,
  visibilityReportInputSchema,
} from "./tools/monitor.js";
import { schemaPlan, schemaPlanInputSchema } from "./tools/schema.js";
import { seoValidate, validateInputSchema } from "./tools/validate.js";

export const SERVER_NAME = "qualitykit";
export const SERVER_VERSION = "0.3.0";

export function createServer(): McpServer {
  const server = new McpServer({
    name: SERVER_NAME,
    version: SERVER_VERSION,
  });

  // Primary tools — prefer these
  server.registerTool(
    "qualitykit.audit",
    {
      title: "QualityKit audit",
      description:
        "Primary audit: route inventory, technical SEO, metadata, content, schema, links. Separates defects from opportunities. Optional rendered HTML via includeRendered+siteUrl.",
      inputSchema: qualitykitAuditInputSchema,
    },
    qualitykitAudit,
  );

  server.registerTool(
    "qualitykit.ai_audit",
    {
      title: "QualityKit AI audit",
      description:
        "AI discoverability audit: crawlability, extractability, entity clarity, citation readiness, structured understanding, topical coverage. Heuristic scores with evidence — no citation guarantees.",
      inputSchema: qualitykitAiAuditInputSchema,
    },
    qualitykitAiAudit,
  );

  server.registerTool(
    "qualitykit.plan",
    {
      title: "QualityKit plan",
      description:
        "Content and architecture opportunities: briefs, blog scaffold plan, schema, internal links. Advise-only.",
      inputSchema: qualitykitPlanInputSchema,
    },
    qualitykitPlan,
  );

  server.registerTool(
    "qualitykit.fix",
    {
      title: "QualityKit fix (advise-only)",
      description:
        "Generate unified diffs / file specs for selected findings. Never writes the repo. Use safeAutoOnly for low-risk technical fixes.",
      inputSchema: qualitykitFixInputSchema,
    },
    qualitykitFix,
  );

  server.registerTool(
    "qualitykit.verify",
    {
      title: "QualityKit verify",
      description:
        "Re-audit after changes or against proposedFiles. Reports fixed, remaining, and regressed finding IDs.",
      inputSchema: qualitykitVerifyInputSchema,
    },
    qualitykitVerify,
  );

  server.registerTool(
    "monitor.status",
    {
      title: "Hosted monitor status",
      description:
        "Fetch latest QualityKit Cloud monitoring run when QUALITYKIT_API_KEY is set. Otherwise returns self_hosted / not_run coverage (free local mode).",
      inputSchema: monitorStatusInputSchema,
    },
    monitorStatus,
  );

  server.registerTool(
    "visibility.report",
    {
      title: "Visibility report (stub)",
      description:
        "Placeholder for Search Console / AI visibility (Phase 3+). Always returns not_connected for now.",
      inputSchema: visibilityReportInputSchema,
    },
    visibilityReport,
  );

  // Secondary / specialized tools
  server.registerTool(
    "codebase.analyze",
    {
      title: "Analyze codebase",
      description:
        "Secondary: detect framework, router, routes, metadata, robots, sitemap, blog, business hints. Prefer qualitykit.audit for full audits.",
      inputSchema: analyzeInputSchema,
    },
    codebaseAnalyze,
  );

  server.registerTool(
    "seo.audit",
    {
      title: "SEO technical audit",
      description:
        "Secondary alias of the audit engine. Prefer qualitykit.audit.",
      inputSchema: auditInputSchema,
    },
    seoAudit,
  );

  server.registerTool(
    "seo.plan_changes",
    {
      title: "Plan SEO changes",
      description:
        "Secondary: technical SEO file specs. Prefer qualitykit.fix / qualitykit.plan.",
      inputSchema: planChangesInputSchema,
    },
    seoPlanChanges,
  );

  server.registerTool(
    "blog.scaffold",
    {
      title: "Scaffold blog architecture",
      description:
        "Specialized: App Router + MDX blog file specs when justified. Prefer qualitykit.plan first.",
      inputSchema: blogScaffoldInputSchema,
    },
    blogScaffold,
  );

  server.registerTool(
    "schema.plan",
    {
      title: "Plan structured data",
      description:
        "Specialized: Organization/WebSite/BlogPosting JSON-LD plans. No sitewide FAQ schema.",
      inputSchema: schemaPlanInputSchema,
    },
    schemaPlan,
  );

  server.registerTool(
    "links.plan",
    {
      title: "Plan internal links",
      description:
        "Specialized: contextual internal-link suggestions.",
      inputSchema: linksPlanInputSchema,
    },
    linksPlan,
  );

  server.registerTool(
    "content.brief",
    {
      title: "Create content briefs",
      description:
        "Specialized: at most three content briefs. Prefer qualitykit.plan.",
      inputSchema: contentBriefInputSchema,
    },
    contentBrief,
  );

  server.registerTool(
    "seo.validate",
    {
      title: "Validate SEO changes",
      description:
        "Specialized validation of project or proposed files. Prefer qualitykit.verify for finding-level verification.",
      inputSchema: validateInputSchema,
    },
    seoValidate,
  );

  for (const rule of RULE_RESOURCES) {
    server.registerResource(
      rule.name,
      rule.uri,
      {
        description: rule.description,
        mimeType: rule.mimeType,
      },
      async (uri) => {
        const match = getRuleByUri(uri.href) ?? rule;
        return {
          contents: [
            {
              uri: match.uri,
              mimeType: match.mimeType,
              text: match.text,
            },
          ],
        };
      },
    );
  }

  server.registerPrompt(
    "audit-site",
    {
      title: "Audit site for SEO and AEO",
      description:
        "Workflow: qualitykit.audit → ai_audit → plan → present backlog → fix diffs → apply approved → verify.",
      argsSchema: {
        projectRoot: z
          .string()
          .describe("Absolute path to the website repository"),
        siteUrl: z
          .string()
          .optional()
          .describe("Canonical site origin; fetch only if includeRendered"),
      },
    },
    ({ projectRoot, siteUrl }) => ({
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: [
              "You are using QualityKit, a read-only SEO + AEO MCP.",
              "It never writes files. You apply approved diffs and open the PR.",
              "",
              `Project root: ${projectRoot}`,
              siteUrl
                ? `Site URL: ${siteUrl}`
                : "Site URL: (optional; only fetch when includeRendered=true)",
              "",
              "Workflow:",
              "1. Call qualitykit.audit (optionally includeRendered with siteUrl)",
              "2. Call qualitykit.ai_audit",
              "3. Call qualitykit.plan",
              "4. Present defects first, then opportunities — use severity, impact, confidence, effort, fixSafety (no decimal scores)",
              "5. Call qualitykit.fix for approved finding IDs (safeAutoOnly for low-risk)",
              "6. Apply diffs yourself after user approval",
              "7. Call qualitykit.verify",
              "",
              "Rules:",
              "- Separate defects from opportunities (missing blog is not an error)",
              "- Do not mass-generate articles",
              "- Do not invent authors, stats, or competitor claims",
              "- Ask before changing AI crawler allow/disallow rules",
              "- Do not claim FAQ schema or llms.txt guarantee AI visibility",
              "- Do not claim ranking wins without measurement caveats",
              "- Read qualitykit://rules/technical-seo, qualitykit://rules/aeo, and qualitykit://rules/content when unsure",
            ].join("\n"),
          },
        },
      ],
    }),
  );

  return server;
}
