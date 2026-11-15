import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { analyzeProject } from "../src/adapters/index.js";
import {
  coveredSearchTerms,
  extractProductSignals,
  phraseAlreadyCovered,
} from "../src/grow/product-signals.js";
import { readProjectFiles } from "../src/project/read.js";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../website",
);

describe("product signals", () => {
  it("reads the real homepage — not a nested docs index.html", () => {
    const files = readProjectFiles(root);
    const site = analyzeProject(files, { siteUrl: "https://qualitykit.dev" }, root);
    expect(site.metadata.rootTitle).toBe(
      "QualityKit — SEO + AEO MCP for codebases",
    );
    expect(site.business.name).toMatch(/QualityKit/i);
    expect(site.business.topics[0]).not.toMatch(/^AI Audit Mode/i);
  });

  it("extracts seo/mcp phrases and skips calculator for MCP products", () => {
    const files = readProjectFiles(root);
    const site = analyzeProject(files, { siteUrl: "https://qualitykit.dev" }, root);
    const signals = extractProductSignals(site);

    expect(signals.brand).toMatch(/QualityKit/i);
    expect(signals.category).toBe("developer-tool");
    expect(signals.allowsCalculator).toBe(false);
    expect(signals.phrases.map((p) => p.phrase).join(" ")).toMatch(/seo|mcp|aeo/i);

    const covered = coveredSearchTerms(site);
    expect(phraseAlreadyCovered("ai audit", covered)).toBe(true);
    // Shipped /features/seo-mcp covers this phrase — grow should not re-propose it
    expect(phraseAlreadyCovered("seo mcp", covered)).toBe(true);
  });
});
