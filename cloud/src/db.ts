import type { Env } from "./env.js";

export function id(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "")}`;
}

export async function upsertUser(
  db: D1Database,
  clerkUserId: string,
  email: string,
): Promise<{ id: string; plan: string; stripe_customer_id: string | null }> {
  const existing = await db
    .prepare(
      "SELECT id, plan, stripe_customer_id FROM users WHERE clerk_user_id = ?",
    )
    .bind(clerkUserId)
    .first<{ id: string; plan: string; stripe_customer_id: string | null }>();
  if (existing) return existing;

  const userId = id("usr");
  await db
    .prepare(
      "INSERT INTO users (id, clerk_user_id, email, plan) VALUES (?, ?, ?, 'free')",
    )
    .bind(userId, clerkUserId, email)
    .run();
  return { id: userId, plan: "free", stripe_customer_id: null };
}

export async function getUserByClerkId(db: D1Database, clerkUserId: string) {
  return db
    .prepare(
      "SELECT * FROM users WHERE clerk_user_id = ?",
    )
    .bind(clerkUserId)
    .first<{
      id: string;
      email: string;
      plan: string;
      stripe_customer_id: string | null;
      api_key_hash: string | null;
    }>();
}

export async function getUserByApiKeyHash(db: D1Database, hash: string) {
  return db
    .prepare("SELECT * FROM users WHERE api_key_hash = ?")
    .bind(hash)
    .first<{
      id: string;
      email: string;
      plan: string;
    }>();
}

export async function listSites(db: D1Database, userId: string) {
  const res = await db
    .prepare(
      "SELECT * FROM sites WHERE user_id = ? ORDER BY created_at DESC",
    )
    .bind(userId)
    .all();
  return res.results ?? [];
}

export async function countActiveSites(db: D1Database, userId: string) {
  const row = await db
    .prepare(
      "SELECT COUNT(*) as c FROM sites WHERE user_id = ? AND active = 1",
    )
    .bind(userId)
    .first<{ c: number }>();
  return row?.c ?? 0;
}

export async function createSite(
  db: D1Database,
  userId: string,
  url: string,
  name?: string,
) {
  const siteId = id("site");
  await db
    .prepare(
      "INSERT INTO sites (id, user_id, url, name, active) VALUES (?, ?, ?, ?, 1)",
    )
    .bind(siteId, userId, url, name ?? new URL(url).hostname)
    .run();
  return siteId;
}

export async function getSite(db: D1Database, siteId: string) {
  return db
    .prepare("SELECT * FROM sites WHERE id = ?")
    .bind(siteId)
    .first<{
      id: string;
      user_id: string;
      url: string;
      name: string | null;
      active: number;
    }>();
}

export async function listActiveProSites(db: D1Database) {
  const res = await db
    .prepare(
      `SELECT s.* FROM sites s
       JOIN users u ON u.id = s.user_id
       WHERE s.active = 1 AND u.plan = 'pro'`,
    )
    .all();
  return (res.results ?? []) as Array<{
    id: string;
    user_id: string;
    url: string;
    name: string | null;
  }>;
}

export async function latestRun(db: D1Database, siteId: string) {
  return db
    .prepare(
      "SELECT * FROM runs WHERE site_id = ? AND status = 'completed' ORDER BY started_at DESC LIMIT 1",
    )
    .bind(siteId)
    .first<{
      id: string;
      summary_json: string | null;
      envelope_json: string | null;
      started_at: string;
    }>();
}

export async function listRuns(db: D1Database, siteId: string, limit = 20) {
  const res = await db
    .prepare(
      "SELECT id, started_at, finished_at, status, summary_json FROM runs WHERE site_id = ? ORDER BY started_at DESC LIMIT ?",
    )
    .bind(siteId, limit)
    .all();
  return res.results ?? [];
}

export async function listFindings(db: D1Database, runId: string) {
  const res = await db
    .prepare("SELECT * FROM findings WHERE run_id = ?")
    .bind(runId)
    .all();
  return res.results ?? [];
}

export async function sha256(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export type { Env };
