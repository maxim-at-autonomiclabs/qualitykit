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

function clerkClient(env: Env) {
  return createClerkClient({
    secretKey: env.CLERK_SECRET_KEY,
    publishableKey: env.CLERK_PUBLISHABLE_KEY,
    proxyUrl: CLERK_PROXY_URL,
  });
}

async function resolveClerkUserId(
  c: Context<{ Bindings: Env }>,
  token: string,
): Promise<{ userId: string } | { error: string; reason: string }> {
  const parties = authorizedParties(c.env);
  const clerk = clerkClient(c.env);

  try {
    const state = await clerk.authenticateRequest(c.req.raw, {
      secretKey: c.env.CLERK_SECRET_KEY,
      publishableKey: c.env.CLERK_PUBLISHABLE_KEY,
      proxyUrl: CLERK_PROXY_URL,
      authorizedParties: parties,
    });
    if (state.isAuthenticated) {
      const { userId } = state.toAuth();
      if (userId) return { userId };
    }
  } catch (error) {
    console.error(
      "clerk authenticateRequest threw",
      error instanceof Error ? error.message : error,
    );
  }

  // SPA calls send Bearer only (session cookies live on the proxy domain).
  // Omit `issuer` so proxy-issued tokens (iss = proxy URL) verify against JWKS.
  try {
    const payload = await verifyToken(token, {
      secretKey: c.env.CLERK_SECRET_KEY,
      authorizedParties: parties,
      clockSkewInMs: 15_000,
    });
    if (payload.sub) return { userId: payload.sub };
    return { error: "Unauthorized", reason: "missing_sub" };
  } catch (error) {
    const reason =
      error && typeof error === "object" && "reason" in error
        ? String((error as { reason?: string }).reason)
        : error instanceof Error
          ? error.message
          : "verify_failed";
    console.error("clerk verifyToken failed", reason);
    return { error: "Invalid session", reason };
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
      { error: resolved.error, reason: resolved.reason },
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
