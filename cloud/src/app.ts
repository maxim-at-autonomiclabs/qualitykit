import { Hono } from "hono";
import { isAuthUser, requirePro, requireUser } from "./auth.js";
import {
  countActiveSites,
  createSite,
  getSite,
  latestRun,
  listFindings,
  listRuns,
  listSites,
  sha256,
} from "./db.js";
import type { CrawlMessage, Env } from "./env.js";
import {
  createCheckoutSession,
  createPortalSession,
  handleStripeWebhook,
} from "./stripe.js";

export function createApp() {
  const app = new Hono<{ Bindings: Env }>();

  app.get("/api/health", (c) =>
    c.json({
      ok: true,
      service: "qualitykit-cloud",
      version: "0.3.0",
      appUrl: c.env.APP_URL,
      stripePriceConfigured: Boolean(
        c.env.STRIPE_PRICE_ID && !c.env.STRIPE_PRICE_ID.includes("REPLACE"),
      ),
      stripeInlinePriceFallback: !(
        c.env.STRIPE_PRICE_ID && !c.env.STRIPE_PRICE_ID.includes("REPLACE")
      ),
      clerkConfigured: Boolean(
        c.env.CLERK_PUBLISHABLE_KEY &&
          !c.env.CLERK_PUBLISHABLE_KEY.includes("REPLACE") &&
          (c.env.CLERK_PUBLISHABLE_KEY.startsWith("pk_live_") ||
            c.env.CLERK_PUBLISHABLE_KEY.startsWith("pk_test_")),
      ),
    }),
  );

  /** Public bootstrap for the dashboard (no secrets). */
  app.get("/api/config", (c) =>
    c.json({
      clerkPublishableKey: c.env.CLERK_PUBLISHABLE_KEY,
      // Proxy lives on the Clerk primary domain (apex), not app subdomain
      clerkProxyUrl: "https://qualitykit.dev/__clerk",
      appUrl: c.env.APP_URL,
      proPriceUsd: 29,
    }),
  );

  app.get("/api/me", async (c) => {
    const user = await requireUser(c);
    if (!isAuthUser(user)) return user;
    const sites = await listSites(c.env.DB, user.id);
    return c.json({ user, sites });
  });

  app.post("/api/sites", async (c) => {
    const user = await requirePro(c);
    if (!isAuthUser(user)) return user;

    const body = await c.req.json<{ url?: string; name?: string }>();
    if (!body.url) return c.json({ error: "url required" }, 400);
    let parsed: URL;
    try {
      parsed = new URL(body.url);
      if (!/^https?:$/.test(parsed.protocol)) throw new Error("bad protocol");
    } catch {
      return c.json({ error: "valid https URL required" }, 400);
    }

    const count = await countActiveSites(c.env.DB, user.id);
    if (count >= 1) {
      return c.json(
        { error: "Pro includes 1 monitored site. Remove the existing site first." },
        400,
      );
    }

    const siteId = await createSite(
      c.env.DB,
      user.id,
      parsed.origin,
      body.name,
    );
    await c.env.CRAWL_QUEUE.send({
      siteId,
      reason: "manual",
    } satisfies CrawlMessage);

    return c.json({ id: siteId, url: parsed.origin }, 201);
  });

  app.get("/api/sites/:id/runs", async (c) => {
    const user = await requirePro(c);
    if (!isAuthUser(user)) return user;
    const site = await getSite(c.env.DB, c.req.param("id"));
    if (!site || site.user_id !== user.id) {
      return c.json({ error: "Not found" }, 404);
    }
    const runs = await listRuns(c.env.DB, site.id);
    return c.json({ site, runs });
  });

  app.get("/api/sites/:id/latest", async (c) => {
    const user = await requirePro(c);
    if (!isAuthUser(user)) return user;
    const site = await getSite(c.env.DB, c.req.param("id"));
    if (!site || site.user_id !== user.id) {
      return c.json({ error: "Not found" }, 404);
    }
    const run = await latestRun(c.env.DB, site.id);
    if (!run) return c.json({ site, run: null, findings: [] });
    const findings = await listFindings(c.env.DB, run.id);
    return c.json({
      site,
      run: {
        ...run,
        summary: run.summary_json ? JSON.parse(run.summary_json) : null,
        envelope: run.envelope_json ? JSON.parse(run.envelope_json) : null,
      },
      findings,
    });
  });

  app.post("/api/sites/:id/run", async (c) => {
    const user = await requirePro(c);
    if (!isAuthUser(user)) return user;
    const site = await getSite(c.env.DB, c.req.param("id"));
    if (!site || site.user_id !== user.id) {
      return c.json({ error: "Not found" }, 404);
    }
    await c.env.CRAWL_QUEUE.send({
      siteId: site.id,
      reason: "manual",
    } satisfies CrawlMessage);
    return c.json({ queued: true });
  });

  app.post("/api/billing/checkout", async (c) => {
    const user = await requireUser(c);
    if (!isAuthUser(user)) return user;
    const row = await c.env.DB.prepare(
      "SELECT stripe_customer_id FROM users WHERE id = ?",
    )
      .bind(user.id)
      .first<{ stripe_customer_id: string | null }>();
    const url = await createCheckoutSession(c.env, {
      userId: user.id,
      email: user.email,
      customerId: row?.stripe_customer_id,
    });
    return c.json({ url });
  });

  app.post("/api/billing/portal", async (c) => {
    const user = await requireUser(c);
    if (!isAuthUser(user)) return user;
    const row = await c.env.DB.prepare(
      "SELECT stripe_customer_id FROM users WHERE id = ?",
    )
      .bind(user.id)
      .first<{ stripe_customer_id: string | null }>();
    if (!row?.stripe_customer_id) {
      return c.json({ error: "No billing customer" }, 400);
    }
    const url = await createPortalSession(c.env, row.stripe_customer_id);
    return c.json({ url });
  });

  app.post("/api/keys", async (c) => {
    const user = await requirePro(c);
    if (!isAuthUser(user)) return user;
    const raw = `qk_${crypto.randomUUID().replace(/-/g, "")}`;
    const hash = await sha256(raw);
    await c.env.DB.prepare("UPDATE users SET api_key_hash = ? WHERE id = ?")
      .bind(hash, user.id)
      .run();
    return c.json({
      apiKey: raw,
      note: "Store this key for MCP monitor.status. It is shown once.",
    });
  });

  app.get("/api/monitor/status", async (c) => {
    const user = await requirePro(c);
    if (!isAuthUser(user)) return user;
    const sites = (await listSites(c.env.DB, user.id)) as Array<{
      id: string;
      url: string;
      name: string | null;
      active: number;
    }>;
    const site = sites.find((s) => s.active === 1) ?? sites[0];
    if (!site) {
      return c.json({
        schemaVersion: "1.0",
        mode: "live",
        coverage: {
          source: "not_run",
          rendered: "not_run",
          live: "not_run",
          searchData: "not_connected",
        },
        findings: [],
        message: "No monitored site yet",
      });
    }
    const run = await latestRun(c.env.DB, site.id);
    return c.json({
      schemaVersion: "1.0",
      project: site.name ?? site.url,
      mode: "live",
      site,
      run: run
        ? {
            id: run.id,
            startedAt: run.started_at,
            envelope: run.envelope_json
              ? JSON.parse(run.envelope_json)
              : null,
            summary: run.summary_json ? JSON.parse(run.summary_json) : null,
          }
        : null,
      coverage: run
        ? {
            source: "not_run",
            rendered: "completed",
            live: "completed",
            searchData: "not_connected",
          }
        : {
            source: "not_run",
            rendered: "not_run",
            live: "not_run",
            searchData: "not_connected",
          },
    });
  });

  app.post("/api/stripe/webhook", async (c) => {
    const signature = c.req.header("stripe-signature");
    if (!signature) return c.json({ error: "missing signature" }, 400);
    const raw = await c.req.text();
    try {
      await handleStripeWebhook(c.env, raw, signature);
      return c.json({ received: true });
    } catch (error) {
      return c.json(
        {
          error: error instanceof Error ? error.message : "webhook failed",
        },
        400,
      );
    }
  });

  // Delete site (free up the Pro slot)
  app.delete("/api/sites/:id", async (c) => {
    const user = await requirePro(c);
    if (!isAuthUser(user)) return user;
    const site = await getSite(c.env.DB, c.req.param("id"));
    if (!site || site.user_id !== user.id) {
      return c.json({ error: "Not found" }, 404);
    }
    await c.env.DB.prepare("UPDATE sites SET active = 0 WHERE id = ?")
      .bind(site.id)
      .run();
    return c.json({ ok: true });
  });

  return app;
}
