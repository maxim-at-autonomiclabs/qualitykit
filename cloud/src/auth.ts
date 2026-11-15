import { createClerkClient } from "@clerk/backend";
import type { Context } from "hono";
import { getUserByApiKeyHash, sha256, upsertUser } from "./db.js";
import type { Env } from "./env.js";

export type AuthUser = {
  id: string;
  email: string;
  plan: string;
  clerkUserId?: string;
};

/** Clerk Frontend API proxy on the primary domain (must match Dashboard + client). */
export const CLERK_PROXY_URL = "https://qualitykit.dev/__clerk";
const JWKS_URL = `${CLERK_PROXY_URL}/.well-known/jwks.json`;

function authorizedParties(env: Env): Set<string> {
  return new Set([
    env.APP_URL.replace(/\/$/, ""),
    "https://app.qualitykit.dev",
    "https://qualitykit.dev",
    "https://www.qualitykit.dev",
    "http://127.0.0.1:8787",
    "http://localhost:8787",
  ]);
}

function acceptedIssuers(env: Env): Set<string> {
  return new Set([
    CLERK_PROXY_URL,
    `${CLERK_PROXY_URL}/`,
    "https://clerk.qualitykit.dev",
    `${env.APP_URL.replace(/\/$/, "")}/__clerk`,
  ]);
}

function clerkClient(env: Env) {
  return createClerkClient({
    secretKey: env.CLERK_SECRET_KEY,
    publishableKey: env.CLERK_PUBLISHABLE_KEY,
    proxyUrl: CLERK_PROXY_URL,
  });
}

function b64urlJson<T>(part: string): T {
  const padded = part.replace(/-/g, "+").replace(/_/g, "/");
  const pad = "=".repeat((4 - (padded.length % 4)) % 4);
  return JSON.parse(atob(padded + pad)) as T;
}

function b64urlToBytes(part: string): Uint8Array {
  const padded = part.replace(/-/g, "+").replace(/_/g, "/");
  const pad = "=".repeat((4 - (padded.length % 4)) % 4);
  const bin = atob(padded + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

type Jwk = JsonWebKey & { kid?: string; use?: string; alg?: string };

let jwksCache: { fetchedAt: number; keys: Jwk[] } | null = null;

async function loadJwks(env: Env): Promise<Jwk[]> {
  const now = Date.now();
  if (jwksCache && now - jwksCache.fetchedAt < 60 * 60 * 1000) {
    return jwksCache.keys;
  }

  // Prefer dashboard PEM (networkless). Convert once into a synthetic JWK list.
  if (env.CLERK_JWT_KEY) {
    const pem = env.CLERK_JWT_KEY.replace(/\\n/g, "\n").trim();
    const key = await crypto.subtle.importKey(
      "spki",
      pemToSpki(pem),
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      true,
      ["verify"],
    );
    const jwk = (await crypto.subtle.exportKey("jwk", key)) as Jwk;
    jwk.kid = "local-pem";
    jwk.alg = "RS256";
    jwksCache = { fetchedAt: now, keys: [jwk] };
    return jwksCache.keys;
  }

  // Workers often can't load JWKS via Clerk Backend API → jwk-failed-to-resolve.
  // Public JWKS through our FAPI proxy works from the edge.
  const res = await fetch(JWKS_URL, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) {
    throw new Error(`jwks_fetch_${res.status}`);
  }
  const body = (await res.json()) as { keys?: Jwk[] };
  const keys = body.keys ?? [];
  if (!keys.length) throw new Error("jwks_empty");
  jwksCache = { fetchedAt: now, keys };
  return keys;
}

function pemToSpki(pem: string): ArrayBuffer {
  const b64 = pem
    .replace(/-----BEGIN PUBLIC KEY-----/g, "")
    .replace(/-----END PUBLIC KEY-----/g, "")
    .replace(/\s+/g, "");
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

async function verifySessionJwt(
  token: string,
  env: Env,
): Promise<
  | { userId: string }
  | { error: string; reason: string; debug?: Record<string, unknown> }
> {
  const parts = token.split(".");
  if (parts.length !== 3) {
    return { error: "Invalid session", reason: "token-invalid", debug: {} };
  }

  let header: { kid?: string; alg?: string };
  let payload: {
    sub?: string;
    iss?: string;
    azp?: string;
    exp?: number;
    nbf?: number;
    iat?: number;
  };
  try {
    header = b64urlJson(parts[0]);
    payload = b64urlJson(parts[1]);
  } catch {
    return { error: "Invalid session", reason: "token-invalid", debug: {} };
  }

  const debug = { iss: payload.iss, azp: payload.azp, sub: payload.sub, kid: header.kid };
  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.nbf === "number" && now + 60 < payload.nbf) {
    return { error: "Invalid session", reason: "token-not-active-yet", debug };
  }
  if (typeof payload.exp === "number" && now - 60 >= payload.exp) {
    return { error: "Invalid session", reason: "token-expired", debug };
  }
  if (payload.iss && !acceptedIssuers(env).has(payload.iss)) {
    return { error: "Invalid session", reason: "token-invalid-issuer", debug };
  }
  if (payload.azp && !authorizedParties(env).has(payload.azp)) {
    return {
      error: "Invalid session",
      reason: "token-invalid-authorized-parties",
      debug,
    };
  }
  if (!payload.sub) {
    return { error: "Unauthorized", reason: "missing_sub", debug };
  }

  try {
    const keys = await loadJwks(env);
    const jwk =
      keys.find((k) => k.kid && k.kid === header.kid) ??
      (keys.length === 1 ? keys[0] : undefined);
    if (!jwk?.n || !jwk?.e) {
      return { error: "Invalid session", reason: "jwk-kid-mismatch", debug };
    }

    const key = await crypto.subtle.importKey(
      "jwk",
      { kty: "RSA", n: jwk.n, e: jwk.e, alg: "RS256", ext: true },
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"],
    );

    const data = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
    const signature = b64urlToBytes(parts[2]);
    const ok = await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      key,
      signature,
      data,
    );
    if (!ok) {
      return { error: "Invalid session", reason: "token-invalid-signature", debug };
    }
    return { userId: payload.sub };
  } catch (error) {
    const reason = error instanceof Error ? error.message : "jwk-verify-failed";
    console.error("session jwt verify failed", reason, debug);
    return { error: "Invalid session", reason, debug };
  }
}

export async function requireUser(
  c: Context<{ Bindings: Env }>,
): Promise<AuthUser | Response> {
  const apiKey = c.req.header("x-qualitykit-key");
  if (apiKey) {
    const hash = await sha256(apiKey);
    const user = await getUserByApiKeyHash(c.env.DB, hash);
    if (!user) {
      return c.json({ error: "Invalid API key" }, 401);
    }
    return { id: user.id, email: user.email, plan: user.plan };
  }

  const authHeader = c.req.header("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  const token = authHeader.slice("Bearer ".length);

  const resolved = await verifySessionJwt(token, c.env);
  if ("error" in resolved) {
    return c.json(
      {
        error: resolved.error,
        reason: resolved.reason,
        debug: resolved.debug,
      },
      401,
    );
  }

  const clerkUserId = resolved.userId;
  const clerk = clerkClient(c.env);
  const clerkUser = await clerk.users.getUser(clerkUserId);
  const email =
    clerkUser.emailAddresses.find(
      (e) => e.id === clerkUser.primaryEmailAddressId,
    )?.emailAddress ??
    clerkUser.emailAddresses[0]?.emailAddress ??
    `${clerkUserId}@users.clerk`;

  const user = await upsertUser(c.env.DB, clerkUserId, email);
  return {
    id: user.id,
    email,
    plan: user.plan,
    clerkUserId,
  };
}

export function isAuthUser(value: AuthUser | Response): value is AuthUser {
  return (
    typeof value === "object" &&
    value !== null &&
    "id" in value &&
    "plan" in value
  );
}

export async function requirePro(
  c: Context<{ Bindings: Env }>,
): Promise<AuthUser | Response> {
  const user = await requireUser(c);
  if (!isAuthUser(user)) return user;
  if (user.plan !== "pro") {
    return c.json(
      {
        error: "Pro required",
        upgradeUrl: `${c.env.APP_URL}/pricing.html`,
      },
      402,
    );
  }
  return user;
}
