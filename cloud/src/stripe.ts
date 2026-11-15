import Stripe from "stripe";
import { id } from "./db.js";
import type { Env } from "./env.js";

export function getStripe(env: Env): Stripe {
  return new Stripe(env.STRIPE_SECRET_KEY, {
    httpClient: Stripe.createFetchHttpClient(),
  });
}

export async function createCheckoutSession(
  env: Env,
  opts: {
    userId: string;
    email: string;
    customerId?: string | null;
  },
): Promise<string> {
  const stripe = getStripe(env);
  let customerId = opts.customerId ?? undefined;
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: opts.email,
      metadata: { qualitykit_user_id: opts.userId },
    });
    customerId = customer.id;
    await env.DB.prepare(
      "UPDATE users SET stripe_customer_id = ? WHERE id = ?",
    )
      .bind(customerId, opts.userId)
      .run();
  }

  const priceConfigured =
    Boolean(env.STRIPE_PRICE_ID) && !env.STRIPE_PRICE_ID.includes("REPLACE");

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    line_items: [
      priceConfigured
        ? { price: env.STRIPE_PRICE_ID, quantity: 1 }
        : {
            price_data: {
              currency: "usd",
              unit_amount: 2900,
              recurring: { interval: "month" },
              product_data: {
                name: "QualityKit Pro",
                description:
                  "Daily hosted crawls, history, and email alerts (1 site)",
              },
            },
            quantity: 1,
          },
    ],
    success_url: `${env.APP_URL}/app.html?checkout=success`,
    cancel_url: `${env.APP_URL}/pricing.html?checkout=cancel`,
    metadata: { qualitykit_user_id: opts.userId },
    subscription_data: {
      metadata: { qualitykit_user_id: opts.userId },
    },
  });

  if (!session.url) throw new Error("Stripe Checkout URL missing");
  return session.url;
}

export async function createPortalSession(
  env: Env,
  customerId: string,
): Promise<string> {
  const stripe = getStripe(env);
  const session = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: `${env.APP_URL}/app`,
  });
  return session.url;
}

export async function handleStripeWebhook(
  env: Env,
  rawBody: string,
  signature: string,
): Promise<void> {
  const stripe = getStripe(env);
  const event = await stripe.webhooks.constructEventAsync(
    rawBody,
    signature,
    env.STRIPE_WEBHOOK_SECRET,
  );

  if (
    event.type === "customer.subscription.created" ||
    event.type === "customer.subscription.updated" ||
    event.type === "customer.subscription.deleted"
  ) {
    const sub = event.data.object as Stripe.Subscription;
    const userId =
      sub.metadata?.qualitykit_user_id ??
      (
        await env.DB.prepare(
          "SELECT id FROM users WHERE stripe_customer_id = ?",
        )
          .bind(typeof sub.customer === "string" ? sub.customer : sub.customer.id)
          .first<{ id: string }>()
      )?.id;

    if (!userId) return;

    const active =
      sub.status === "active" || sub.status === "trialing";
    await env.DB.prepare("UPDATE users SET plan = ? WHERE id = ?")
      .bind(active ? "pro" : "free", userId)
      .run();

    const existing = await env.DB.prepare(
      "SELECT id FROM subscriptions WHERE stripe_subscription_id = ?",
    )
      .bind(sub.id)
      .first<{ id: string }>();

    const periodEndUnix =
      (sub as { current_period_end?: number }).current_period_end ??
      sub.items.data[0]?.current_period_end;
    const periodEnd = periodEndUnix
      ? new Date(periodEndUnix * 1000).toISOString()
      : null;

    if (existing) {
      await env.DB.prepare(
        "UPDATE subscriptions SET status = ?, current_period_end = ? WHERE id = ?",
      )
        .bind(sub.status, periodEnd, existing.id)
        .run();
    } else {
      await env.DB.prepare(
        `INSERT INTO subscriptions (id, user_id, stripe_subscription_id, status, current_period_end)
         VALUES (?, ?, ?, ?, ?)`,
      )
        .bind(id("sub"), userId, sub.id, sub.status, periodEnd)
        .run();
    }
  }
}
