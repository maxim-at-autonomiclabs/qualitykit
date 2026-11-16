export type SiteProfileFieldId =
  | "brandIdentity"
  | "icp"
  | "products"
  | "brandVoice"
  | "existingPages"
  | "keywordRelevance"
  | "competitors"
  | "conversionGoals";

export type SiteProfileSource = "user" | "agent" | "model";

export type StaleReason =
  | "ttl_expired"
  | "site_changed"
  | "new_gsc_queries"
  | "deployed"
  | "empty";

export type BrandFitBand = "high" | "adjacent" | "irrelevant";

export type Confidence = "high" | "medium" | "low";

export interface ProfileFieldValue {
  value: unknown;
  updatedAt: string;
  confidence: Confidence;
  evidence: string[];
  source: SiteProfileSource;
}

export interface BrandIdentityValue {
  name: string;
  positioning: string;
  category?: string;
}

export interface IcpValue {
  audience: string;
  industries: string[];
  roles: string[];
  painPoints: string[];
}

export interface ProductItem {
  name: string;
  description?: string;
}

export interface BrandVoiceValue {
  tone: string;
  terminology: string[];
  standards: string[];
}

export interface ExistingPageItem {
  path: string;
  topic: string;
  intent?: string;
  title?: string;
}

export interface KeywordRelevanceItem {
  query: string;
  score: number;
  band: BrandFitBand;
  reason: string;
  updatedAt?: string;
}

export interface CompetitorItem {
  name: string;
  positioning?: string;
}

export interface ConversionGoalsValue {
  primary: string;
  secondary: string[];
}

export type SiteProfileFields = Partial<
  Record<SiteProfileFieldId, ProfileFieldValue>
>;

export type PendingApproval = Partial<
  Record<
    SiteProfileFieldId,
    ProfileFieldValue & { proposedAt: string; reason?: string }
  >
>;

export interface SiteProfile {
  version: number;
  lastVerifiedAt: string | null;
  status: "fresh" | "stale";
  siteHash: string;
  fields: SiteProfileFields;
  pendingApproval?: PendingApproval;
  stored: boolean;
}

export interface StaleFieldInfo {
  field: SiteProfileFieldId;
  reasons: StaleReason[];
  current?: ProfileFieldValue;
  evidence: string[];
}

export interface FreshnessReport {
  status: "fresh" | "stale" | "missing";
  version: number | null;
  lastVerifiedAt: string | null;
  staleFields: StaleFieldInfo[];
  siteHash?: string;
  stored?: boolean;
  summary?: string | null;
}

/** Model draft: field id → value payload (wrapper added by apply layer). */
export type ModelDraftFields = Partial<
  Record<
    SiteProfileFieldId,
    {
      value: unknown;
      confidence?: Confidence;
      evidence?: string[];
    }
  >
>;

export const SITE_PROFILE_FIELD_IDS: SiteProfileFieldId[] = [
  "brandIdentity",
  "icp",
  "products",
  "brandVoice",
  "existingPages",
  "keywordRelevance",
  "competitors",
  "conversionGoals",
];
