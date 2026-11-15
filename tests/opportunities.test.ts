import { describe, expect, it } from "vitest";
import { slugifyPhrase } from "../src/grow/product-signals.js";
import {
  opportunitiesList,
  opportunitiesSync,
  opportunitiesUpdate,
} from "../src/tools/opportunities.js";

describe("slug alignment with Cloud slugifyPath", () => {
  it("slugifyPhrase max length is 48", () => {
    const long =
      "super long feature name that exceeds forty eight characters for sure and more";
    expect(slugifyPhrase(long).length).toBeLessThanOrEqual(48);
  });

  it("produces stable page-id style slugs for sample paths", () => {
    expect(slugifyPhrase("features/seo-audit")).toBe("features-seo-audit");
    expect(slugifyPhrase("/guides/Getting Started!")).toBe(
      "guides-getting-started",
    );
  });
});

describe("opportunities MCP stubs without credentials", () => {
  it("opportunities.list requires API key", async () => {
    delete process.env.QUALITYKIT_API_KEY;
    delete process.env.QUALITYKIT_API_BASE;
    const result = await opportunitiesList({});
    const payload = JSON.parse(result.content[0].text);
    expect(payload.ok).toBe(false);
    expect(payload.tool).toBe("opportunities.list");
    expect(payload.error).toMatch(/QUALITYKIT_API_KEY/);
    expect(payload.upgradeUrl).toMatch(/qualitykit\.dev/);
  });

  it("opportunities.update requires API key", async () => {
    delete process.env.QUALITYKIT_API_KEY;
    delete process.env.QUALITYKIT_API_BASE;
    const result = await opportunitiesUpdate({
      opportunityId: "page-feature-features-seo",
      status: "approved",
    });
    const payload = JSON.parse(result.content[0].text);
    expect(payload.ok).toBe(false);
    expect(payload.tool).toBe("opportunities.update");
    expect(payload.error).toMatch(/QUALITYKIT_API_KEY/);
  });

  it("opportunities.sync requires API key", async () => {
    delete process.env.QUALITYKIT_API_KEY;
    delete process.env.QUALITYKIT_API_BASE;
    const result = await opportunitiesSync({
      items: [{ id: "x", title: "t" }],
    });
    const payload = JSON.parse(result.content[0].text);
    expect(payload.ok).toBe(false);
    expect(payload.tool).toBe("opportunities.sync");
    expect(payload.error).toMatch(/QUALITYKIT_API_KEY/);
  });

  it("opportunities.list requires API base when only key is set", async () => {
    const prevKey = process.env.QUALITYKIT_API_KEY;
    const prevBase = process.env.QUALITYKIT_API_BASE;
    process.env.QUALITYKIT_API_KEY = "qk_test";
    delete process.env.QUALITYKIT_API_BASE;
    try {
      const result = await opportunitiesList({});
      const payload = JSON.parse(result.content[0].text);
      expect(payload.ok).toBe(false);
      expect(payload.error).toMatch(/QUALITYKIT_API_BASE/);
    } finally {
      if (prevKey === undefined) delete process.env.QUALITYKIT_API_KEY;
      else process.env.QUALITYKIT_API_KEY = prevKey;
      if (prevBase === undefined) delete process.env.QUALITYKIT_API_BASE;
      else process.env.QUALITYKIT_API_BASE = prevBase;
    }
  });
});
