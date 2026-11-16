import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { analyzeProject } from "../src/adapters/index.js";
import { runAuditEngine } from "../src/audit/engine.js";
import { buildGrowReport } from "../src/grow/impressions.js";
import { readProjectFiles } from "../src/project/read.js";
import { qualitykitGrow } from "../src/tools/qualitykit-grow.js";

const fixturesRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../fixtures",
);

function load(name: string) {
  const root = path.join(fixturesRoot, name);
  const files = readProjectFiles(root);
  return { root, site: analyzeProject(files, { siteUrl: "https://example.com" }, root) };
}

function parseToolPayload(result: { content: Array<{ type: string; text?: string }> }) {
  const text = result.content[0]?.text;
  expect(text).toBeTruthy();
  return JSON.parse(text!) as Record<string, unknown>;
}

describe("qualitykit.grow impressions mode", () => {
  it("ranks indexability and unverified page ideas for a bare App Router site", () => {
    const { site } = load("bare-app");
    const audit = runAuditEngine(site);
    const grow = buildGrowReport(site, audit.findings);

    expect(grow.indexabilityBlocked).toBe(false);
    expect(grow.topChanges.length).toBeGreaterThan(0);
    expect(grow.topChanges.length).toBeLessThanOrEqual(10);

    const pageChanges = grow.topChanges.filter((c) => c.kind === "page");
    expect(pageChanges.length).toBeGreaterThan(0);
    for (const page of pageChanges) {
      expect(page.page?.demand).toBe("unverified");
      expect(page.fixSafety).toBe("approval");
      expect(page.page?.path).toMatch(/^\/(features|solutions|compare|tools|guides)\//);
      expect(page.page?.path).not.toMatch(/ai-audit-mode-qualitykit/);
    }

    expect(grow.safeToImplement.every((c) => c.fixSafety === "auto")).toBe(true);
    expect(
      grow.safeToImplement.every((c) =>
        audit.findings.some((f) => f.id === c.findingId && f.fixSafety === "auto"),
      ),
    ).toBe(true);

    const serialized = JSON.stringify(grow);
    expect(serialized).not.toMatch(/impressionCount|keywordVolume|"volume":\s*\d/i);
    expect(serialized).not.toMatch(/\b\d{3,}\s*impressions\b/i);
  });

  it("recommends product-shaped pages for the QualityKit marketing site", () => {
    const root = path.resolve(fixturesRoot, "../website");
    const files = readProjectFiles(root);
    const site = analyzeProject(
      files,
      { siteUrl: "https://qualitykit.dev" },
      root,
    );
    expect(site.metadata.rootTitle).toMatch(/QualityKit/i);
    expect(site.metadata.rootTitle).not.toMatch(/^AI Audit Mode/i);

    // Site already ships intent hubs from the audit-site loop
    const existing = site.routes.map((r) => r.path);
    expect(existing.some((p) => p.includes("/features/"))).toBe(true);
    expect(existing.some((p) => p.includes("/solutions/"))).toBe(true);

    const audit = runAuditEngine(site);
    const grow = buildGrowReport(site, audit.findings);
    const paths = grow.topChanges
      .filter((c) => c.kind === "page")
      .map((c) => c.page!.path);

    // Remaining suggestions stay product-shaped (no calculator / fake brand)
    expect(paths.join("\n")).not.toMatch(/ai-audit-mode-qualitykit/i);
    expect(paths.every((p) => !p.includes("calculator"))).toBe(true);
    for (const p of paths) {
      expect(p).toMatch(/^\/(features|solutions|compare|tools|guides)\//);
    }
  });

  it("puts robots-blocks-all first and suppresses new landing pages", () => {
    const { site } = load("robots-blocked");
    expect(site.robots.blocksAll).toBe(true);
    const audit = runAuditEngine(site);
    expect(audit.findings.some((f) => f.id === "robots-blocks-all")).toBe(true);

    const grow = buildGrowReport(site, audit.findings);
    expect(grow.indexabilityBlocked).toBe(true);
    expect(grow.topChanges[0]?.id).toBe("robots-blocks-all");
    expect(grow.topChanges.every((c) => c.kind !== "page")).toBe(true);
    expect(grow.topChanges.every((c) => c.id !== "no-blog")).toBe(true);

    const indexability = grow.why.find((d) => d.id === "indexability");
    expect(indexability?.status).toBe("blocking");
  });

  it("does not recommend a duplicate blog when a blog already exists", () => {
    const { site } = load("with-blog");
    expect(site.blog.present).toBe(true);
    const audit = runAuditEngine(site);
    const grow = buildGrowReport(site, audit.findings);

    expect(grow.topChanges.every((c) => c.id !== "no-blog")).toBe(true);
    expect(
      grow.topChanges.every(
        (c) =>
          c.page?.path !== "/blog" &&
          !(c.page?.path ?? "").startsWith("/blog/") &&
          !c.id.includes("blog-scaffold"),
      ),
    ).toBe(true);
  });

  it("returns searchData not_connected from the MCP tool", async () => {
    const { root } = load("bare-app");
    const result = await qualitykitGrow({ projectRoot: root });
    const payload = parseToolPayload(result);

    expect(payload.ok).toBe(true);
    expect(payload.tool).toBe("qualitykit.grow");
    expect((payload.coverage as { searchData: string }).searchData).toBe(
      "not_connected",
    );
    expect(Array.isArray(payload.topChanges)).toBe(true);
    expect((payload.topChanges as unknown[]).length).toBeLessThanOrEqual(10);
    expect(Array.isArray(payload.opportunities)).toBe(true);
    expect(Array.isArray(payload.deprioritised)).toBe(true);
    expect(payload.profile).toMatchObject({
      stored: false,
      status: expect.stringMatching(/fresh|stale/),
    });
    expect(JSON.stringify(payload)).not.toMatch(/"impressions"\s*:\s*\d+/);
  });
});
