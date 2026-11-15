export interface RenderedPage {
  url: string;
  path: string;
  ok: boolean;
  status?: number;
  error?: string;
  html?: string;
  title?: string;
  description?: string;
  canonical?: string;
  ogTitle?: string;
  ogDescription?: string;
  robotsMeta?: string;
  headings: string[];
  h1: string[];
  jsonLd: unknown[];
}

export interface FetchHtmlOptions {
  timeoutMs?: number;
  maxBytes?: number;
  paths?: string[];
  /** Injected for tests */
  fetchImpl?: typeof fetch;
}

const DEFAULT_TIMEOUT = 8_000;
const DEFAULT_MAX_BYTES = 1_000_000;

export function parseHtmlSignals(html: string): Omit<
  RenderedPage,
  "url" | "path" | "ok" | "status" | "error" | "html"
> {
  const title = matchContent(html, /<title[^>]*>([\s\S]*?)<\/title>/i);
  const description =
    matchAttr(
      html,
      /<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["'][^>]*>/i,
    ) ??
    matchAttr(
      html,
      /<meta[^>]+content=["']([^"']*)["'][^>]+name=["']description["'][^>]*>/i,
    );
  const canonical =
    matchAttr(html, /<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["'][^>]*>/i) ??
    matchAttr(html, /<link[^>]+href=["']([^"']+)["'][^>]+rel=["']canonical["'][^>]*>/i);
  const ogTitle =
    matchAttr(html, /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']*)["']/i) ??
    matchAttr(html, /<meta[^>]+content=["']([^"']*)["'][^>]+property=["']og:title["']/i);
  const ogDescription =
    matchAttr(
      html,
      /<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']*)["']/i,
    ) ??
    matchAttr(
      html,
      /<meta[^>]+content=["']([^"']*)["'][^>]+property=["']og:description["']/i,
    );
  const robotsMeta =
    matchAttr(html, /<meta[^>]+name=["']robots["'][^>]+content=["']([^"']*)["']/i) ??
    matchAttr(html, /<meta[^>]+content=["']([^"']*)["'][^>]+name=["']robots["']/i);

  const h1: string[] = [];
  const headings: string[] = [];
  const h1Re = /<h1\b[^>]*>([\s\S]*?)<\/h1>/gi;
  let m: RegExpExecArray | null;
  while ((m = h1Re.exec(html))) {
    const text = stripTags(m[1]).trim();
    if (text) h1.push(text);
  }
  const hRe = /<h([1-3])\b[^>]*>([\s\S]*?)<\/h\1>/gi;
  while ((m = hRe.exec(html))) {
    const text = stripTags(m[2]).trim();
    if (text) headings.push(text);
  }

  const jsonLd: unknown[] = [];
  const ldRe =
    /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  while ((m = ldRe.exec(html))) {
    try {
      jsonLd.push(JSON.parse(m[1]));
    } catch {
      // ignore invalid blocks
    }
  }

  return {
    title: title ? stripTags(title).trim() : undefined,
    description: description || undefined,
    canonical: canonical || undefined,
    ogTitle: ogTitle || undefined,
    ogDescription: ogDescription || undefined,
    robotsMeta: robotsMeta || undefined,
    headings,
    h1,
    jsonLd,
  };
}

function matchContent(html: string, re: RegExp): string | undefined {
  const m = html.match(re);
  return m?.[1];
}

function matchAttr(html: string, re: RegExp): string | undefined {
  const m = html.match(re);
  return m?.[1];
}

function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
}

export async function fetchRenderedPages(
  siteUrl: string,
  options: FetchHtmlOptions = {},
): Promise<RenderedPage[]> {
  const base = siteUrl.replace(/\/$/, "");
  const paths = options.paths?.length ? options.paths : ["/"];
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const fetchImpl = options.fetchImpl ?? fetch;
  const results: RenderedPage[] = [];

  for (const path of paths) {
    const url = path.startsWith("http") ? path : `${base}${path === "/" ? "" : path}`;
    const pathName = path.startsWith("http")
      ? safePath(path)
      : path.startsWith("/")
        ? path
        : `/${path}`;

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const res = await fetchImpl(url, {
        signal: controller.signal,
        redirect: "follow",
        headers: { "User-Agent": "QualityKitAudit/0.1 (+local-mcp; read-only)" },
      });
      clearTimeout(timer);

      const buf = new Uint8Array(await res.arrayBuffer());
      if (buf.byteLength > maxBytes) {
        results.push({
          url,
          path: pathName,
          ok: false,
          status: res.status,
          error: `Response exceeded ${maxBytes} bytes`,
          headings: [],
          h1: [],
          jsonLd: [],
        });
        continue;
      }

      const html = new TextDecoder("utf-8", { fatal: false }).decode(buf);
      const signals = parseHtmlSignals(html);
      results.push({
        url,
        path: pathName,
        ok: res.ok,
        status: res.status,
        error: res.ok ? undefined : `HTTP ${res.status}`,
        html,
        ...signals,
      });
    } catch (error) {
      results.push({
        url,
        path: pathName,
        ok: false,
        error: error instanceof Error ? error.message : "Fetch failed",
        headings: [],
        h1: [],
        jsonLd: [],
      });
    }
  }

  return results;
}

function safePath(url: string): string {
  try {
    return new URL(url).pathname || "/";
  } catch {
    return "/";
  }
}
