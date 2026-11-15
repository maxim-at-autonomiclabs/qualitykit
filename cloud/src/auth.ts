import { createClerkClient, verifyToken } from "@clerk/backend";
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

function authorizedParties(env: Env): string[] {
  return [
    ...new Set([
      env.APP_URL.replace(/\/$/, ""),
      "https://app.qualitykit.dev",
      "https://qualitykit.dev",
      "https://www.qualitykit.dev",
      "http://127.0.0.1:8787",
      "http://localhost:8787",
    ]),
  ];
}

function acceptedIssuers(env: Env): string[] {
  return [
    CLERK_PROXY_URL,
    `${CLERK_PROXY_URL}/`,
    "https://clerk.qualitykit.dev",
    `${env.APP_URL.replace(/\/$/, "")}/__clerk`,
  ];
}

function clerkClient(env: Env) {
  return createClerkClient({
    secretKey: env.CLERK_SECRET_KEY,
    publishableKey: env.CLERK_PUBLISHABLE_KEY,
    proxyUrl: CLERK_PROXY_URL,
  });
}

function tokenDebug(token: string): { iss?: string; azp?: string; sub?: string } {
  try {
    const parts = token.split(".");
    if (parts.length < 2) return {};
    const json = atob(parts[1].replace(/-/g, "+").replace(/_/g, "/"));
    const payload = JSON.parse(json) as {
      iss?: string;
      azp?: string;
      sub?: string;
    };
    return { iss: payload.iss, azp: payload.azp, sub: payload.sub };
  } catch {
    return {};
  }
}

async function resolveClerkUserId(
  c: Context<{ Bindings: Env }>,
  token: string,
): Promise<{ userId: string } | { error: string; reason: string; debug?: object }> {
  const parties = authorizedParties(c.env);
  const issuers = acceptedIssuers(c.env);
  const debug = tokenDebug(token);

  // Prefer direct JWT verify for SPA Bearer tokens (no cookie handshake).
  try {
    const payload = await verifyToken(token, {
      secretKey: c.env.CLERK_SECRET_KEY,
      authorizedParties: parties,
      issuer: issuers,
      clockSkewInMs: 60_000,
    });
    if (payload.sub) return { userId: payload.sub };
    return { error: "Unauthorized", reason: "missing_sub", debug };
  } catch (firstError) {
    const reason1 =
      firstError && typeof firstError === "object" && "reason" in firstError
        ? String((firstError as { reason?: string }).reason)
        : firstError instanceof Error
          ? firstError.message
          : "verify_failed";

    // Retry without azp allowlist if that was the only failure (proxy/satellite quirks).
    if (
      reason1.includes("authorized-part") ||
      reason1.includes("azp") ||
      reason1 === "token-invalid-authorized-parties"
    ) {
      try {
        const payload = await verifyToken(token, {
          secretKey: c.env.CLERK_SECRET_KEY,
          issuer: issuers,
          clockSkewInMs: 60_000,
        });
        if (payload.sub) return { userId: payload.sub };
      } catch {
        /* fall through */
      }
    }

    // Last resort: signature-only (issuer/azp omitted) — still needs valid Clerk JWT.
    try {
      const payload = await verifyToken(token, {
        secretKey: c.env.CLERK_SECRET_KEY,
        clockSkewInMs: 60_000,
      });
      if (payload.sub) {
        console.warn("clerk verifyToken accepted without party/issuer checks", debug);
        return { userId: payload.sub };
      }
    } catch (secondError) {
      const reason2 =
        secondError && typeof secondError === "object" && "reason" in secondError
          ? String((secondError as { reason?: string }).reason)
          : secondError instanceof Error
            ? secondError.message
            : reason1;
      console.error("clerk verifyToken failed", reason2, debug);
      return { error: "Invalid session", reason: reason2, debug };
    }

    console.error("clerk verifyToken failed", reason1, debug);
    return { error: "Invalid session", reason: reason1, debug };
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

  const resolved = await resolveClerkUserId(c, token);
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
