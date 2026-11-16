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
