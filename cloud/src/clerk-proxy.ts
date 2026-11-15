import type { Env } from "./env.js";

const PROXY_PREFIX = "/__clerk";
const CLERK_FAPI = "https://frontend-api.clerk.dev";

export function isClerkProxyPath(pathname: string): boolean {
  return pathname === PROXY_PREFIX || pathname.startsWith(`${PROXY_PREFIX}/`);
}

/** Forward /__clerk/* → Clerk Frontend API (avoids needing clerk.* DNS CNAMEs). */
export async function proxyClerkFrontendApi(
  request: Request,
  env: Env,
): Promise<Response> {
  const url = new URL(request.url);
  const suffix = url.pathname.slice(PROXY_PREFIX.length) || "/";
  const target = new URL(suffix + url.search, CLERK_FAPI);

  const headers = new Headers(request.headers);
  headers.delete("host");
  headers.set("Clerk-Proxy-Url", `${env.APP_URL}${PROXY_PREFIX}`);
  headers.set("Clerk-Secret-Key", env.CLERK_SECRET_KEY);
  const clientIp =
    request.headers.get("CF-Connecting-IP") ||
    request.headers.get("X-Real-IP") ||
    "0.0.0.0";
  headers.set("X-Forwarded-For", clientIp);

  const init: RequestInit = {
    method: request.method,
    headers,
    redirect: "manual",
  };
  if (request.method !== "GET" && request.method !== "HEAD") {
    init.body = request.body;
    // @ts-expect-error duplex required for streaming body in Workers
    init.duplex = "half";
  }

  const upstream = await fetch(target.toString(), init);
  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: upstream.headers,
  });
}
