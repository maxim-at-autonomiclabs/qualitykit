import { diffRegressions, runLiveAudit } from "@qualitykit/engine";
import {
  getSite,
  id,
  latestRun,
  listFindings,
} from "./db.js";
import type { Env } from "./env.js";
import { sendRegressionEmail } from "./mail.js";

export async function processCrawl(
  env: Env,
  siteId: string,
  reason: "cron" | "manual",
): Promise<{ runId: string; newDefects: string[] }> {
  const site = await getSite(env.DB, siteId);
  if (!site || !site.active) {
    throw new Error(`Site not found or inactive: ${siteId}`);
  }

  const runId = id("run");
  const startedAt = new Date().toISOString();
  await env.DB.prepare(
    "INSERT INTO runs (id, site_id, started_at, status) VALUES (?, ?, ?, 'running')",
  )
    .bind(runId, siteId, startedAt)
    .run();

  try {
    const previous = await latestRun(env.DB, siteId);
    const prevFindings = previous
      ? ((await listFindings(env.DB, previous.id)) as Array<{
          finding_id: string;
          kind: string;
        }>)
          .filter((f) => f.kind === "defect")
          .map((f) => f.finding_id)
      : [];

    const live = await runLiveAudit(site.url, {
      projectName: site.name ?? site.url,
    });

    const finishedAt = new Date().toISOString();
    await env.DB.prepare(
      `UPDATE runs SET finished_at = ?, status = 'completed', summary_json = ?, envelope_json = ?
       WHERE id = ?`,
    )
      .bind(
        finishedAt,
        JSON.stringify(live.audit.summary),
        JSON.stringify(live.envelope),
        runId,
      )
      .run();

    for (const finding of live.audit.findings) {
      await env.DB.prepare(
        `INSERT INTO findings (id, run_id, finding_id, kind, severity, title, evidence_json, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
        .bind(
          id("fnd"),
          runId,
          finding.id,
          finding.kind,
          finding.severity,
          finding.title,
          JSON.stringify(finding.evidence),
          finding.kind === "defect" ? "confirmed" : "needs_verification",
        )
        .run();
    }

    const { newDefects } = diffRegressions(prevFindings, live.audit);

    if (newDefects.length > 0) {
      const user = await env.DB.prepare(
        "SELECT email FROM users WHERE id = ?",
      )
        .bind(site.user_id)
        .first<{ email: string }>();

      const payload = {
        siteUrl: site.url,
        siteName: site.name,
        reason,
        newDefects,
        runId,
      };

      await env.DB.prepare(
        `INSERT INTO alerts (id, site_id, type, payload_json, sent_at, channel)
         VALUES (?, ?, 'regression', ?, datetime('now'), 'email')`,
      )
        .bind(id("alrt"), siteId, JSON.stringify(payload))
        .run();

      if (user?.email) {
        await sendRegressionEmail(env, user.email, payload);
      }
    }

    return { runId, newDefects };
  } catch (error) {
    await env.DB.prepare(
      "UPDATE runs SET finished_at = ?, status = 'failed', summary_json = ? WHERE id = ?",
    )
      .bind(
        new Date().toISOString(),
        JSON.stringify({
          error: error instanceof Error ? error.message : "crawl failed",
        }),
        runId,
      )
      .run();
    throw error;
  }
}
