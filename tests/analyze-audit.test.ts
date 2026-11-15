import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { analyzeProject } from "../src/adapters/index.js";
import { nextjsAdapter } from "../src/adapters/nextjs/index.js";
import { runAuditEngine } from "../src/audit/engine.js";
import { sortFindings } from "../src/model/finding.js";
import { scorePriority } from "../src/model/site.js";
import { readProjectFiles } from "../src/project/read.js";

const fixturesRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../fixtures",
);

function load(name: string) {
  const root = path.join(fixturesRoot, name);
  const files = readProjectFiles(root);
  return analyzeProject(files, { siteUrl: "https://example.com" }, root);
}

describe("codebase analyze + seo audit", () => {
  it("reclassifies bare App Router findings as defects vs opportunities", () => {
    const site = load("bare-app");
    expect(site.framework).toBe("nextjs");
    expect(site.router).toBe("app");

    const audit = runAuditEngine(site);
    expect(audit.routeInventory.length).toBeGreaterThan(0);

    const robots = audit.findings.find((f) => f.id === "missing-robots");
    expect(robots?.kind).toBe("opportunity");
    expect(robots?.severity).not.toBe("high");
    expect(robots?.severity).not.toBe("critical");

    const sitemap = audit.findings.find((f) => f.id === "missing-sitemap");
    expect(sitemap?.kind).toBe("defect");
    expect(sitemap?.severity).toBe("medium");

    const meta = audit.findings.find((f) => f.id === "missing-metadatabase");
    expect(meta?.kind).toBe("defect");
    expect(meta?.severity).toBe("medium");

    const blog = audit.findings.find((f) => f.id === "no-blog");
    expect(blog?.kind).toBe("opportunity");

    expect(audit.summary.critical).toBe(0);
    expect(audit.summary.high).toBe(0);
    expect(audit.findings.every((f) => f.whyItMatters && f.suggestedFix)).toBe(
      true,
    );
    expect(JSON.stringify(audit.findings)).not.toMatch(/"priority":\s*\d+\.\d+/);

    const plan = nextjsAdapter.planTechnicalFixes(site);
    expect(plan.some((r) => r.id === "tech-robots")).toBe(true);
    expect(plan.some((r) => r.id === "tech-sitemap")).toBe(true);
  });

  it("detects existing blog and refuses duplicate scaffold", () => {
    const site = load("with-blog");
    expect(site.blog.present).toBe(true);
    const blogPlan = nextjsAdapter.planBlog(site, {});
    expect(blogPlan.some((r) => r.id === "blog-already-exists")).toBe(true);
    expect(blogPlan.some((r) => r.id === "blog-scaffold-mdx")).toBe(false);
  });

  it("detects Pages Router and blocks blog scaffold", () => {
    const site = load("pages-router");
    expect(site.router).toBe("pages");
    const blogPlan = nextjsAdapter.planBlog(site, {});
    expect(
      blogPlan.some((r) => r.id === "blog-unsupported-pages-router"),
    ).toBe(true);
    const audit = runAuditEngine(site);
    expect(audit.findings.some((f) => f.id === "pages-router")).toBe(true);
  });

  it("falls back to generic adapter for non-Next projects", () => {
    const site = load("generic-site");
    expect(site.framework).toBe("generic");
    expect(site.unsupportedReason).toBeTruthy();
  });

  it("sorts defects before opportunities deterministically", () => {
    const sorted = sortFindings([
      {
        id: "b-opp",
        kind: "opportunity",
        category: "content",
        severity: "info",
        title: "b",
        whyItMatters: "x",
        evidence: [],
        suggestedFix: "x",
        expectedImpact: "high",
        confidence: "high",
        effort: "low",
        fixSafety: "manual",
        verification: "x",
      },
      {
        id: "a-defect",
        kind: "defect",
        category: "metadata",
        severity: "medium",
        title: "a",
        whyItMatters: "x",
        evidence: [],
        suggestedFix: "x",
        expectedImpact: "medium",
        confidence: "high",
        effort: "low",
        fixSafety: "auto",
        verification: "x",
      },
    ]);
    expect(sorted[0].id).toBe("a-defect");
    expect(sorted[1].id).toBe("b-opp");
  });

  it("keeps internal scorePriority helper deterministic", () => {
    expect(scorePriority(8, 0.95, 2, 1)).toBeCloseTo(2.53, 2);
  });
});
