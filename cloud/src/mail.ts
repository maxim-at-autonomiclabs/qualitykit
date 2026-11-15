import type { Env } from "./env.js";

export async function sendRegressionEmail(
  env: Env,
  to: string,
  payload: {
    siteUrl: string;
    siteName: string | null;
    newDefects: string[];
    runId: string;
  },
): Promise<void> {
  if (!env.RESEND_API_KEY) {
    console.log(
      JSON.stringify({
        mail: "skipped",
        reason: "RESEND_API_KEY not set",
        to,
        payload,
      }),
    );
    return;
  }

  const subject = `[QualityKit] Regression on ${payload.siteName ?? payload.siteUrl}`;
  const body = [
    `QualityKit detected new defects on ${payload.siteUrl}.`,
    "",
    `New finding IDs:`,
    ...payload.newDefects.map((d) => `- ${d}`),
    "",
    `Run: ${payload.runId}`,
    `Dashboard: ${env.APP_URL}/app`,
  ].join("\n");

  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: "QualityKit <alerts@qualitykit.dev>",
      to: [to],
      subject,
      text: body,
    }),
  });
}
