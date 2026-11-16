import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { analyzeProject } from "../src/adapters/index.js";
import { runAuditEngine } from "../src/audit/engine.js";
import { buildGrowReport } from "../src/grow/impressions.js";
import {
  applySiteProfilePatch,
  approvePendingSiteProfile,
  checkSiteProfileFreshness,
  classifyGscQuery,
  computeSiteHash,
  draftSiteProfileFromRepo,
  scoreQueryBrandFit,
  type SiteProfile,
} from "../src/grow/site-profile.js";
import { readProjectFiles } from "../src/project/read.js";
import { qualitykitFix } from "../src/tools/qualitykit-fix.js";

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

function parseToolPayload(result: {
  content: Array<{ type: string; text?: string }>;
}) {
  const text = result.content[0]?.text;
  expect(text).toBeTruthy();
  return JSON.parse(text!) as Record<string, unknown>;
}

function projectManagementProfile(siteHash: string): SiteProfile {
  const now = new Date().toISOString();
  const field = (value: unknown, evidence: string[] = []) => ({
    value,
    updatedAt: now,
    confidence: "high" as const,
    evidence,
    source: "user" as const,
  });

  return {
    version: 12,
    lastVerifiedAt: now,
    status: "fresh",
    siteHash,
    stored: true,
    fields: {
      brandIdentity: field({
        name: "TaskFlow",
        positioning: "Project management software for product teams",
        category: "saas",
      }),
      icp: field({
        audience: "product managers and team leads",
        industries: ["software", "agencies"],
        roles: ["PM", "engineering lead"],
        painPoints: ["scattered tasks", "weak delivery visibility"],
      }),
      products: field([
        { name: "project management software", description: "core product" },
        { name: "team task tracking", description: "task boards" },
        { name: "sprint planning", description: "agile planning" },
      ]),
      brandVoice: field({
        tone: "clear and confident",
        terminology: ["project", "task", "sprint"],
        standards: ["No invented competitor claims"],
      }),
      existingPages: field([
        {
          path: "/",
          topic: "TaskFlow project management",
          intent: "home",
          title: "TaskFlow — Project management software",
        },
        {
          path: "/features/project-management",
          topic: "project management software",
          intent: "feature",
          title: "Project management",
        },
        {
          path: "/pricing",
          topic: "pricing",
          intent: undefined,
          title: "Pricing",
        },
      ]),
      keywordRelevance: field([]),
      competitors: field([]),
      conversionGoals: field({
        primary: "Start free trial",
        secondary: ["Book a demo"],
      }),
    },
  };
}

describe("Site Profile freshness and material approval", () => {
  it("marks only affected fields stale for TTL, site hash, and new queries", () => {
    const { site } = load("bare-app");
    const hash = computeSiteHash(site);
    const profile = projectManagementProfile(hash);

    // Fresh
    const fresh = checkSiteProfileFreshness(profile, { siteHash: hash });
    expect(fresh.status).toBe("fresh");
    expect(fresh.staleFields).toHaveLength(0);

    // TTL expired on brand only
    const oldBrand = {
      ...profile,
      fields: {
        ...profile.fields,
        brandIdentity: {
          ...profile.fields.brandIdentity!,
          updatedAt: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString(),
        },
      },
    };
    const ttl = checkSiteProfileFreshness(oldBrand, { siteHash: hash });
    expect(ttl.status).toBe("stale");
    expect(ttl.staleFields.map((f) => f.field)).toContain("brandIdentity");
    expect(ttl.staleFields.every((f) => f.field !== "conversionGoals")).toBe(
      true,
    );

    // Site changed → products + existingPages
    const siteChanged = checkSiteProfileFreshness(profile, {
      siteHash: "different-hash",
    });
    expect(siteChanged.staleFields.map((f) => f.field)).toEqual(
      expect.arrayContaining(["products", "existingPages"]),
    );

    // New GSC queries → keywordRelevance
    const withQueries = {
      ...profile,
      fields: {
        ...profile.fields,
        keywordRelevance: {
          ...profile.fields.keywordRelevance!,
          value: [
            {
              query: "project management software",
              score: 95,
              band: "high" as const,
              reason: "fit",
            },
          ],
        },
      },
    };
    const newQ = checkSiteProfileFreshness(withQueries, {
      siteHash: hash,
      knownQueries: ["project management software", "free excel templates"],
    });
    const kr = newQ.staleFields.find((f) => f.field === "keywordRelevance");
    expect(kr?.reasons).toContain("new_gsc_queries");
  });

  it("keeps ICP rewrites pending until approveMaterial", () => {
    const { site } = load("bare-app");
    const profile = projectManagementProfile(computeSiteHash(site));
    const patched = applySiteProfilePatch(profile, {
      icp: {
        value: {
          audience: "students downloading free excel templates",
          industries: ["education"],
          roles: ["student"],
          painPoints: ["need templates"],
        },
        updatedAt: new Date().toISOString(),
        confidence: "high",
        evidence: ["gsc-impressions=99999"],
        source: "agent",
      },
    });

    expect(patched.pending).toContain("icp");
    expect(patched.applied).not.toContain("icp");
    expect(
      (patched.profile.fields.icp?.value as { audience: string }).audience,
    ).toMatch(/product managers/i);
    expect(patched.profile.pendingApproval?.icp).toBeTruthy();

    const scoreBefore = scoreQueryBrandFit(
      "free excel templates",
      patched.profile,
    );
    expect(scoreBefore.band).toBe("irrelevant");

    const approved = approvePendingSiteProfile(patched.profile, ["icp"]);
    expect(
      (approved.fields.icp?.value as { audience: string }).audience,
    ).toMatch(/students/i);
    expect(approved.pendingApproval?.icp).toBeUndefined();
  });
});

describe("Brand-aligned keyword scoring", () => {
  it("scores project-management example: improve, create, deprioritise", () => {
    const { site } = load("bare-app");
    // Inject routes that look like TaskFlow coverage for overlap/improve paths
    site.routes.push(
      {
        path: "/features/project-management",
        file: "app/features/project-management/page.tsx",
        kind: "page",
        title: "Project management software",
        description: "Project management for teams",
        hasMetadata: true,
        hasCanonical: false,
        headings: ["Project management software", "Task boards"],
        h1Count: 1,
        imagesMissingAlt: 0,
        internalLinks: ["/"],
      },
      {
        path: "/solutions/teams",
        file: "app/solutions/teams/page.tsx",
        kind: "page",
        title: "Team collaboration",
        description: "Teams using project workflows",
        hasMetadata: true,
        hasCanonical: false,
        headings: ["Teams"],
        h1Count: 1,
        imagesMissingAlt: 0,
        internalLinks: ["/"],
      },
    );

    const profile = projectManagementProfile(computeSiteHash(site));

    const improve = classifyGscQuery(
      {
        id: "gsc-query-pms",
        query: "project management software",
        impressions: 8400,
        clicks: 120,
        position: 7.2,
      },
      profile,
      site,
    );
    expect(improve.brandFit.band).toBe("high");
    expect(improve.action).toBe("improve");
    expect(improve.brandFit.score).toBeGreaterThanOrEqual(70);

    const create = classifyGscQuery(
      {
        id: "gsc-query-ttt",
        query: "team task tracking",
        impressions: 5200,
        clicks: 40,
        position: 18,
      },
      profile,
      site,
    );
    expect(create.brandFit.band).toBe("high");
    expect(create.action).toBe("create");

    const deprior = classifyGscQuery(
      {
        id: "gsc-query-excel",
        query: "free Excel templates",
        impressions: 12000,
        clicks: 800,
        position: 3,
      },
      profile,
      site,
    );
    expect(deprior.brandFit.band).toBe("irrelevant");
    expect(deprior.action).toBe("deprioritise");
    expect(deprior.brandFit.score).toBeLessThan(40);

    const audit = runAuditEngine(site);
    const grow = buildGrowReport(
      site,
      audit.findings,
      [
        {
          id: "gsc-query-pms",
          query: "project management software",
          impressions: 8400,
          clicks: 120,
          position: 7.2,
        },
        {
          id: "gsc-query-ttt",
          query: "team task tracking",
          impressions: 5200,
          clicks: 40,
          position: 18,
        },
        {
          id: "gsc-query-excel",
          query: "free Excel templates",
          impressions: 12000,
          clicks: 800,
          position: 3,
        },
      ],
      profile,
    );

    expect(grow.deprioritised?.some((d) => /excel/i.test(d.query))).toBe(true);
    expect(
      grow.topChanges.every((c) => !/excel/i.test(c.title) && c.id !== "gsc-query-excel"),
    ).toBe(true);
    expect(
      grow.opportunities?.some((o) => o.query === "project management software"),
    ).toBe(true);
    expect(
      grow.opportunities?.some((o) => o.query === "team task tracking"),
    ).toBe(true);
    expect(grow.profile?.version).toBe(12);
  });

  it("flags overlapping routes for the same query", () => {
    const { site } = load("bare-app");
    site.routes.push(
      {
        path: "/features/task-tracking",
        file: "a.tsx",
        kind: "page",
        title: "Team task tracking",
        description: "Track team tasks",
        hasMetadata: true,
        hasCanonical: false,
        headings: ["Team task tracking"],
        h1Count: 1,
        imagesMissingAlt: 0,
        internalLinks: [],
      },
      {
        path: "/guides/team-task-tracking",
        file: "b.tsx",
        kind: "page",
        title: "Guide to team task tracking",
        description: "How to do team task tracking",
        hasMetadata: true,
        hasCanonical: false,
        headings: ["Team task tracking guide"],
        h1Count: 1,
        imagesMissingAlt: 0,
        internalLinks: [],
      },
    );
    const profile = projectManagementProfile(computeSiteHash(site));
    const overlap = classifyGscQuery(
      {
        id: "gsc-query-overlap",
        query: "team task tracking",
        impressions: 3000,
        position: 12,
      },
      profile,
      site,
    );
    expect(overlap.action).toBe("fix_overlap");
    expect(overlap.risk).toContain("cannibalisation");
  });

  it("rejects irrelevant opportunity ids in qualitykit.fix", async () => {
    const { root, site } = load("bare-app");
    // bare-app / QualityKit-ish draft has no excel overlap → deprioritise
    const result = await qualitykitFix({
      projectRoot: root,
      opportunityIds: ["gsc-query-free-excel-templates"],
    });
    const payload = parseToolPayload(result);
    const skipped = payload.skipped as Array<{ id: string; reason: string }>;
    const contracts = payload.buildContracts as unknown[];
    const skippedExcel = skipped.find(
      (s) => s.id === "gsc-query-free-excel-templates",
    );
    expect(skippedExcel).toBeTruthy();
    expect(skippedExcel!.reason).toMatch(/irrelevant|Brand-fit|depriorit/i);
    expect(contracts).toHaveLength(0);

    const profile = projectManagementProfile(computeSiteHash(site));
    const scored = classifyGscQuery(
      {
        id: "gsc-query-free-excel-templates",
        query: "free Excel templates",
        impressions: 12000,
      },
      profile,
      site,
    );
    expect(scored.action).toBe("deprioritise");
  });
});

describe("draft profile from repo", () => {
  it("builds an ephemeral unstored profile", () => {
    const { site } = load("bare-app");
    const draft = draftSiteProfileFromRepo(site);
    expect(draft.stored).toBe(false);
    expect(draft.version).toBe(0);
    expect(draft.fields.brandIdentity).toBeTruthy();
    expect(draft.fields.existingPages).toBeTruthy();
  });
});
