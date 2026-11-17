export type McpPromptOpportunity = {
  opportunityId: string;
  title?: string | null;
  action?: string | null;
  suggestedFix?: string | null;
  path?: string | null;
  query?: string | null;
  impressions?: number | null;
  clicks?: number | null;
  position?: number | null;
  evidence?: string[] | null;
};

export type McpPromptSite = {
  url?: string | null;
  name?: string | null;
};

const ACTION_LABELS: Record<string, string> = {
  improve: "Existing page",
  create: "New page",
  fix_overlap: "Fix overlap",
  deprioritise: "Ignore",
};

export function actionMatrixLabel(action?: string | null): string {
  if (!action) return "Review";
  return ACTION_LABELS[action] ?? action;
}

/** Paste-ready prompt for a Cursor agent using QualityKit MCP tools. */
export function buildMcpOpportunityPrompt(
  opp: McpPromptOpportunity,
  site?: McpPromptSite | null,
): string {
  const id = opp.opportunityId;
  const action = opp.action || "improve";
  const label = actionMatrixLabel(action);
  const siteLine = site?.url
    ? `Site: ${site.url}${site.name ? ` (${site.name})` : ""}`
    : "Site: (use the repo / monitored site URL)";
  const evidenceBits = [
    opp.query ? `query “${opp.query}”` : null,
    opp.path ? `path ${opp.path}` : null,
    opp.impressions != null ? `${opp.impressions} impressions` : null,
    opp.clicks != null ? `${opp.clicks} clicks` : null,
    opp.position != null ? `avg position ${Number(opp.position).toFixed(1)}` : null,
  ].filter(Boolean);
  const evidenceExtra = (opp.evidence ?? [])
    .filter((e) => !e.startsWith("action="))
    .slice(0, 6)
    .join("; ");

  return [
    "Use the QualityKit MCP tools (do not invent SEO advice outside tools).",
    "",
    siteLine,
    `Opportunity id: ${id}`,
    `Title: ${opp.title || id}`,
    `Action: ${action} (${label})`,
    evidenceBits.length ? `Query/path: ${evidenceBits.join(" · ")}` : null,
    evidenceExtra ? `Evidence: ${evidenceExtra}` : null,
    opp.suggestedFix ? `Suggested fix: ${opp.suggestedFix}` : null,
    "",
    "Steps:",
    "1. qualitykit.get_site_profile (confirm brand/ICP)",
    `2. qualitykit.fix({ projectRoot, opportunityIds: ["${id}"] })`,
    "3. Implement every buildContract in-repo (match existing patterns; mark [verify] claims)",
    `4. qualitykit.verify({ projectRoot, opportunityIds: ["${id}"], markApplied: true })`,
    "5. Confirm verify.summary.shipped >= 1 (or readyToShip + visibility.mark_applied if offline)",
    "6. opportunities.list — status must be shipped for this id",
    "",
    "Stop if brand fit is deprioritise / irrelevant.",
  ]
    .filter((line) => line !== null)
    .join("\n");
}
