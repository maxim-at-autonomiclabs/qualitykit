import { describe, expect, it } from "vitest";
import {
  applyPatch,
  checkFreshness,
  gscQueryOpportunityId,
  emptyProfile,
} from "@qualitykit/profile";

describe("@qualitykit/profile package", () => {
  it("builds stable gsc query ids", () => {
    expect(gscQueryOpportunityId("Team Task Tracking")).toBe(
      "gsc-query-team-task-tracking",
    );
  });

  it("gates material fields", () => {
    const base = emptyProfile("h1");
    base.version = 1;
    base.fields.icp = {
      value: { audience: "pm", industries: [], roles: [], painPoints: [] },
      updatedAt: new Date().toISOString(),
      confidence: "high",
      evidence: [],
      source: "user",
    };
    const next = applyPatch(base, {
      icp: {
        value: {
          audience: "students",
          industries: [],
          roles: [],
          painPoints: [],
        },
        updatedAt: new Date().toISOString(),
        confidence: "high",
        evidence: ["model"],
        source: "model",
      },
    });
    expect(next.pending).toContain("icp");
    expect(
      (next.profile.fields.icp?.value as { audience: string }).audience,
    ).toBe("pm");
  });

  it("reports missing profile freshness", () => {
    expect(checkFreshness(null).status).toBe("missing");
  });
});
