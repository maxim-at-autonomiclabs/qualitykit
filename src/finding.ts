import type { Severity } from "./site.js";
// Severity lives in site.ts for shared typing across MCP and Cloud

export type FindingKind = "defect" | "opportunity";

export type FixSafety = "auto" | "approval" | "manual";

export type Confidence = "high" | "medium" | "low";

export type Impact = "high" | "medium" | "low";

export type Effort = "low" | "medium" | "high";

export type FindingCategory =
  | "technical-seo"
  | "metadata"
  | "content"
  | "ai"
  | "schema"
  | "links"
  | "performance"
  | "conversion";

export interface Finding {
  id: string;
  kind: FindingKind;
  category: FindingCategory;
  severity: Severity;
  title: string;
  whyItMatters: string;
  evidence: string[];
  suggestedFix: string;
  expectedImpact: Impact;
  confidence: Confidence;
  effort: Effort;
  fixSafety: FixSafety;
  verification: string;
  relatedIds?: string[];
  rootCauseId?: string;
}

export interface RouteInventoryItem {
  path: string;
  file: string;
  kind: "page" | "layout" | "route" | "other";
  pattern: "static" | "dynamic" | "handler" | "layout";
}

export interface AuditSummary {
  defects: number;
  opportunities: number;
  critical: number;
  high: number;
  medium: number;
  low: number;
  info: number;
}

export function sortFindings(findings: Finding[]): Finding[] {
  const severityRank: Record<Severity, number> = {
    critical: 0,
    high: 1,
    medium: 2,
    low: 3,
    info: 4,
  };
  const impactRank: Record<Impact, number> = { high: 0, medium: 1, low: 2 };
  const confidenceRank: Record<Confidence, number> = {
    high: 0,
    medium: 1,
    low: 2,
  };
  const effortRank: Record<Effort, number> = { low: 0, medium: 1, high: 2 };

  return [...findings].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "defect" ? -1 : 1;
    if (severityRank[a.severity] !== severityRank[b.severity]) {
      return severityRank[a.severity] - severityRank[b.severity];
    }
    if (impactRank[a.expectedImpact] !== impactRank[b.expectedImpact]) {
      return impactRank[a.expectedImpact] - impactRank[b.expectedImpact];
    }
    if (confidenceRank[a.confidence] !== confidenceRank[b.confidence]) {
      return confidenceRank[a.confidence] - confidenceRank[b.confidence];
    }
    if (effortRank[a.effort] !== effortRank[b.effort]) {
      return effortRank[a.effort] - effortRank[b.effort];
    }
    return a.id.localeCompare(b.id);
  });
}

export function summarizeFindings(findings: Finding[]): AuditSummary {
  return {
    defects: findings.filter((f) => f.kind === "defect").length,
    opportunities: findings.filter((f) => f.kind === "opportunity").length,
    critical: findings.filter((f) => f.severity === "critical").length,
    high: findings.filter((f) => f.severity === "high").length,
    medium: findings.filter((f) => f.severity === "medium").length,
    low: findings.filter((f) => f.severity === "low").length,
    info: findings.filter((f) => f.severity === "info").length,
  };
}

export function buildRouteInventory(
  routes: {
    path: string;
    file: string;
    kind: "page" | "layout" | "route" | "other";
  }[],
): RouteInventoryItem[] {
  return routes.map((r) => {
    let pattern: RouteInventoryItem["pattern"] = "static";
    if (r.kind === "layout") pattern = "layout";
    else if (r.kind === "route") pattern = "handler";
    else if (r.path.includes(":")) pattern = "dynamic";
    return {
      path: r.path,
      file: r.file,
      kind: r.kind,
      pattern,
    };
  });
}
