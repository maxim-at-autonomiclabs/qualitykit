import type { CoverageMap } from "@qualitykit/engine";

/** Additive schema envelope fields for primary tool responses */
export function withCoverageEnvelope(
  payload: Record<string, unknown>,
  coverage: CoverageMap,
  project = "local",
  mode: "full" | "live" | "self_hosted" = "full",
) {
  return {
    schemaVersion: "1.0" as const,
    project,
    mode,
    coverage,
    ...payload,
  };
}
