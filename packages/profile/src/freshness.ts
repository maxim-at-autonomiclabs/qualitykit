import { FIELD_TTL_MS } from "./constants.js";
import type {
  FreshnessReport,
  KeywordRelevanceItem,
  ProfileFieldValue,
  SiteProfile,
  SiteProfileFieldId,
  StaleFieldInfo,
  StaleReason,
} from "./types.js";
import { SITE_PROFILE_FIELD_IDS } from "./types.js";

function asKeywordItems(value: unknown): KeywordRelevanceItem[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value as KeywordRelevanceItem[];
}

export function checkFreshness(
  profile: SiteProfile | null | undefined,
  opts: {
    siteHash?: string;
    now?: Date;
    knownQueries?: string[];
    deployedSinceVerify?: boolean;
  } = {},
): FreshnessReport {
  if (!profile) {
    return {
      status: "missing",
      version: null,
      lastVerifiedAt: null,
      staleFields: [
        {
          field: "brandIdentity",
          reasons: ["empty"],
          evidence: ["profile-missing"],
        },
      ],
      siteHash: opts.siteHash,
      stored: false,
      summary: "No Site Profile yet — run model refresh or confirm brand/ICP.",
    };
  }

  const now = opts.now ?? new Date();
  const staleFields: StaleFieldInfo[] = [];
  const siteHash = opts.siteHash ?? profile.siteHash;

  for (const field of SITE_PROFILE_FIELD_IDS) {
    const current = profile.fields[field];
    const reasons: StaleReason[] = [];
    const evidence: string[] = [];

    if (!current) {
      reasons.push("empty");
      evidence.push("field-missing");
    } else {
      const ttl = FIELD_TTL_MS[field];
      if (ttl != null) {
        const age = now.getTime() - Date.parse(current.updatedAt);
        if (Number.isFinite(age) && age > ttl) {
          reasons.push("ttl_expired");
          evidence.push(`ageMs=${age}`, `ttlMs=${ttl}`);
        }
      }
    }

    if (
      (field === "products" || field === "existingPages") &&
      siteHash &&
      profile.siteHash &&
      siteHash !== profile.siteHash
    ) {
      reasons.push("site_changed");
      evidence.push(`profileHash=${profile.siteHash}`, `siteHash=${siteHash}`);
    }

    if (field === "existingPages" && opts.deployedSinceVerify) {
      reasons.push("deployed");
      evidence.push("deployed-since-last-verify");
    }

    if (field === "keywordRelevance" && opts.knownQueries?.length) {
      const known = new Set(
        (asKeywordItems(current?.value) ?? []).map((k) =>
          k.query.toLowerCase(),
        ),
      );
      const unseen = opts.knownQueries.filter(
        (q) => !known.has(q.toLowerCase()),
      );
      if (unseen.length > 0) {
        reasons.push("new_gsc_queries");
        evidence.push(`unseen=${unseen.slice(0, 5).join("|")}`);
      }
    }

    if (reasons.length > 0) {
      staleFields.push({ field, reasons, current, evidence });
    }
  }

  const status = staleFields.length > 0 ? "stale" : "fresh";
  return {
    status,
    version: profile.version,
    lastVerifiedAt: profile.lastVerifiedAt,
    staleFields,
    siteHash,
    stored: profile.stored,
    summary: `Site Profile v${profile.version} · ${
      status === "fresh" ? "Fresh" : "Stale"
    }${
      profile.lastVerifiedAt
        ? ` · last verified ${profile.lastVerifiedAt}`
        : ""
    }`,
  };
}

/** Alias used by MCP call sites. */
export const checkSiteProfileFreshness = checkFreshness;

export function freshnessSummary(
  profile: SiteProfile | null,
  opts?: {
    knownQueries?: string[];
    siteHash?: string;
    now?: Date;
  },
): FreshnessReport {
  return checkFreshness(profile, opts);
}

export type { ProfileFieldValue, SiteProfileFieldId };
