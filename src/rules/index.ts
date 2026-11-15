import { aeoRules } from "./aeo.js";
import { contentRules } from "./content.js";
import { technicalSeoRules } from "./technical-seo.js";

export const RULE_RESOURCES = [
  {
    uri: "qualitykit://rules/technical-seo",
    name: "Technical SEO rules",
    description: "Crawlability, metadata, sitemaps, and safe fix boundaries",
    mimeType: "text/markdown",
    text: technicalSeoRules,
  },
  {
    uri: "qualitykit://rules/aeo",
    name: "AEO / AI visibility rules",
    description: "Answer readiness, entities, schema, and AI crawler policy",
    mimeType: "text/markdown",
    text: aeoRules,
  },
  {
    uri: "qualitykit://rules/content",
    name: "Content quality rules",
    description: "Briefs, blog architecture, linking, and integrity standards",
    mimeType: "text/markdown",
    text: contentRules,
  },
] as const;

export function getRuleByUri(uri: string) {
  return RULE_RESOURCES.find((r) => r.uri === uri);
}
