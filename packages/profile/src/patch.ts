import { MATERIAL_FIELDS } from "./constants.js";
import type {
  ProfileFieldValue,
  SiteProfile,
  SiteProfileFieldId,
} from "./types.js";

export function applyPatch(
  profile: SiteProfile,
  patch: Partial<Record<SiteProfileFieldId, ProfileFieldValue>>,
  opts?: { approveMaterial?: boolean; now?: Date },
): {
  profile: SiteProfile;
  applied: SiteProfileFieldId[];
  pending: SiteProfileFieldId[];
} {
  const now = (opts?.now ?? new Date()).toISOString();
  const next: SiteProfile = {
    ...profile,
    fields: { ...profile.fields },
    pendingApproval: { ...(profile.pendingApproval ?? {}) },
  };
  const applied: SiteProfileFieldId[] = [];
  const pending: SiteProfileFieldId[] = [];

  for (const [key, fieldValue] of Object.entries(patch) as Array<
    [SiteProfileFieldId, ProfileFieldValue]
  >) {
    if (!fieldValue) continue;
    const normalized: ProfileFieldValue = {
      ...fieldValue,
      updatedAt: fieldValue.updatedAt || now,
    };

    if (MATERIAL_FIELDS.has(key) && !opts?.approveMaterial) {
      next.pendingApproval![key] = {
        ...normalized,
        proposedAt: now,
      };
      pending.push(key);
      continue;
    }

    next.fields[key] = normalized;
    if (next.pendingApproval?.[key]) {
      delete next.pendingApproval[key];
    }
    applied.push(key);
  }

  if (applied.length > 0) {
    next.version = profile.version + 1;
    next.lastVerifiedAt = now;
  }

  if (next.pendingApproval && Object.keys(next.pendingApproval).length === 0) {
    delete next.pendingApproval;
  }

  return { profile: next, applied, pending };
}

/** @deprecated alias */
export const applySiteProfilePatch = applyPatch;
export const applyPatchLocal = applyPatch;

export function approvePending(
  profile: SiteProfile,
  fields?: SiteProfileFieldId[],
  now = new Date(),
): SiteProfile {
  const pending = profile.pendingApproval ?? {};
  const keys = (
    fields ?? (Object.keys(pending) as SiteProfileFieldId[])
  ).filter((k) => pending[k]);
  if (keys.length === 0) return profile;

  const patch: Partial<Record<SiteProfileFieldId, ProfileFieldValue>> = {};
  for (const key of keys) {
    const p = pending[key]!;
    patch[key] = {
      value: p.value,
      updatedAt: now.toISOString(),
      confidence: p.confidence,
      evidence: p.evidence,
      source: "user",
    };
  }
  return applyPatch(profile, patch, {
    approveMaterial: true,
    now,
  }).profile;
}

export const approvePendingSiteProfile = approvePending;

/** Turn a model draft object into ProfileFieldValue wrappers. */
export function modelDraftToPatch(
  draft: Partial<
    Record<
      SiteProfileFieldId,
      { value: unknown; confidence?: "high" | "medium" | "low"; evidence?: string[] }
    >
  >,
  opts?: { now?: Date; source?: ProfileFieldValue["source"] },
): Partial<Record<SiteProfileFieldId, ProfileFieldValue>> {
  const now = (opts?.now ?? new Date()).toISOString();
  const source = opts?.source ?? "model";
  const patch: Partial<Record<SiteProfileFieldId, ProfileFieldValue>> = {};
  for (const [key, raw] of Object.entries(draft) as Array<
    [
      SiteProfileFieldId,
      { value: unknown; confidence?: "high" | "medium" | "low"; evidence?: string[] },
    ]
  >) {
    if (!raw || raw.value === undefined) continue;
    patch[key] = {
      value: raw.value,
      updatedAt: now,
      confidence: raw.confidence ?? "medium",
      evidence: raw.evidence ?? ["model-draft"],
      source,
    };
  }
  return patch;
}

export function emptyProfile(siteHash = ""): SiteProfile {
  return {
    version: 0,
    lastVerifiedAt: null,
    status: "stale",
    siteHash,
    fields: {},
    stored: false,
  };
}

/** True when a field has no meaningful approved value (safe for auto-fill). */
export function isFieldValueEmpty(
  fieldId: SiteProfileFieldId,
  value: unknown,
): boolean {
  if (value == null) return true;
  if (fieldId === "brandIdentity") {
    const v = value as { name?: string; positioning?: string };
    return !String(v.name || "").trim() && !String(v.positioning || "").trim();
  }
  if (fieldId === "icp") {
    const v = value as { audience?: string };
    return !String(v.audience || "").trim();
  }
  if (fieldId === "products") {
    return !Array.isArray(value) || value.length === 0;
  }
  if (fieldId === "brandVoice") {
    const v = value as { tone?: string };
    return !String(v.tone || "").trim();
  }
  if (fieldId === "existingPages" || fieldId === "keywordRelevance" || fieldId === "competitors") {
    return !Array.isArray(value) || value.length === 0;
  }
  if (fieldId === "conversionGoals") {
    const v = value as { primary?: string };
    return !String(v.primary || "").trim();
  }
  if (typeof value === "string") return !value.trim();
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "object") return Object.keys(value as object).length === 0;
  return false;
}

/** Brand or ICP missing — triggers Cloud auto model refresh. */
export function needsBrandOrIcpFill(profile: SiteProfile | null | undefined): boolean {
  if (!profile || !profile.stored) return true;
  return (
    isFieldValueEmpty("brandIdentity", profile.fields.brandIdentity?.value) ||
    isFieldValueEmpty("icp", profile.fields.icp?.value)
  );
}
