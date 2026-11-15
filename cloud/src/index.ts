import { createApp } from "./app.js";
import {
  isClerkProxyPath,
  proxyClerkFrontendApi,
} from "./clerk-proxy.js";
import { processCrawl } from "./crawl.js";
import { listActiveProSites } from "./db.js";
import type { CrawlMessage, Env } from "./env.js";

const app = createApp();

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const url = new URL(request.url);

    if (isClerkProxyPath(url.pathname)) {
      return proxyClerkFrontendApi(request, env);
    }

    if (url.pathname.startsWith("/api/")) {
      return app.fetch(request, env, ctx);
    }

    // Serve dashboard / marketing assets from Workers static assets
    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }

    return new Response("QualityKit Cloud", { status: 200 });
  },

  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(enqueueDaily(env));
  },

  async queue(
    batch: MessageBatch<CrawlMessage>,
    env: Env,
  ): Promise<void> {
    for (const message of batch.messages) {
      try {
        await processCrawl(env, message.body.siteId, message.body.reason);
        message.ack();
      } catch (error) {
        console.error("crawl failed", error);
        message.retry();
      }
    }
  },
};

async function enqueueDaily(env: Env) {
  const sites = await listActiveProSites(env.DB);
  for (const site of sites) {
    await env.CRAWL_QUEUE.send({
      siteId: site.id,
      reason: "cron",
    } satisfies CrawlMessage);
  }
}
