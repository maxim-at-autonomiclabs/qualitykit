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

export async function monitorStatus(args: {
  apiBaseUrl?: string;
  apiKey?: string;
}) {
  try {
    const apiKey = args.apiKey || process.env.QUALITYKIT_API_KEY;
    const base = args.apiBaseUrl || process.env.QUALITYKIT_API_BASE;

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
  note: z.string().optional(),
};

export async function visibilityReport(_args: { note?: string }) {
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
    message:
      "AI visibility / Search Console connections ship in a later Pro phase. Not connected.",
  });
}
