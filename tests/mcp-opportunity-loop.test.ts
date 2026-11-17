import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi, afterEach } from "vitest";
import {
  actionMatrixLabel,
  buildMcpOpportunityPrompt,
} from "../src/grow/mcp-prompt.js";
import {
  isFieldValueEmpty,
  needsBrandOrIcpFill,
  emptyProfile,
} from "@qualitykit/profile";
import { qualitykitFix } from "../src/tools/qualitykit-fix.js";
import { qualitykitVerify } from "../src/tools/qualitykit-verify.js";
import { listGrowChanges } from "../src/grow/impressions.js";
import { loadSite } from "../src/tools/helpers.js";
import { runAuditEngine } from "../src/audit/engine.js";

const fixturesRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../fixtures",
);

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("MCP opportunity prompt", () => {
  it("includes opportunity id and tool sequence", () => {
    const text = buildMcpOpportunityPrompt(
      {
        opportunityId: "page-feature-features-seo-audit",
        title: "Add feature page: SEO audit",
        action: "create",
        path: "/features/seo-audit",
        suggestedFix: "Create /features/seo-audit",
        impressions: 120,
      },
      { url: "https://example.com", name: "Example" },
    );
    expect(text).toContain("page-feature-features-seo-audit");
    expect(text).toContain("qualitykit.fix");
    expect(text).toContain("qualitykit.verify");
    expect(text).toContain('markApplied: true');
    expect(text).toContain("opportunities.list");
    expect(text).toContain("New page");
    expect(actionMatrixLabel("improve")).toBe("Existing page");
  });
});

describe("profile empty-field helpers", () => {
  it("detects empty brand/ICP for auto-fill", () => {
    expect(isFieldValueEmpty("brandIdentity", { name: "", positioning: "" })).toBe(
      true,
    );
    expect(
      isFieldValueEmpty("brandIdentity", {
        name: "PlantFit",
        positioning: "plants",
      }),
    ).toBe(false);
    expect(isFieldValueEmpty("icp", { audience: "" })).toBe(true);
    expect(needsBrandOrIcpFill(null)).toBe(true);
    expect(needsBrandOrIcpFill(emptyProfile("x"))).toBe(true);
  });
});

describe("MCP fix → verify → shipped loop", () => {
  it("buildContract then verify with mocked mark_applied ships the id", async () => {
    const projectRoot = path.join(fixturesRoot, "bare-app");
    const site = loadSite(projectRoot, "https://example.com");
    const audit = runAuditEngine(site);
    const changes = listGrowChanges(site, audit.findings);
    const pageChange = changes.find((c) => c.id.startsWith("page-"));
    expect(pageChange?.page?.path).toBeTruthy();
    const opportunityId = pageChange!.id;
    const targetPath = pageChange!.page!.path;

    const fixResult = await qualitykitFix({
      projectRoot,
      siteUrl: "https://example.com",
      opportunityIds: [opportunityId],
      continueDespiteStaleProfile: true,
    });
    const fixBody = JSON.parse(fixResult.content[0]!.text as string) as {
      buildContracts?: Array<{ path?: string; opportunityId: string }>;
    };
    expect(fixBody.buildContracts?.length).toBeGreaterThan(0);
    expect(fixBody.buildContracts![0]!.opportunityId).toBe(opportunityId);

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/gsc/applied")) {
        return new Response(
          JSON.stringify({
            ok: true,
            applied: {
              changeSetId: "cs_test",
              itemCount: 1,
              items: [{ changeId: opportunityId, path: targetPath }],
            },
            shipped: 1,
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response(JSON.stringify({ ok: false }), { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const pageContent = `export default function Page() {\n  return <main><h1>${targetPath}</h1></main>;\n}\n`;
    const filePath = path
      .join("app", ...targetPath.split("/").filter(Boolean), "page.tsx")
      .replace(/\\/g, "/");

    const verifyResult = await qualitykitVerify({
      projectRoot,
      siteUrl: "https://example.com",
      opportunityIds: [opportunityId],
      paths: { [opportunityId]: targetPath },
      markApplied: true,
      apiBaseUrl: "https://app.qualitykit.dev",
      apiKey: "qk_test_key",
      proposedFiles: [{ path: filePath, content: pageContent }],
    });
    const verifyBody = JSON.parse(
      verifyResult.content[0]!.text as string,
    ) as {
      readyToShip?: string[];
      shipped?: number;
      summary?: { shipped?: number };
    };
    expect(verifyBody.readyToShip).toContain(opportunityId);
    expect(verifyBody.shipped ?? verifyBody.summary?.shipped).toBe(1);
    expect(fetchMock).toHaveBeenCalled();
  });
});
