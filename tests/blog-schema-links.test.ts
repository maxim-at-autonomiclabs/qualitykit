import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { analyzeProject } from "../src/adapters/index.js";
import { nextjsAdapter } from "../src/adapters/nextjs/index.js";
import { readProjectFiles } from "../src/project/read.js";
import { buildContentBriefs } from "../src/tools/content.js";
import { buildLinkSuggestions } from "../src/tools/links.js";
import { buildSchemaPlan } from "../src/tools/schema.js";
import { validateProposed, validateSite } from "../src/tools/validate.js";

const fixturesRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../fixtures",
);

function load(name: string) {
  const root = path.join(fixturesRoot, name);
  const files = readProjectFiles(root);
  return analyzeProject(files, { siteUrl: "https://example.com" }, root);
}

describe("blog, schema, links, content, validate", () => {
  it("scaffolds MDX blog for bare App Router site", () => {
    const site = load("bare-app");
    const recs = nextjsAdapter.planBlog(site, { includeCategories: true });
    const scaffold = recs.find((r) => r.id === "blog-scaffold-mdx");
    expect(scaffold).toBeTruthy();
    expect(scaffold!.dependencies).toEqual(
      expect.arrayContaining(["gray-matter", "next-mdx-remote"]),
    );
    const paths = scaffold!.files.map((f) => f.path);
    expect(paths).toEqual(
      expect.arrayContaining([
        "lib/blog.ts",
        "app/blog/page.tsx",
        "app/blog/[slug]/page.tsx",
        "app/blog/rss.xml/route.ts",
        "app/blog/category/[tag]/page.tsx",
      ]),
    );
    expect(paths.some((p) => p.startsWith("content/blog/") && p.endsWith(".mdx"))).toBe(
      true,
    );
    const mdx = scaffold!.files.find((f) => f.path.endsWith(".mdx"));
    expect(mdx?.content).toContain("[verify]");
    expect(mdx?.content).toContain("title:");
    expect(mdx?.content).toContain("author:");
  });

  it("plans Organization/WebSite JSON-LD that parses", () => {
    const site = load("bare-app");
    const recs = buildSchemaPlan(site, true);
    const org = recs.find((r) => r.id === "schema-organization");
    expect(org).toBeTruthy();
    const note = org!.files.find((f) => f.path.includes("organization-website"));
    expect(note?.content).toBeTruthy();
    const parsed = JSON.parse(note!.content!);
    expect(parsed["@context"]).toBe("https://schema.org");
    const types = parsed["@graph"].map((n: { "@type": string }) => n["@type"]);
    expect(types).toEqual(expect.arrayContaining(["Organization", "WebSite"]));
  });

  it("suggests contextual internal links", () => {
    const site = load("bare-app");
    const suggestions = buildLinkSuggestions(
      site,
      ["/blog/understanding-analytics"],
      10,
    );
    expect(suggestions.length).toBeGreaterThan(0);
    expect(suggestions[0]).toMatchObject({
      sourceFile: expect.any(String),
      targetHref: expect.any(String),
      anchorText: expect.any(String),
    });
  });

  it("returns at most three content briefs", () => {
    const site = load("bare-app");
    const briefs = buildContentBriefs(site, 3);
    expect(briefs.length).toBeGreaterThan(0);
    expect(briefs.length).toBeLessThanOrEqual(3);
    expect(briefs[0].doNotPublishIf.length).toBeGreaterThan(0);
    expect(briefs[0].questionsToAnswer.length).toBeGreaterThan(0);
  });

  it("validates site and proposed blog frontmatter", () => {
    const bare = load("bare-app");
    const bareChecks = validateSite(bare);
    expect(bareChecks.some((c) => c.id === "robots-present" && !c.ok)).toBe(
      true,
    );

    const withBlog = load("with-blog");
    const good = validateSite(withBlog);
    expect(good.some((c) => c.id === "robots-present" && c.ok)).toBe(true);

    const proposed = validateProposed([
      {
        path: "content/blog/demo.mdx",
        content: `---
title: "Demo"
description: "Desc"
date: "2026-01-01"
author: "Editorial Team"
---

Hello`,
      },
      {
        path: "content/blog/bad.mdx",
        content: `---
title: "Bad"
---

Hello`,
      },
    ]);
    expect(
      proposed.some((c) => c.id.includes("demo.mdx") && c.ok),
    ).toBe(true);
    expect(
      proposed.some((c) => c.id.includes("bad.mdx") && !c.ok),
    ).toBe(true);
  });
});
