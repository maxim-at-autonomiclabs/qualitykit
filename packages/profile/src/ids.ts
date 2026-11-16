/** Stable GSC query opportunity id shared by Cloud and MCP. */
export function gscQueryOpportunityId(query: string): string {
  const slug = slugifyQuery(query);
  return `gsc-query-${slug || "unknown"}`;
}

export function slugifyQuery(query: string): string {
  return query
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
}

export function slugifyPath(path: string): string {
  return path
    .replace(/^\//, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
}
