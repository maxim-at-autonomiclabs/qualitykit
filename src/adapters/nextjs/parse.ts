import type { ProjectFile, RouteInfo } from "../../model/site.js";

export function parsePackageJson(files: ProjectFile[]): {
  name?: string;
  nextVersion?: string;
  deps: Record<string, string>;
} {
  const pkg = files.find((f) => f.path === "package.json");
  if (!pkg) return { deps: {} };
  try {
    const json = JSON.parse(pkg.content) as {
      name?: string;
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const deps = {
      ...(json.dependencies ?? {}),
      ...(json.devDependencies ?? {}),
    };
    return {
      name: json.name,
      nextVersion: deps.next,
      deps,
    };
  } catch {
    return { deps: {} };
  }
}

export function detectRouter(files: ProjectFile[]): "app" | "pages" | "unknown" {
  const hasApp = files.some(
    (f) =>
      f.path.startsWith("app/") ||
      f.path.startsWith("src/app/") ||
      f.path === "app" ||
      f.path === "src/app",
  );
  const hasPages = files.some(
    (f) =>
      f.path.startsWith("pages/") ||
      f.path.startsWith("src/pages/") ||
      f.path === "pages" ||
      f.path === "src/pages",
  );
  if (hasApp) return "app";
  if (hasPages) return "pages";
  return "unknown";
}

export function appDirPrefix(files: ProjectFile[]): string {
  if (files.some((f) => f.path.startsWith("src/app/"))) return "src/app";
  if (files.some((f) => f.path.startsWith("app/"))) return "app";
  return "app";
}

export function libDirPrefix(files: ProjectFile[]): string {
  if (files.some((f) => f.path.startsWith("src/lib/"))) return "src/lib";
  if (files.some((f) => f.path.startsWith("lib/"))) return "lib";
  if (files.some((f) => f.path.startsWith("src/"))) return "src/lib";
  return "lib";
}

export function contentDirPrefix(files: ProjectFile[]): string {
  if (files.some((f) => f.path.startsWith("src/content/"))) return "src/content";
  return "content";
}

function routeFromAppFile(filePath: string, appPrefix: string): string | null {
  if (!filePath.startsWith(`${appPrefix}/`)) return null;
  const rest = filePath.slice(appPrefix.length + 1);
  const match = rest.match(
    /^(.*)\/(page|layout|route)\.(tsx|ts|jsx|js|mdx)$/,
  );
  if (!match) {
    if (/^page\.(tsx|ts|jsx|js|mdx)$/.test(rest)) return "/";
    if (/^layout\.(tsx|ts|jsx|js)$/.test(rest)) return "/";
    if (/^route\.(tsx|ts|jsx|js)$/.test(rest)) return "/";
    return null;
  }
  const segments = match[1]
    .split("/")
    .filter((s) => s && !s.startsWith("(") && !s.endsWith(")"))
    .filter((s) => !s.startsWith("@"))
    .map((s) => (s.startsWith("[") ? `:${s.replace(/[\[\]]/g, "")}` : s));
  return "/" + segments.join("/");
}

function routeFromPagesFile(filePath: string): string | null {
  const prefixes = ["pages/", "src/pages/"];
  for (const prefix of prefixes) {
    if (!filePath.startsWith(prefix)) continue;
    let rest = filePath.slice(prefix.length);
    if (rest.startsWith("api/")) return null;
    rest = rest.replace(/\.(tsx|ts|jsx|js)$/, "");
    if (rest === "index") return "/";
    if (rest.endsWith("/index")) rest = rest.slice(0, -"/index".length);
    const segments = rest
      .split("/")
      .map((s) => (s.startsWith("[") ? `:${s.replace(/[\[\]]/g, "")}` : s));
    return "/" + segments.join("/");
  }
  return null;
}

export function extractStringProp(
  source: string,
  prop: string,
): string | undefined {
  const patterns = [
    new RegExp(`${prop}\\s*:\\s*["'\`]([^"'\`]+)["'\`]`),
    new RegExp(`${prop}\\s*=\\s*["'\`]([^"'\`]+)["'\`]`),
    new RegExp(`["'\`]${prop}["'\`]\\s*:\\s*["'\`]([^"'\`]+)["'\`]`),
  ];
  for (const re of patterns) {
    const m = source.match(re);
    if (m?.[1]) return m[1];
  }
  return undefined;
}

export function extractTitleTemplate(source: string): string | undefined {
  const m = source.match(/template\s*:\s*["'`]([^"'`]+)["'`]/);
  return m?.[1];
}

export function extractMetadataBase(source: string): string | undefined {
  const m = source.match(
    /metadataBase\s*:\s*new\s+URL\(\s*["'`]([^"'`]+)["'`]\s*\)/,
  );
  return m?.[1];
}

export function countH1(source: string): number {
  const jsx = (source.match(/<h1[\s>]/g) ?? []).length;
  const md = (source.match(/^#\s+/gm) ?? []).length;
  return jsx + md;
}

export function extractHeadings(source: string): string[] {
  const headings: string[] = [];
  const jsxRe = /<h([1-3])[^>]*>([\s\S]*?)<\/h\1>/gi;
  let m: RegExpExecArray | null;
  while ((m = jsxRe.exec(source))) {
    const text = m[2].replace(/<[^>]+>/g, "").trim();
    if (text) headings.push(text);
  }
  const mdRe = /^(#{1,3})\s+(.+)$/gm;
  while ((m = mdRe.exec(source))) {
    headings.push(m[2].trim());
  }
  return headings.slice(0, 40);
}

export function countImagesMissingAlt(source: string): number {
  const imgs = source.match(/<(?:Image|img)\b[^>]*>/g) ?? [];
  let missing = 0;
  for (const tag of imgs) {
    if (!/\balt\s*=/.test(tag)) missing += 1;
  }
  return missing;
}

export function extractInternalLinks(source: string): string[] {
  const links = new Set<string>();
  const re = /(?:href|to)=["'`](\/[^"'`#?]*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source))) {
    links.add(m[1]);
  }
  return [...links];
}

export function hasMetadataExport(source: string): boolean {
  return (
    /export\s+(const|async\s+function|function)\s+metadata\b/.test(source) ||
    /export\s+async\s+function\s+generateMetadata\b/.test(source) ||
    /<Head>/.test(source) ||
    /next\/head/.test(source)
  );
}

export function hasCanonical(source: string): boolean {
  return (
    /alternates\s*:\s*\{[\s\S]*canonical/.test(source) ||
    /rel=["']canonical["']/.test(source) ||
    /canonical\s*:/.test(source)
  );
}

export function extractJsonLdTypes(source: string): string[] {
  const types = new Set<string>();
  const re = /"@type"\s*:\s*"([^"]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source))) {
    types.add(m[1]);
  }
  const schemaOrg = /schema\.org\/(\w+)/g;
  while ((m = schemaOrg.exec(source))) {
    types.add(m[1]);
  }
  return [...types];
}

export function buildRouteInfo(
  file: ProjectFile,
  router: "app" | "pages" | "unknown",
  appPrefix: string,
): RouteInfo | null {
  let routePath: string | null = null;
  let kind: RouteInfo["kind"] = "other";

  if (router === "app") {
    routePath = routeFromAppFile(file.path, appPrefix);
    if (file.path.endsWith("/page.tsx") || file.path.endsWith("/page.ts") || file.path.endsWith("/page.jsx") || file.path.endsWith("/page.js") || file.path.endsWith("/page.mdx") || /\/page\.(tsx|ts|jsx|js|mdx)$/.test(file.path) || /^app\/page\./.test(file.path) || /^src\/app\/page\./.test(file.path)) {
      kind = "page";
    } else if (/layout\.(tsx|ts|jsx|js)$/.test(file.path)) {
      kind = "layout";
    } else if (/route\.(tsx|ts|jsx|js)$/.test(file.path)) {
      kind = "route";
    }
  } else if (router === "pages") {
    routePath = routeFromPagesFile(file.path);
    kind = "page";
  }

  if (!routePath && kind === "other") return null;
  if (!routePath) routePath = "/";

  return {
    path: routePath,
    file: file.path,
    kind,
    title:
      extractStringProp(file.content, "title") ??
      extractStringProp(file.content, "default"),
    description: extractStringProp(file.content, "description"),
    hasMetadata: hasMetadataExport(file.content),
    hasCanonical: hasCanonical(file.content),
    headings: extractHeadings(file.content),
    h1Count: countH1(file.content),
    imagesMissingAlt: countImagesMissingAlt(file.content),
    internalLinks: extractInternalLinks(file.content),
  };
}

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
  aiCrawlers: { name: string; status: "allowed" | "disallowed" | "unknown"; evidence?: string }[];
} {
  const lines = content.split(/\r?\n/);
  let currentAgents: string[] = [];
  const rules: { agent: string; type: "allow" | "disallow"; path: string }[] = [];

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
        status: starDisallowsRoot ? ("disallowed" as const) : ("allowed" as const),
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

export function tokenize(...parts: (string | undefined)[]): string[] {
  const stop = new Set([
    "the",
    "and",
    "for",
    "with",
    "your",
    "our",
    "from",
    "this",
    "that",
    "into",
    "a",
    "an",
    "to",
    "of",
    "in",
    "on",
    "is",
    "are",
    "be",
    "as",
    "by",
    "or",
    "at",
  ]);
  const tokens = new Set<string>();
  for (const part of parts) {
    if (!part) continue;
    for (const raw of part.toLowerCase().split(/[^a-z0-9]+/)) {
      if (raw.length < 3 || stop.has(raw)) continue;
      tokens.add(raw);
    }
  }
  return [...tokens];
}
