import type { SiteProfileFieldId } from "./types.js";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Fields that rewrite business truth — never applied without user approval. */
export const MATERIAL_FIELDS: ReadonlySet<SiteProfileFieldId> = new Set([
  "brandIdentity",
  "icp",
  "products",
]);

export const FIELD_TTL_MS: Record<SiteProfileFieldId, number | null> = {
  brandIdentity: 30 * DAY_MS,
  icp: 30 * DAY_MS,
  products: null,
  brandVoice: 30 * DAY_MS,
  existingPages: null,
  keywordRelevance: 7 * DAY_MS,
  competitors: 30 * DAY_MS,
  conversionGoals: null,
};

export const NON_MATERIAL_FIELDS: SiteProfileFieldId[] = [
  "brandVoice",
  "existingPages",
  "keywordRelevance",
  "competitors",
  "conversionGoals",
];
