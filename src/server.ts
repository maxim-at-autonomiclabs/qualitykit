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
  qualitykitGrow,
  qualitykitGrowInputSchema,
} from "./tools/qualitykit-grow.js";
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
  visibilityMarkApplied,
  visibilityMarkAppliedInputSchema,
  visibilityReport,
  visibilityReportInputSchema,
} from "./tools/monitor.js";
import {
  opportunitiesList,
  opportunitiesListInputSchema,
  opportunitiesSync,
  opportunitiesSyncInputSchema,
  opportunitiesUpdate,
  opportunitiesUpdateInputSchema,
} from "./tools/opportunities.js";
import {
  getSiteProfileInputSchema,
  qualitykitGetSiteProfile,
  qualitykitRefreshSiteProfile,
  qualitykitUpdateSiteProfile,
  refreshSiteProfileInputSchema,
  updateSiteProfileInputSchema,
} from "./tools/site-profile.js";
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
    "qualitykit.grow",
    {
      title: "QualityKit grow impressions",
      description:
        "Brand-aligned growth: score Search Console queries against the Site Profile, return top opportunities and deprioritised demand, with safe vs approval fixes. Uses Cloud GSC + profile when API key is set.",
      inputSchema: qualitykitGrowInputSchema,
    },
    qualitykitGrow,
  );

  server.registerTool(
    "qualitykit.get_site_profile",
    {
      title: "Get Site Profile",
      description:
        "Return the approved Site Profile (brand, ICP, products, voice, pages, keyword relevance), confidence, and freshness. Ephemeral repo draft when Cloud is not connected.",
      inputSchema: getSiteProfileInputSchema,
    },
    qualitykitGetSiteProfile,
  );

  server.registerTool(
    "qualitykit.refresh_site_profile",
    {
      title: "Refresh Site Profile",
      description:
        "Prefer Cloud model refresh when Pro + MODEL_* are configured (stale fields only; material stays pending). Offline: returns a host-agent brief from repo evidence.",
      inputSchema: refreshSiteProfileInputSchema,
    },
    qualitykitRefreshSiteProfile,
  );

  server.registerTool(
    "qualitykit.update_site_profile",
    {
      title: "Update Site Profile",
      description:
        "Apply a partial Site Profile patch. Brand identity, ICP, and products stay pendingApproval until approveMaterial or approvePending. Persists to Cloud when API key is set.",
      inputSchema: updateSiteProfileInputSchema,
    },
    qualitykitUpdateSiteProfile,
  );

  server.registerTool(
    "qualitykit.fix",
    {
      title: "QualityKit fix (advise-only)",
      description:
        "Technical findings → unified diffs/FileSpecs. page-* / gsc-query-* opportunityIds → buildContracts for the host agent (no invented page files). Never writes the repo. Use safeAutoOnly for low-risk technical fixes only.",
      inputSchema: qualitykitFixInputSchema,
    },
    qualitykitFix,
  );

  server.registerTool(
    "qualitykit.verify",
    {
      title: "QualityKit verify",
      description:
        "Re-audit after changes or against proposedFiles. Checks finding IDs and optional opportunityIds (route presence). Returns readyToShip; with Pro credentials, records mark_applied / shipped.",
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
        "Search Console growth via QualityKit Cloud when QUALITYKIT_API_KEY + QUALITYKIT_API_BASE are set. Pass period 7d|28d|90d|365d for % deltas, trend, series summary, ranked opportunities, and changeOutcomes. Otherwise not_connected stub.",
      inputSchema: visibilityReportInputSchema,
    },
    visibilityReport,
  );

  server.registerTool(
    "visibility.mark_applied",
    {
      title: "Mark GSC recommendations applied",
      description:
        "After grow → fix → verify (and deploy), snapshot Search Console metrics for grow topChanges ids so later visibility.report shows per-change impression deltas. Requires QUALITYKIT_API_KEY + QUALITYKIT_API_BASE. GSC data often lags 1–3 days.",
      inputSchema: visibilityMarkAppliedInputSchema,
    },
    visibilityMarkApplied,
  );

  server.registerTool(
    "opportunities.list",
    {
      title: "List opportunity backlog",
      description:
        "Pro: list persisted grow/GSC opportunities (found|approved|shipped|snoozed). Requires QUALITYKIT_API_KEY + QUALITYKIT_API_BASE.",
      inputSchema: opportunitiesListInputSchema,
    },
    opportunitiesList,
  );

  server.registerTool(
    "opportunities.update",
    {
      title: "Update opportunity status",
      description:
        "Pro: set opportunity status to found|approved|shipped|snoozed (snooze defaults to 7 days). Requires QUALITYKIT_API_KEY + QUALITYKIT_API_BASE.",
      inputSchema: opportunitiesUpdateInputSchema,
    },
    opportunitiesUpdate,
  );

  server.registerTool(
    "opportunities.sync",
    {
      title: "Sync opportunity backlog",
      description:
        "Pro: upsert grow topChanges and/or live GSC ranked opportunities into the Cloud backlog. Pass projectRoot to run local grow, or items. Returns counts by status (found N). Requires QUALITYKIT_API_KEY + QUALITYKIT_API_BASE.",
      inputSchema: opportunitiesSyncInputSchema,
    },
    opportunitiesSync,
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
        "Workflow: qualitykit.audit → grow → optional plan → fix diffs → apply approved → verify.",
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
              "It never writes files. You apply approved diffs in the working tree after the user confirms.",
              "",
              `Project root: ${projectRoot}`,
              siteUrl
                ? `Site URL: ${siteUrl}`
                : "Site URL: (optional; only fetch when includeRendered=true)",
              "",
              "Workflow:",
              "1. Call qualitykit.get_site_profile (or refresh_site_profile if stale/empty) and confirm brand/ICP with the user via update_site_profile (approveMaterial)",
              "2. Call qualitykit.audit (optionally includeRendered with siteUrl)",
              "3. Call qualitykit.grow — brand-fit scored opportunities, deprioritised queries, safe vs approval",
              "4. Optionally call qualitykit.ai_audit and qualitykit.plan for briefs/schema/links",
              "5. Present defects, opportunities, and deprioritised demand — optimise for relevant demand, not maximum keywords",
              "6. Call qualitykit.fix: finding IDs → diffs (safeAutoOnly for low-risk); page-* / gsc ids → buildContracts (skip irrelevant ids)",
              "7. Apply technical diffs and implement buildContracts yourself after user approval — match existing project patterns and Site Profile voice",
              "8. Call qualitykit.verify with findingIds and/or opportunityIds — readyToShip; with Pro key this can mark_applied",
              "9. After grow (Pro): opportunities.sync (or rely on grow auto-sync) so the dashboard backlog shows found N",
              "10. If verify did not ship: visibility.mark_applied with readyToShip ids (include path/query) — ships backlog rows",
              "11. Later: visibility.report / opportunities.list for period metrics, profile freshness, and backlog status (GSC lags ~1–3 days; deltas are correlational)",
              "",
              "Rules:",
              "- Separate defects from opportunities (missing blog is not an error)",
              "- If indexability is blocked, fix robots before recommending new pages",
              "- Do not mass-generate articles",
              "- Do not invent authors, stats, keyword volumes, or competitor claims",
              "- Do not rewrite ICP or brand positioning from Search Console impressions without user approval",
              "- Ask before changing AI crawler allow/disallow rules",
              "- Do not claim FAQ schema or llms.txt guarantee AI visibility",
              "- Do not claim causal ranking or impression guarantees from changeOutcomes",
              "- Read qualitykit://rules/technical-seo, qualitykit://rules/aeo, and qualitykit://rules/content when unsure",
            ].join("\n"),
          },
        },
      ],
    }),
  );

  return server;
}
