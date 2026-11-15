export type Env = {
  DB: D1Database;
  CRAWL_QUEUE: Queue;
  ASSETS: Fetcher;
  APP_URL: string;
  STRIPE_PRICE_ID: string;
  CLERK_PUBLISHABLE_KEY: string;
  CLERK_SECRET_KEY: string;
  STRIPE_SECRET_KEY: string;
  STRIPE_WEBHOOK_SECRET: string;
  RESEND_API_KEY?: string;
  API_SIGNING_SECRET?: string;
};

export type CrawlMessage = {
  siteId: string;
  reason: "cron" | "manual";
};
