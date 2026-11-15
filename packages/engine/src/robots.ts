export const AI_CRAWLERS = [
  "GPTBot",
  "Google-Extended",
  "PerplexityBot",
  "ClaudeBot",
  "anthropic-ai",
  "Bingbot",
  "Applebot-Extended",
  "Bytespider",
] as const;

export function analyzeRobotsContent(content: string): {
  blocksAll: boolean;
  aiCrawlers: {
    name: string;
    status: "allowed" | "disallowed" | "unknown";
    evidence?: string;
  }[];
} {
  const lines = content.split(/\r?\n/);
  let currentAgents: string[] = [];
  const rules: { agent: string; type: "allow" | "disallow"; path: string }[] =
    [];

  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const ua = line.match(/^user-agent\s*:\s*(.+)$/i);
    if (ua) {
      currentAgents = [ua[1].trim()];
      continue;
    }
    const disallow = line.match(/^disallow\s*:\s*(.*)$/i);
    if (disallow) {
      for (const agent of currentAgents) {
        rules.push({
          agent,
          type: "disallow",
          path: disallow[1].trim() || "/",
        });
      }
      continue;
    }
    const allow = line.match(/^allow\s*:\s*(.*)$/i);
    if (allow) {
      for (const agent of currentAgents) {
        rules.push({
          agent,
          type: "allow",
          path: allow[1].trim() || "/",
        });
      }
    }
  }

  const starDisallowsRoot = rules.some(
    (r) =>
      (r.agent === "*" || r.agent.toLowerCase() === "*") &&
      r.type === "disallow" &&
      (r.path === "/" || r.path === ""),
  );

  const aiCrawlers = AI_CRAWLERS.map((name) => {
    const specific = rules.filter(
      (r) => r.agent.toLowerCase() === name.toLowerCase(),
    );
    if (specific.length === 0) {
      return {
        name,
        status: starDisallowsRoot
          ? ("disallowed" as const)
          : ("allowed" as const),
        evidence: starDisallowsRoot
          ? "Blocked by User-agent: * Disallow: /"
          : "No specific rule; inherits *",
      };
    }
    const blocked = specific.some(
      (r) => r.type === "disallow" && (r.path === "/" || r.path === ""),
    );
    return {
      name,
      status: blocked ? ("disallowed" as const) : ("allowed" as const),
      evidence: specific.map((r) => `${r.type}: ${r.path}`).join("; "),
    };
  });

  return { blocksAll: starDisallowsRoot, aiCrawlers };
}
