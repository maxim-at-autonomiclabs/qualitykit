/**
 * Marketing Worker: static assets + Clerk Frontend API proxy at /__clerk/*
 * (Proxy must live on qualitykit.dev — same domain as the Clerk production domain.)
 */
const PROXY_PREFIX = "/__clerk";
const CLERK_FAPI = "https://frontend-api.clerk.dev";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (
      url.pathname === PROXY_PREFIX ||
      url.pathname.startsWith(`${PROXY_PREFIX}/`)
    ) {
      return proxyClerk(request, env);
    }

    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }
    return new Response("QualityKit", { status: 200 });
  },
};

async function proxyClerk(request, env) {
  const url = new URL(request.url);
  const suffix = url.pathname.slice(PROXY_PREFIX.length) || "/";
  const target = new URL(suffix + url.search, CLERK_FAPI);

  const headers = new Headers(request.headers);
  headers.delete("host");
  headers.set("Clerk-Proxy-Url", "https://qualitykit.dev/__clerk");
  const secret = env.CLERK_SECRET_KEY;
  if (!secret) {
    return new Response("CLERK_SECRET_KEY not configured on qualitykit-web", {
      status: 500,
    });
  }
  headers.set("Clerk-Secret-Key", secret);
  const clientIp =
    request.headers.get("CF-Connecting-IP") ||
    request.headers.get("X-Real-IP") ||
    "0.0.0.0";
  headers.set("X-Forwarded-For", clientIp);

  const init = {
    method: request.method,
    headers,
    redirect: "manual",
  };
  if (request.method !== "GET" && request.method !== "HEAD") {
    init.body = request.body;
    init.duplex = "half";
  }

  const upstream = await fetch(target.toString(), init);
  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: upstream.headers,
  });
}
