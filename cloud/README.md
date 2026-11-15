# QualityKit Cloud (Pro)

Cloudflare Workers app for continuous monitoring, Clerk auth, Stripe billing, and email alerts.

**Live:** [app.qualitykit.dev](https://app.qualitykit.dev) · Marketing: [qualitykit.dev](https://qualitykit.dev)

## Stack

- Hono API on Workers
- D1 (`qualitykit`)
- Queues (`qualitykit-crawl`)
- Cron daily `0 6 * * *`
- Clerk + Stripe + Resend

## Setup

1. Copy `.dev.vars.example` → `.dev.vars` and fill secrets (local `wrangler dev` only).
2. Create Stripe product **QualityKit Pro** at **$29/mo**; put the Price ID in `wrangler.toml` → `STRIPE_PRICE_ID`.
3. Copy Clerk **Publishable** key into `wrangler.toml` → `CLERK_PUBLISHABLE_KEY`.
4. Push secrets (production):

```bash
cd cloud
npx wrangler secret put CLERK_SECRET_KEY
# Recommended on Workers (avoids jwk-failed-to-resolve):
# npx wrangler secret put CLERK_JWT_KEY
# paste PEM from Clerk Dashboard → API keys → Show JWT public key
npx wrangler secret put STRIPE_SECRET_KEY
npx wrangler secret put STRIPE_WEBHOOK_SECRET
npx wrangler secret put RESEND_API_KEY
npx wrangler secret put API_SIGNING_SECRET
npx wrangler d1 migrations apply qualitykit --remote
npx wrangler deploy
```

### Workers Builds (monorepo)

Two Workers share this repo. Keep **Root directory** at `/` and **Deploy command** as `npx wrangler deploy` on both.

On Workers Builds, `postinstall` installs a wrangler shim. At deploy time the shim reads `WRANGLER_CI_OVERRIDE_NAME`, builds `cloud/` or `website/`, writes a gitignored root `wrangler.toml`, then deploys.

5. Stripe webhook endpoint: `https://app.qualitykit.dev/api/stripe/webhook`  
   Events: `customer.subscription.created|updated|deleted`
6. Clerk → allow origin `https://app.qualitykit.dev` and redirect URLs to `/app.html`.

### Local

```bash
npx wrangler d1 migrations apply qualitykit --local
npx wrangler dev
# Stripe CLI: stripe listen --forward-to http://127.0.0.1:8787/api/stripe/webhook
```

## Clerk test vs live

| Mode | Clerk keys | Stripe keys |
| --- | --- | --- |
| Local / sandbox | `pk_test_` + `sk_test_` (Development) | `sk_test_` / `rk_test_` |
| Real customers | `pk_live_` + `sk_live_` (Production) | `sk_live_` / `rk_live_` |

Do **not** mix live Stripe with Clerk Development (`sk_test_`). Activate Clerk **Production** in the Clerk dashboard, then copy the Production API keys.

## Free vs Pro

Local MCP remains free forever. This cloud service is optional Pro infrastructure.
