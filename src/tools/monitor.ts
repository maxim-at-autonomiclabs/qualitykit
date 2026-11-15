import { z } from "zod";
import { wrapReport } from "@qualitykit/engine";
import { errorResult, jsonResult } from "./helpers.js";

export const monitorStatusInputSchema = {
  apiBaseUrl: z
    .string()
    .url()
    .optional()
    .describe(
      "QualityKit Cloud API base URL (or set QUALITYKIT_API_BASE). Required to call a hosted API.",
    ),
  apiKey: z
    .string()
    .optional()
    .describe("Pro API key (or set QUALITYKIT_API_KEY env)"),
};

export function cloudCreds(args: { apiBaseUrl?: string; apiKey?: string }) {
  const apiKey = args.apiKey || process.env.QUALITYKIT_API_KEY;
  const base = args.apiBaseUrl || process.env.QUALITYKIT_API_BASE;
  return { apiKey, base };
}

/** Programmatic mark-applied for verify → ship bridge. */
export async function callMarkApplied(args: {
  apiBaseUrl?: string;
  apiKey?: string;
  changeIds?: string[];
  items?: Array<{ id: string; path?: string; query?: string }>;
  label?: string;
  alsoSiteBaseline?: boolean;
}): Promise<
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; error: string; missingCreds?: boolean }
> {
  const { apiKey, base } = cloudCreds(args);
  if (!apiKey || !base) {
    return {
      ok: false,
      missingCreds: true,
      error: !apiKey
        ? "No QUALITYKIT_API_KEY"
        : "No QUALITYKIT_API_BASE",
    };
  }
  try {
    const res = await fetch(`${base.replace(/\/$/, "")}/api/gsc/applied`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-qualitykit-key": apiKey,
      },
      body: JSON.stringify({
        changeIds: args.changeIds,
        items: args.items,
        label: args.label,
        alsoSiteBaseline: args.alsoSiteBaseline,
      }),
    });
    const data = (await res.json()) as Record<string, unknown>;
    if (!res.ok) {
      return {
        ok: false,
        error: String(data.error || `HTTP ${res.status}`),
      };
    }
    return { ok: true, data };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function monitorStatus(args: {
  apiBaseUrl?: string;
  apiKey?: string;
}) {
  try {
    const { apiKey, base } = cloudCreds(args);

    if (!apiKey || !base) {
      return jsonResult({
        ok: true,
        tool: "monitor.status",
        ...wrapReport({
          project: "local",
          mode: "self_hosted",
          coverage: {
            source: "not_run",
            rendered: "not_run",
            live: "not_run",
            searchData: "not_connected",
          },
          findings: [],
        }),
        message: !apiKey
          ? "No QUALITYKIT_API_KEY. Local MCP monitoring is self-hosted only. Upgrade at https://qualitykit.dev for daily hosted crawls."
          : "Set QUALITYKIT_API_BASE or pass apiBaseUrl to your QualityKit Cloud URL before monitor.status calls the hosted API.",
        upgradeUrl: "https://qualitykit.dev",
      });
    }

    const res = await fetch(`${base.replace(/\/$/, "")}/api/monitor/status`, {
      headers: { "x-qualitykit-key": apiKey },
    });
    const data = (await res.json()) as Record<string, unknown>;
    if (!res.ok) {
      return jsonResult(
        {
          ok: false,
          tool: "monitor.status",
          error: data.error || `HTTP ${res.status}`,
          upgradeUrl: data.upgradeUrl,
        },
        true,
      );
    }
    return jsonResult({ ok: true, tool: "monitor.status", ...data });
  } catch (error) {
    return errorResult(error);
  }
}

export const visibilityReportInputSchema = {
  apiBaseUrl: z
    .string()
    .url()
    .optional()
    .describe(
      "QualityKit Cloud API base URL (or set QUALITYKIT_API_BASE).",
    ),
  apiKey: z
    .string()
    .optional()
    .describe("Pro API key (or set QUALITYKIT_API_KEY env)"),
  period: z
    .enum(["7d", "28d", "90d", "365d"])
    .optional()
    .describe(
      "Comparison window ending yesterday UTC (default 28d). Prior window is the same length before that.",
    ),
  note: z.string().optional(),
};

export async function visibilityReport(args: {
  apiBaseUrl?: string;
  apiKey?: string;
  period?: "7d" | "28d" | "90d" | "365d";
  note?: string;
}) {
  try {
    const { apiKey, base } = cloudCreds(args);
    const period = args.period ?? "28d";

    if (!apiKey || !base) {
      return jsonResult({
        ok: true,
        tool: "visibility.report",
        ...wrapReport({
          project: "local",
          mode: "self_hosted",
          coverage: {
            source: "not_run",
            rendered: "not_run",
            live: "not_run",
            searchData: "not_connected",
          },
          findings: [],
        }),
        period,
        message: !apiKey
          ? "No QUALITYKIT_API_KEY. Connect Pro + Search Console at https://app.qualitykit.dev, then set QUALITYKIT_API_KEY and QUALITYKIT_API_BASE."
          : "Set QUALITYKIT_API_BASE (or pass apiBaseUrl) to call hosted Search Console visibility.",
        upgradeUrl: "https://qualitykit.dev",
      });
    }

    const url = new URL(`${base.replace(/\/$/, "")}/api/visibility`);
    url.searchParams.set("period", period);
    const res = await fetch(url.toString(), {
      headers: { "x-qualitykit-key": apiKey },
    });
    const data = (await res.json()) as Record<string, unknown>;
    if (!res.ok) {
      return jsonResult(
        {
          ok: false,
          tool: "visibility.report",
          error: data.error || `HTTP ${res.status}`,
          upgradeUrl: data.upgradeUrl,
        },
        true,
      );
    }

    const gsc = data.gsc as
      | {
          period?: {
            current?: { impressions?: number; clicks?: number };
            delta?: {
              impressions?: number;
              clicks?: number;
              impressionsPct?: number | null;
              clicksPct?: number | null;
            };
          };
        }
      | undefined;
    const growth = data.growth as
      | {
          period?: string;
          trend?: string;
          series?: Array<{ date: string; impressions: number; clicks: number }>;
          caveat?: string;
        }
      | undefined;
    const series = growth?.series ?? [];
    const seriesSummary =
      series.length > 0
        ? {
            days: series.length,
            start: series[0]?.date,
            end: series[series.length - 1]?.date,
            impressionsEnd: series[series.length - 1]?.impressions,
            clicksEnd: series[series.length - 1]?.clicks,
          }
        : null;

    return jsonResult({
      ok: true,
      tool: "visibility.report",
      ...data,
      period,
      growthSummary: {
        period: growth?.period ?? period,
        trend: growth?.trend ?? null,
        impressions: gsc?.period?.current?.impressions ?? null,
        clicks: gsc?.period?.current?.clicks ?? null,
        impressionsDelta: gsc?.period?.delta?.impressions ?? null,
        clicksDelta: gsc?.period?.delta?.clicks ?? null,
        impressionsPct: gsc?.period?.delta?.impressionsPct ?? null,
        clicksPct: gsc?.period?.delta?.clicksPct ?? null,
        seriesSummary,
        caveat: growth?.caveat,
      },
      note: args.note,
    });
  } catch (error) {
    return errorResult(error);
  }
}

/** Fetch ranked GSC opportunities for grow enrichment (null when offline). */
export async function fetchVisibilityOverlay(args: {
  apiBaseUrl?: string;
  apiKey?: string;
}): Promise<{
  searchData: string;
  rankedOpportunities: Array<Record<string, unknown>>;
} | null> {
  const { apiKey, base } = cloudCreds(args);
  if (!apiKey || !base) return null;
  try {
    const res = await fetch(`${base.replace(/\/$/, "")}/api/visibility`, {
      headers: { "x-qualitykit-key": apiKey },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      coverage?: { searchData?: string };
      rankedOpportunities?: Array<Record<string, unknown>>;
    };
    return {
      searchData: data.coverage?.searchData ?? "not_connected",
      rankedOpportunities: data.rankedOpportunities ?? [],
    };
  } catch {
    return null;
  }
}

export const visibilityMarkAppliedInputSchema = {
  apiBaseUrl: z
    .string()
    .url()
    .optional()
    .describe(
      "QualityKit Cloud API base URL (or set QUALITYKIT_API_BASE).",
    ),
  apiKey: z
    .string()
    .optional()
    .describe("Pro API key (or set QUALITYKIT_API_KEY env)"),
  changeIds: z
    .array(z.string())
    .optional()
    .describe(
      "Grow topChanges / GSC opportunity ids to snapshot. Omit to snapshot all current ranked opportunities.",
    ),
  items: z
    .array(
      z.object({
        id: z.string(),
        path: z.string().optional(),
        query: z.string().optional(),
      }),
    )
    .optional()
    .describe(
      "Optional explicit snapshots with path/query from qualitykit.grow topChanges (preferred when ids are grow page ids).",
    ),
  label: z.string().optional().describe("Label for this applied change set"),
  alsoSiteBaseline: z
    .boolean()
    .optional()
    .describe("Also save a site-wide GSC baseline (default true)"),
};

/**
 * After grow → fix → verify (and deploy), snapshot GSC metrics for those change ids
 * so later visibility.report can return per-change impression deltas.
 */
export async function visibilityMarkApplied(args: {
  apiBaseUrl?: string;
  apiKey?: string;
  changeIds?: string[];
  items?: Array<{ id: string; path?: string; query?: string }>;
  label?: string;
  alsoSiteBaseline?: boolean;
}) {
  try {
    const result = await callMarkApplied(args);
    if (!result.ok) {
      return jsonResult(
        {
          ok: false,
          tool: "visibility.mark_applied",
          error: result.missingCreds
            ? result.error.includes("API_KEY")
              ? "No QUALITYKIT_API_KEY. Connect Pro + Search Console at https://app.qualitykit.dev, mint an MCP API key, then set QUALITYKIT_API_KEY and QUALITYKIT_API_BASE."
              : "Set QUALITYKIT_API_BASE (or pass apiBaseUrl) to mark applied changes in Cloud."
            : result.error,
          upgradeUrl: "https://qualitykit.dev",
        },
        true,
      );
    }
    return jsonResult({
      ok: true,
      tool: "visibility.mark_applied",
      ...result.data,
      message:
        "Baselines saved for the listed changes. Call visibility.report after the next GSC sync (data often lags 1–3 days) to see per-change impression deltas. Deltas are correlational, not a ranking guarantee.",
    });
  } catch (error) {
    return errorResult(error);
  }
}
