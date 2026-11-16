import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { analyzeProject } from "../src/adapters/index.js";
import { runAuditEngine } from "../src/audit/engine.js";
import {
  pathFromPageOpportunityId,
  toBuildContract,
} from "../src/grow/build-contract.js";
import { buildGrowReport } from "../src/grow/impressions.js";
import { readProjectFiles } from "../src/project/read.js";
import { qualitykitFix } from "../src/tools/qualitykit-fix.js";
import { qualitykitVerify } from "../src/tools/qualitykit-verify.js";

const fixturesRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../fixtures",
);

function load(name: string) {
  const root = path.join(fixturesRoot, name);
  const files = readProjectFiles(root);
  return {
    root,
    site: analyzeProject(files, { siteUrl: "https://example.com" }, root),
  };
}

describe("toBuildContract", () => {
  it("builds feature and guide outlines from page ids", () => {
    const feature = toBuildContract({
      id: "page-feature-features-seo-audit",
      title: "Feature: SEO audit",
      kind: "page",
      path: "/features/seo-audit",
      intent: "feature",
      suggestedFix: "Create /features/seo-audit",
    });
    expect(feature.kind).toBe("page");
    expect(feature.path).toBe("/features/seo-audit");
    expect(feature.outline.length).toBeGreaterThan(2);
    expect(feature.acceptance.some((a) => a.includes("/features/seo-audit"))).toBe(
      true,
    );
    expect(feature.constraints.join(" ")).toMatch(/does not write files/i);

    const guide = toBuildContract({
      id: "page-guide-guides-getting-started",
      intent: "guide",
      path: "/guides/getting-started",
    });
    expect(guide.intent).toBe("guide");
    expect(guide.outline.join(" ")).toMatch(/how-to/i);
  });

  it("builds query contracts for gsc-query ids", () => {
    const q = toBuildContract({
      id: "gsc-query-seo-mcp",
      kind: "query",
      query: "seo mcp",
    });
    expect(q.kind).toBe("query");
    expect(q.query).toBe("seo mcp");
    expect(q.outline.join(" ")).toMatch(/seo mcp/i);
    expect(q.path).toBeUndefined();
  });

  it("recovers path from page opportunity id slug", () => {
    expect(pathFromPageOpportunityId("page-feature-features-seo-audit")).toBe(
      "/features/seo-audit",
    );
    expect(pathFromPageOpportunityId("page-guide-guides-getting-started")).toBe(
      "/guides/getting-started",
    );
  });
});

describe("qualitykit.fix opportunity handoff", () => {
  it("still emits technical diffs for finding ids", async () => {
    const { root } = load("bare-app");
    const result = await qualitykitFix({
      projectRoot: root,
      siteUrl: "https://example.com",
      findingIds: ["missing-robots"],
      safeAutoOnly: true,
    });
    const payload = JSON.parse(result.content[0].text);
    expect(payload.ok).toBe(true);
    expect(payload.diffs.length).toBeGreaterThan(0);
    expect(payload.buildContracts ?? []).toEqual([]);
  });

  it("emits buildContracts for page-* without create FileSpecs", async () => {
    const { root, site } = load("bare-app");
    const audit = runAuditEngine(site);
    const grow = buildGrowReport(site, audit.findings);
    const page = grow.topChanges.find((c) => c.kind === "page");
    expect(page).toBeTruthy();

    const result = await qualitykitFix({
      projectRoot: root,
      siteUrl: "https://example.com",
      opportunityIds: [page!.id],
    });
    const payload = JSON.parse(result.content[0].text);
    expect(payload.ok).toBe(true);
    expect(payload.buildContracts).toHaveLength(1);
    expect(payload.buildContracts[0].opportunityId).toBe(page!.id);
    expect(payload.buildContracts[0].path).toBe(page!.page!.path);
    expect(
      (payload.diffs as Array<{ path?: string }>).every(
        (d) => !d.path?.includes(page!.page!.path.replace(/^\//, "")),
      ),
    ).toBe(true);
  });

  it("skips page contracts when safeAutoOnly", async () => {
    const { root, site } = load("bare-app");
    const audit = runAuditEngine(site);
    const grow = buildGrowReport(site, audit.findings);
    const page = grow.topChanges.find((c) => c.kind === "page");
    expect(page).toBeTruthy();

    const result = await qualitykitFix({
      projectRoot: root,
      siteUrl: "https://example.com",
      opportunityIds: [page!.id],
      safeAutoOnly: true,
    });
    const payload = JSON.parse(result.content[0].text);
    expect(payload.buildContracts).toEqual([]);
    expect(payload.skipped.some((s: { id: string }) => s.id === page!.id)).toBe(
      true,
    );
  });

  it("emits query buildContract for on-brand gsc-query ids when user continues", async () => {
    const { root } = load("bare-app");
    const result = await qualitykitFix({
      projectRoot: root,
      siteUrl: "https://example.com",
      // Fits Acme Analytics draft profile; continueDespiteStaleProfile allows create
      // while Site Profile is still an ephemeral unstored draft.
      opportunityIds: ["gsc-query-product-analytics"],
      continueDespiteStaleProfile: true,
    });
    const payload = JSON.parse(result.content[0].text);
    expect(payload.buildContracts).toHaveLength(1);
    expect(payload.buildContracts[0].kind).toBe("query");
    expect(payload.diffs).toEqual([]);
  });

  it("skips irrelevant gsc-query ids without a build contract", async () => {
    const { root } = load("bare-app");
    const result = await qualitykitFix({
      projectRoot: root,
      siteUrl: "https://example.com",
      opportunityIds: ["gsc-query-free-excel-templates"],
      continueDespiteStaleProfile: true,
    });
    const payload = JSON.parse(result.content[0].text);
    expect(payload.buildContracts).toEqual([]);
    expect(
      payload.skipped.some(
        (s: { id: string; reason: string }) =>
          s.id === "gsc-query-free-excel-templates" &&
          /irrelevant|Brand-fit/i.test(s.reason),
      ),
    ).toBe(true);
  });

  it("does not dump unrelated diffs when explicit findingIds miss", async () => {
    const websiteRoot = path.resolve(fixturesRoot, "../website");
    const result = await qualitykitFix({
      projectRoot: websiteRoot,
      siteUrl: "https://qualitykit.dev",
      findingIds: ["missing-robots"],
      safeAutoOnly: true,
    });
    const payload = JSON.parse(result.content[0].text);
    expect(payload.diffs).toEqual([]);
    expect(
      payload.skipped.some(
        (s: { id: string; reason: string }) =>
          s.id === "missing-robots" && /not present/i.test(s.reason),
      ),
    ).toBe(true);
  });

  it("annotates static-site page contracts for HTML files", async () => {
    const websiteRoot = path.resolve(fixturesRoot, "../website");
    const site = analyzeProject(
      readProjectFiles(websiteRoot),
      { siteUrl: "https://qualitykit.dev" },
      websiteRoot,
    );
    const audit = runAuditEngine(site);
    const grow = buildGrowReport(site, audit.findings);
    const page = grow.topChanges.find((c) => c.kind === "page");
    expect(page).toBeTruthy();

    const result = await qualitykitFix({
      projectRoot: websiteRoot,
      siteUrl: "https://qualitykit.dev",
      opportunityIds: [page!.id],
    });
    const payload = JSON.parse(result.content[0].text);
    expect(payload.buildContracts).toHaveLength(1);
    expect(payload.diffs).toEqual([]);
    expect(
      payload.buildContracts[0].constraints.join(" "),
    ).toMatch(/static html/i);
    expect(payload.buildContracts[0].suggestedFix).toMatch(/index\.html/i);
  });
});

describe("qualitykit.verify opportunity routes", () => {
  it("reports missing page route and readyToShip without shipping offline", async () => {
    delete process.env.QUALITYKIT_API_KEY;
    delete process.env.QUALITYKIT_API_BASE;
    const { root, site } = load("bare-app");
    const audit = runAuditEngine(site);
    const grow = buildGrowReport(site, audit.findings);
    const page = grow.topChanges.find((c) => c.kind === "page");
    expect(page).toBeTruthy();

    const result = await qualitykitVerify({
      projectRoot: root,
      siteUrl: "https://example.com",
      opportunityIds: [page!.id],
      markApplied: true,
    });
    const payload = JSON.parse(result.content[0].text);
    expect(payload.ok).toBe(true);
    expect(payload.pageResults[0].present).toBe(false);
    expect(payload.readyToShip).toEqual([]);
    expect(payload.shipped).toBeNull();
  });

  it("marks page present via proposedFiles path map", async () => {
    delete process.env.QUALITYKIT_API_KEY;
    delete process.env.QUALITYKIT_API_BASE;
    const { root } = load("bare-app");
    const oppId = "page-feature-features-seo-audit";
    const result = await qualitykitVerify({
      projectRoot: root,
      siteUrl: "https://example.com",
      opportunityIds: [oppId],
      paths: { [oppId]: "/features/seo-audit" },
      proposedFiles: [
        {
          path: "app/features/seo-audit/page.tsx",
          content: `export default function Page() { return <main><h1>SEO audit</h1></main>; }\n`,
        },
      ],
      markApplied: true,
    });
    const payload = JSON.parse(result.content[0].text);
    expect(payload.pageResults[0].present).toBe(true);
    expect(payload.readyToShip).toContain(oppId);
    expect(payload.shipped).toBeNull();
    expect(payload.notes.join(" ")).toMatch(/mark_applied|QUALITYKIT_API/i);
  });
});
