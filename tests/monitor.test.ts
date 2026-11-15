import { describe, expect, it } from "vitest";
import {
  monitorStatus,
  visibilityMarkApplied,
  visibilityReport,
} from "../src/tools/monitor.js";

describe("monitor + visibility tools", () => {
  it("monitor.status returns self_hosted without API key", async () => {
    delete process.env.QUALITYKIT_API_KEY;
    const result = await monitorStatus({});
    const payload = JSON.parse(result.content[0].text);
    expect(payload.ok).toBe(true);
    expect(payload.schemaVersion).toBe("1.0");
    expect(payload.mode).toBe("self_hosted");
    expect(payload.coverage.live).toBe("not_run");
  });

  it("monitor.status does not call a default cloud host", async () => {
    const prevKey = process.env.QUALITYKIT_API_KEY;
    const prevBase = process.env.QUALITYKIT_API_BASE;
    process.env.QUALITYKIT_API_KEY = "qk_test";
    delete process.env.QUALITYKIT_API_BASE;
    try {
      const result = await monitorStatus({});
      const payload = JSON.parse(result.content[0].text);
      expect(payload.mode).toBe("self_hosted");
      expect(payload.message).toContain("QUALITYKIT_API_BASE");
    } finally {
      if (prevKey === undefined) delete process.env.QUALITYKIT_API_KEY;
      else process.env.QUALITYKIT_API_KEY = prevKey;
      if (prevBase === undefined) delete process.env.QUALITYKIT_API_BASE;
      else process.env.QUALITYKIT_API_BASE = prevBase;
    }
  });

  it("visibility.report is not_connected without cloud credentials", async () => {
    delete process.env.QUALITYKIT_API_KEY;
    delete process.env.QUALITYKIT_API_BASE;
    const result = await visibilityReport({});
    const payload = JSON.parse(result.content[0].text);
    expect(payload.coverage.searchData).toBe("not_connected");
    expect(payload.message).toMatch(/QUALITYKIT_API_KEY|Search Console/i);
  });

  it("visibility.report requires API base when only key is set", async () => {
    const prevKey = process.env.QUALITYKIT_API_KEY;
    const prevBase = process.env.QUALITYKIT_API_BASE;
    process.env.QUALITYKIT_API_KEY = "qk_test";
    delete process.env.QUALITYKIT_API_BASE;
    try {
      const result = await visibilityReport({});
      const payload = JSON.parse(result.content[0].text);
      expect(payload.coverage.searchData).toBe("not_connected");
      expect(payload.message).toContain("QUALITYKIT_API_BASE");
    } finally {
      if (prevKey === undefined) delete process.env.QUALITYKIT_API_KEY;
      else process.env.QUALITYKIT_API_KEY = prevKey;
      if (prevBase === undefined) delete process.env.QUALITYKIT_API_BASE;
      else process.env.QUALITYKIT_API_BASE = prevBase;
    }
  });

  it("visibility.mark_applied requires cloud credentials", async () => {
    delete process.env.QUALITYKIT_API_KEY;
    delete process.env.QUALITYKIT_API_BASE;
    const result = await visibilityMarkApplied({
      changeIds: ["gsc-query-seo-mcp"],
    });
    const payload = JSON.parse(result.content[0].text);
    expect(payload.ok).toBe(false);
    expect(payload.tool).toBe("visibility.mark_applied");
    expect(payload.error).toMatch(/QUALITYKIT_API_KEY/);
  });

  it("visibility.mark_applied requires API base when only key is set", async () => {
    const prevKey = process.env.QUALITYKIT_API_KEY;
    const prevBase = process.env.QUALITYKIT_API_BASE;
    process.env.QUALITYKIT_API_KEY = "qk_test";
    delete process.env.QUALITYKIT_API_BASE;
    try {
      const result = await visibilityMarkApplied({});
      const payload = JSON.parse(result.content[0].text);
      expect(payload.ok).toBe(false);
      expect(payload.error).toContain("QUALITYKIT_API_BASE");
    } finally {
      if (prevKey === undefined) delete process.env.QUALITYKIT_API_KEY;
      else process.env.QUALITYKIT_API_KEY = prevKey;
      if (prevBase === undefined) delete process.env.QUALITYKIT_API_BASE;
      else process.env.QUALITYKIT_API_BASE = prevBase;
    }
  });
});
