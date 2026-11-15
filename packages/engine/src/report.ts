export type CoverageStatus =
  | "completed"
  | "not_run"
  | "fail"
  | "not_connected"
  | "not_applicable";

export interface CoverageMap {
  source: CoverageStatus;
  rendered: CoverageStatus;
  live: CoverageStatus;
  searchData: CoverageStatus;
}

export interface ReportFinding {
  ruleId: string;
  severity: "P1" | "P2" | "P3";
  status:
    | "pass"
    | "fail"
    | "confirmed"
    | "needs_verification"
    | "not_applicable"
    | "not_run";
  confidence: "high" | "medium" | "low";
  affectedUrls: string[];
  evidence: string[];
  fixable: boolean;
  requiresApproval: boolean;
  title?: string;
  kind?: "defect" | "opportunity";
}

export interface ReportEnvelope {
  schemaVersion: "1.0";
  project: string;
  mode: "full" | "live" | "self_hosted";
  coverage: CoverageMap;
  findings: ReportFinding[];
  summary?: unknown;
}

export function wrapReport(input: {
  project: string;
  mode: ReportEnvelope["mode"];
  coverage: CoverageMap;
  findings: ReportFinding[];
  summary?: unknown;
}): ReportEnvelope {
  return {
    schemaVersion: "1.0",
    project: input.project,
    mode: input.mode,
    coverage: input.coverage,
    findings: input.findings,
    summary: input.summary,
  };
}
