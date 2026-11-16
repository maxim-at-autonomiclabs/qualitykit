import { z } from "zod";
import {
  applySiteProfilePatch,
  approvePendingSiteProfile,
  buildRefreshBrief,
  checkSiteProfileFreshness,
  computeSiteHash,
  draftSiteProfileFromRepo,
  MATERIAL_FIELDS,
  normalizeCloudProfile,
  type ProfileFieldValue,
  type SiteProfile,
  type SiteProfileFieldId,
} from "../grow/site-profile.js";
import { errorResult, jsonResult, loadSite } from "./helpers.js";
import { cloudCreds, fetchVisibilityOverlay } from "./monitor.js";

const fieldIdSchema = z.enum([
  "brandIdentity",
  "icp",
  "products",
  "brandVoice",
  "existingPages",
  "keywordRelevance",
  "competitors",
  "conversionGoals",
]);

const fieldValueSchema = z.object({
  value: z.any(),
  updatedAt: z.string().optional(),
  confidence: z.enum(["high", "medium", "low"]),
  evidence: z.array(z.string()).default([]),
  source: z.enum(["user", "agent"]).default("agent"),
});

export const getSiteProfileInputSchema = {
  projectRoot: z
    .string()
    .describe("Absolute path to the website repository root"),
  siteUrl: z.string().url().optional(),
  apiBaseUrl: z.string().url().optional(),
  apiKey: z.string().optional(),
};

export const refreshSiteProfileInputSchema = {
  ...getSiteProfileInputSchema,
};

export const updateSiteProfileInputSchema = {
  projectRoot: z
    .string()
    .describe("Absolute path to the website repository root"),
  siteUrl: z.string().url().optional(),
  apiBaseUrl: z.string().url().optional(),
  apiKey: z.string().optional(),
  patch: z
    .record(fieldIdSchema, fieldValueSchema)
    .describe("Partial profile field updates"),
  approveMaterial: z
    .boolean()
    .optional()
    .describe(
      "When true, apply brandIdentity/icp/products immediately (user confirmed). Otherwise those fields stay pendingApproval.",
    ),
  approvePending: z
    .array(fieldIdSchema)
    .optional()
    .describe("Approve previously pending material fields"),
};

async function fetchCloudProfile(args: {
  apiBaseUrl?: string;
  apiKey?: string;
}): Promise<SiteProfile | null> {
  const { apiKey, base } = cloudCreds(args);
  if (!apiKey || !base) return null;
  try {
    const res = await fetch(`${base.replace(/\/$/, "")}/api/site-profile`, {
      headers: { "x-qualitykit-key": apiKey },
    });
    if (res.status === 404) return null;
    if (!res.ok) return null;
    const data = (await res.json()) as Record<string, unknown>;
    const raw = (data.profile ?? data) as Record<string, unknown>;
    return normalizeCloudProfile(raw);
  } catch {
    return null;
  }
}

async function pushCloudProfile(args: {
  apiBaseUrl?: string;
  apiKey?: string;
  profile: SiteProfile;
}): Promise<{ ok: boolean; error?: string }> {
  const { apiKey, base } = cloudCreds(args);
  if (!apiKey || !base) {
    return { ok: false, error: "missing_creds" };
  }
  try {
    const res = await fetch(`${base.replace(/\/$/, "")}/api/site-profile`, {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        "x-qualitykit-key": apiKey,
      },
      body: JSON.stringify({ profile: args.profile }),
    });
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
      };
      return { ok: false, error: data.error || `HTTP ${res.status}` };
    }
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function resolveSiteProfile(args: {
  projectRoot: string;
  siteUrl?: string;
  apiBaseUrl?: string;
  apiKey?: string;
}): Promise<{
  site: ReturnType<typeof loadSite>;
  profile: SiteProfile;
  freshness: ReturnType<typeof checkSiteProfileFreshness>;
}> {
  const site = loadSite(args.projectRoot, args.siteUrl);
  const siteHash = computeSiteHash(site);
  const cloud = await fetchCloudProfile(args);
  const profile = cloud ?? draftSiteProfileFromRepo(site);
  if (!cloud) {
    profile.siteHash = siteHash;
  }
  const overlay = await fetchVisibilityOverlay(args);
  const knownQueries = (overlay?.rankedOpportunities ?? [])
    .map((o) => (typeof o.query === "string" ? o.query : undefined))
    .filter((q): q is string => Boolean(q));
  const freshness = checkSiteProfileFreshness(profile, {
    siteHash,
    knownQueries,
  });
  profile.status = freshness.status;
  return { site, profile, freshness };
}

export async function qualitykitGetSiteProfile(args: {
  projectRoot: string;
  siteUrl?: string;
  apiBaseUrl?: string;
  apiKey?: string;
}) {
  try {
    const { profile, freshness } = await resolveSiteProfile(args);
    return jsonResult({
      ok: true,
      tool: "qualitykit.get_site_profile",
      profile,
      freshness,
      materialFields: [...MATERIAL_FIELDS],
      notes: [
        profile.stored
          ? "Loaded approved Site Profile from QualityKit Cloud."
          : "Ephemeral draft from the repo — not stored. Confirm with qualitykit.update_site_profile after connecting Pro, or pass approveMaterial for local session use.",
        "Brand identity, ICP, and products require user approval before scoring uses a rewrite.",
      ],
    });
  } catch (error) {
    return errorResult(error);
  }
}

export async function qualitykitRefreshSiteProfile(args: {
  projectRoot: string;
  siteUrl?: string;
  apiBaseUrl?: string;
  apiKey?: string;
}) {
  try {
    const { site, profile, freshness } = await resolveSiteProfile(args);
    const overlay = await fetchVisibilityOverlay(args);
    const sampleQueries = (overlay?.rankedOpportunities ?? [])
      .map((o) => (typeof o.query === "string" ? o.query : undefined))
      .filter((q): q is string => Boolean(q));

    if (freshness.status === "fresh" && profile.stored) {
      return jsonResult({
        ok: true,
        tool: "qualitykit.refresh_site_profile",
        status: "fresh",
        profile,
        freshness,
        message: "Site Profile is fresh — reuse it. No refresh needed.",
      });
    }

    const brief = buildRefreshBrief(
      profile,
      freshness,
      site,
      sampleQueries,
    );

    return jsonResult({
      ok: true,
      tool: "qualitykit.refresh_site_profile",
      status: "stale",
      profile,
      freshness,
      refresh: brief,
      nextStep:
        "Reassess stale fields with the host coding agent, then call qualitykit.update_site_profile with a patch. Use approveMaterial=true only after the user confirms brand/ICP/product changes.",
    });
  } catch (error) {
    return errorResult(error);
  }
}

export async function qualitykitUpdateSiteProfile(args: {
  projectRoot: string;
  siteUrl?: string;
  apiBaseUrl?: string;
  apiKey?: string;
  patch?: Partial<
    Record<
      SiteProfileFieldId,
      {
        value?: unknown;
        updatedAt?: string;
        confidence: "high" | "medium" | "low";
        evidence: string[];
        source: "user" | "agent";
      }
    >
  >;
  approveMaterial?: boolean;
  approvePending?: SiteProfileFieldId[];
}) {
  try {
    const { profile, freshness } = await resolveSiteProfile(args);
    let next = profile;

    if (args.approvePending?.length) {
      next = approvePendingSiteProfile(next, args.approvePending);
    }

    type IncomingField = {
      value?: unknown;
      updatedAt?: string;
      confidence: "high" | "medium" | "low";
      evidence: string[];
      source: "user" | "agent";
    };
    const patch: Partial<Record<SiteProfileFieldId, ProfileFieldValue>> = {};
    const incoming = (args.patch ?? {}) as Partial<
      Record<SiteProfileFieldId, IncomingField>
    >;
    for (const key of Object.keys(incoming) as SiteProfileFieldId[]) {
      const raw = incoming[key];
      if (!raw) continue;
      patch[key] = {
        value: raw.value ?? null,
        updatedAt: raw.updatedAt || new Date().toISOString(),
        confidence: raw.confidence,
        evidence: raw.evidence ?? [],
        source: raw.source ?? "agent",
      };
    }
    const result = applySiteProfilePatch(next, patch, {
      approveMaterial: Boolean(args.approveMaterial),
    });
    next = result.profile;
    next.siteHash = freshness.siteHash;
    next.status = checkSiteProfileFreshness(next, {
      siteHash: freshness.siteHash,
    }).status;

    const pushed = await pushCloudProfile({
      apiBaseUrl: args.apiBaseUrl,
      apiKey: args.apiKey,
      profile: { ...next, stored: true },
    });

    if (pushed.ok) {
      next = { ...next, stored: true };
    }

    return jsonResult({
      ok: true,
      tool: "qualitykit.update_site_profile",
      profile: next,
      applied: result.applied,
      pending: result.pending,
      cloudSaved: pushed.ok,
      cloudError:
        pushed.error === "missing_creds"
          ? "No Cloud credentials — profile updated in this response only. Set QUALITYKIT_API_KEY + QUALITYKIT_API_BASE to persist."
          : pushed.error,
      notes: [
        result.pending.length
          ? `Material fields pending user approval: ${result.pending.join(", ")}. Call again with approveMaterial=true or approvePending after confirmation.`
          : "Patch applied to the scoring profile.",
        "Search impressions must not silently rewrite ICP or brand positioning.",
      ],
    });
  } catch (error) {
    return errorResult(error);
  }
}
