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

function authorizedParties(env: Env): string[] {
  const parties = new Set<string>([
    env.APP_URL.replace(/\/$/, ""),
    "https://app.qualitykit.dev",
    "https://qualitykit.dev",
    "http://127.0.0.1:8787",
    "http://localhost:8787",
  ]);
  return [...parties];
}

function acceptedIssuers(env: Env): string[] {
  // With FAPI proxy, session tokens use the proxy URL as issuer.
  return [
    "https://qualitykit.dev/__clerk",
    "https://clerk.qualitykit.dev",
    `${env.APP_URL.replace(/\/$/, "")}/__clerk`,
  ];
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

  const auth = c.req.header("authorization");
  if (!auth?.startsWith("Bearer ")) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  const token = auth.slice("Bearer ".length);
  try {
    const payload = await verifyToken(token, {
      secretKey: c.env.CLERK_SECRET_KEY,
      authorizedParties: authorizedParties(c.env),
      issuer: acceptedIssuers(c.env),
      clockSkewInMs: 15_000,
    });
    const clerkUserId = payload.sub;
    if (!clerkUserId) return c.json({ error: "Unauthorized" }, 401);

    const clerk = createClerkClient({ secretKey: c.env.CLERK_SECRET_KEY });
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
  } catch (error) {
    const reason =
      error && typeof error === "object" && "reason" in error
        ? String((error as { reason?: string }).reason)
        : error instanceof Error
          ? error.message
          : "verify_failed";
    console.error("clerk verifyToken failed", reason);
    return c.json({ error: "Invalid session", reason }, 401);
  }
}

export function isAuthUser(value: AuthUser | Response): value is AuthUser {
  return typeof value === "object" && value !== null && "id" in value && "plan" in value;
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
