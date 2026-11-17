import { z } from "zod";
import { runAuditEngine } from "../audit/engine.js";
import { buildGrowReport } from "../grow/impressions.js";
import { errorResult, jsonResult, loadSite } from "./helpers.js";

function cloudCreds(args: { apiBaseUrl?: string; apiKey?: string }) {
  const apiKey = args.apiKey || process.env.QUALITYKIT_API_KEY;
  const base = args.apiBaseUrl || process.env.QUALITYKIT_API_BASE;
  return { apiKey, base };
}

const statusEnum = z.enum(["found", "approved", "shipped", "snoozed"]);

export const opportunitiesListInputSchema = {
  apiBaseUrl: z.string().url().optional(),
  apiKey: z.string().optional(),
  status: statusEnum.or(z.literal("all")).optional(),
  source: z.enum(["grow", "gsc", "both", "all"]).optional(),
};

export async function opportunitiesList(args: {
  apiBaseUrl?: string;
  apiKey?: string;
  status?: string;
  source?: string;
}) {
  try {
    const { apiKey, base } = cloudCreds(args);
    if (!apiKey || !base) {
      return jsonResult(
        {
          ok: false,
          tool: "opportunities.list",
          error: !apiKey
            ? "No QUALITYKIT_API_KEY. Connect Pro at https://app.qualitykit.dev, then set QUALITYKIT_API_KEY and QUALITYKIT_API_BASE."
            : "Set QUALITYKIT_API_BASE (or pass apiBaseUrl) to list the Cloud opportunity backlog.",
          upgradeUrl: "https://qualitykit.dev",
        },
        true,
      );
    }
    const url = new URL(`${base.replace(/\/$/, "")}/api/opportunities`);
    if (args.status && args.status !== "all") {
      url.searchParams.set("status", args.status);
    }
    if (args.source && args.source !== "all") {
      url.searchParams.set("source", args.source);
    }
    const res = await fetch(url.toString(), {
      headers: { "x-qualitykit-key": apiKey },
    });
    const data = (await res.json()) as Record<string, unknown>;
    if (!res.ok) {
      return jsonResult(
        {
          ok: false,
          tool: "opportunities.list",
          error: data.error || `HTTP ${res.status}`,
        },
        true,
      );
    }
    return jsonResult({ ok: true, tool: "opportunities.list", ...data });
  } catch (error) {
    return errorResult(error);
  }
}

export const opportunitiesUpdateInputSchema = {
  apiBaseUrl: z.string().url().optional(),
  apiKey: z.string().optional(),
  opportunityId: z.string().describe("Stable opportunity id (grow or GSC id)"),
  status: statusEnum,
  snoozedUntil: z.string().datetime().optional(),
};

export async function opportunitiesUpdate(args: {
  apiBaseUrl?: string;
  apiKey?: string;
  opportunityId: string;
  status: "found" | "approved" | "shipped" | "snoozed";
  snoozedUntil?: string;
}) {
  try {
    const { apiKey, base } = cloudCreds(args);
    if (!apiKey || !base) {
      return jsonResult(
        {
          ok: false,
          tool: "opportunities.update",
          error: !apiKey
            ? "No QUALITYKIT_API_KEY. Connect Pro at https://app.qualitykit.dev."
            : "Set QUALITYKIT_API_BASE to update opportunity status in Cloud.",
          upgradeUrl: "https://qualitykit.dev",
        },
        true,
      );
    }
    const res = await fetch(
      `${base.replace(/\/$/, "")}/api/opportunities/${encodeURIComponent(args.opportunityId)}`,
      {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          "x-qualitykit-key": apiKey,
        },
        body: JSON.stringify({
          status: args.status,
          snoozedUntil: args.snoozedUntil,
        }),
      },
    );
    const data = (await res.json()) as Record<string, unknown>;
    if (!res.ok) {
      return jsonResult(
        {
          ok: false,
          tool: "opportunities.update",
          error: data.error || `HTTP ${res.status}`,
        },
        true,
      );
    }
    return jsonResult({ ok: true, tool: "opportunities.update", ...data });
  } catch (error) {
    return errorResult(error);
  }
}

export const opportunitiesSyncInputSchema = {
  projectRoot: z
    .string()
    .optional()
    .describe(
      "Absolute repo root — when set, runs local qualitykit.grow and syncs topChanges",
    ),
  siteUrl: z.string().url().optional(),
  apiBaseUrl: z.string().url().optional(),
  apiKey: z.string().optional(),
  items: z
    .array(
      z.object({
        id: z.string(),
        title: z.string(),
        kind: z.string().optional(),
        expectedImpact: z.string().optional(),
        confidence: z.string().optional(),
        effort: z.string().optional(),
        evidence: z.array(z.string()).optional(),
        page: z.object({ path: z.string().optional() }).optional(),
        path: z.string().optional(),
        query: z.string().optional(),
        impressions: z.number().optional(),
        clicks: z.number().optional(),
        position: z.number().optional(),
        action: z.string().optional(),
        suggestedFix: z.string().optional(),
      }),
    )
    .optional()
    .describe("Optional grow-like items; omit to grow from projectRoot or sync GSC only"),
  mergeGsc: z
    .boolean()
    .optional()
    .describe("Merge live GSC ranked opportunities (default true)"),
};

/** Push grow items (and/or live GSC ranks) into the Pro opportunity backlog. */
export async function opportunitiesSync(args: {
  projectRoot?: string;
  siteUrl?: string;
  apiBaseUrl?: string;
  apiKey?: string;
  items?: Array<Record<string, unknown>>;
  mergeGsc?: boolean;
}) {
  try {
    const { apiKey, base } = cloudCreds(args);
    if (!apiKey || !base) {
      return jsonResult(
        {
          ok: false,
          tool: "opportunities.sync",
          error: !apiKey
            ? "No QUALITYKIT_API_KEY. Connect Pro at https://app.qualitykit.dev to persist the opportunity backlog."
            : "Set QUALITYKIT_API_BASE to sync opportunities to Cloud.",
          upgradeUrl: "https://qualitykit.dev",
        },
        true,
      );
    }

    let items = args.items ?? [];
    if ((!items.length || args.projectRoot) && args.projectRoot) {
      const site = loadSite(args.projectRoot, args.siteUrl);
      const audit = runAuditEngine(site);
      const grow = buildGrowReport(site, audit.findings, []);
      items = grow.topChanges.map((c) => {
        const action =
          c.evidence.find((e) => e.startsWith("action="))?.slice("action=".length) ??
          (c.kind === "page" ? "create" : undefined);
        return {
          id: c.id,
          title: c.title,
          kind: c.kind,
          expectedImpact: c.expectedImpact,
          confidence: c.confidence,
          effort: c.effort,
          evidence: c.evidence,
          page: c.page ? { path: c.page.path } : undefined,
          suggestedFix: c.suggestedFix,
          action,
        };
      });
    }

    const res = await fetch(
      `${base.replace(/\/$/, "")}/api/opportunities/sync`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-qualitykit-key": apiKey,
        },
        body: JSON.stringify({
          items,
          mergeGsc: args.mergeGsc !== false,
        }),
      },
    );
    const data = (await res.json()) as Record<string, unknown>;
    if (!res.ok) {
      return jsonResult(
        {
          ok: false,
          tool: "opportunities.sync",
          error: data.error || `HTTP ${res.status}`,
        },
        true,
      );
    }
    return jsonResult({
      ok: true,
      tool: "opportunities.sync",
      ...data,
      message: `Synced backlog — found ${(data.byStatus as Record<string, number> | undefined)?.found ?? 0} open opportunities.`,
    });
  } catch (error) {
    return errorResult(error);
  }
}

/** Best-effort backlog upsert after grow when Cloud credentials are present. */
export async function syncGrowToBacklog(args: {
  apiBaseUrl?: string;
  apiKey?: string;
  items: Array<Record<string, unknown>>;
}): Promise<void> {
  const { apiKey, base } = cloudCreds(args);
  if (!apiKey || !base || !args.items.length) return;
  try {
    await fetch(`${base.replace(/\/$/, "")}/api/opportunities/sync`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-qualitykit-key": apiKey,
      },
      body: JSON.stringify({ items: args.items, mergeGsc: true }),
    });
  } catch {
    /* ignore — grow still succeeds offline */
  }
}
