import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { analyzeProject } from "../src/adapters/index.js";
import { runAiAudit } from "../src/aeo/ai-audit.js";
import { fileSpecToDiff } from "../src/fix/diff.js";
import {
  fetchRenderedPages,
  parseHtmlSignals,
} from "../src/integrations/fetch-html.js";
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
  return { root, site: analyzeProject(files, { siteUrl: "https://example.com" }, root) };
}

describe("AI audit, rendered HTML, fix, verify", () => {
  it("scores bare app lower on citation/entity than with-blog for some signals", () => {
    const bare = runAiAudit(load("bare-app").site);
    const blog = runAiAudit(load("with-blog").site);

    expect(bare.scores.crawlability).toBeGreaterThanOrEqual(0);
    expect(bare.scores.crawlability).toBeLessThanOrEqual(100);
    expect(bare.findings.some((f) => f.category === "ai" || f.category === "content")).toBe(
      true,
    );
    expect(blog.scores.citationReadiness).toBeGreaterThanOrEqual(
      bare.scores.citationReadiness,
    );
    expect(blog.scores.crawlability).toBeGreaterThan(bare.scores.crawlability);
    expect(bare.caveats.join(" ")).toMatch(/do not predict/i);
  });

  it("parses rendered HTML signals without network", () => {
    const html = `<!doctype html><html><head>
      <title>Acme Analytics</title>
      <meta name="description" content="Product analytics" />
      <link rel="canonical" href="https://example.com/" />
      <meta property="og:title" content="Acme Analytics" />
      <script type="application/ld+json">{"@type":"Organization","name":"Acme"}</script>
    </head><body><h1>Acme Analytics</h1><h2>For SaaS teams</h2></body></html>`;
    const signals = parseHtmlSignals(html);
    expect(signals.title).toBe("Acme Analytics");
    expect(signals.description).toBe("Product analytics");
    expect(signals.canonical).toBe("https://example.com/");
    expect(signals.h1).toEqual(["Acme Analytics"]);
    expect(signals.jsonLd[0]).toMatchObject({ "@type": "Organization" });
  });

  it("fetchRenderedPages uses injected fetch (no real network)", async () => {
    const fetchImpl = vi.fn(async () => {
      const body = new TextEncoder().encode(
        "<html><head><title>Live</title></head><body><h1>Live</h1></body></html>",
      );
      return new Response(body, { status: 200 });
    }) as unknown as typeof fetch;

    const pages = await fetchRenderedPages("https://example.com", {
      paths: ["/"],
      fetchImpl,
    });
    expect(pages).toHaveLength(1);
    expect(pages[0].ok).toBe(true);
    expect(pages[0].title).toBe("Live");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("qualitykit.fix emits a unified diff for robots create", async () => {
    const { root } = load("bare-app");
    const result = await qualitykitFix({
      projectRoot: root,
      siteUrl: "https://example.com",
      findingIds: ["missing-robots"],
      safeAutoOnly: true,
    });
    const payload = JSON.parse(result.content[0].text);
    expect(payload.ok).toBe(true);
    expect(payload.mode).toBe("advise-only");
    const robotsDiff = payload.diffs.find((d: { path: string }) =>
      d.path.endsWith("robots.ts"),
    );
    expect(robotsDiff?.diff).toContain("+++ b/");
    expect(robotsDiff?.diff).toContain("MetadataRoute.Robots");
  });

  it("fileSpecToDiff creates parseable create diffs", () => {
    const diff = fileSpecToDiff({
      path: "app/robots.ts",
      kind: "create",
      content: "export default function robots() { return {}; }\n",
      rationale: "add robots",
    });
    expect(diff.diff).toContain("--- /dev/null");
    expect(diff.diff).toContain("+export default function robots()");
  });

  it("qualitykit.verify marks robots finding fixed with proposed files", async () => {
    const { root } = load("bare-app");
    const robotsContent = `import type { MetadataRoute } from "next";
export default function robots(): MetadataRoute.Robots {
  return { rules: { userAgent: "*", allow: "/" }, sitemap: "https://example.com/sitemap.xml" };
}
`;
    const result = await qualitykitVerify({
      projectRoot: root,
      siteUrl: "https://example.com",
      findingIds: ["missing-robots"],
      proposedFiles: [{ path: "app/robots.ts", content: robotsContent }],
    });
    const payload = JSON.parse(result.content[0].text);
    expect(payload.ok).toBe(true);
    expect(payload.fixed).toContain("missing-robots");
    expect(payload.remaining).not.toContain("missing-robots");
  });
});
