# QualityKit

[![CI](https://github.com/maxim-at-autonomiclabs/qualitykit/actions/workflows/ci.yml/badge.svg)](https://github.com/maxim-at-autonomiclabs/qualitykit/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/qualitykit.svg)](https://www.npmjs.com/package/qualitykit)
[![License: MIT](https://img.shields.io/badge/License-MIT-teal.svg)](LICENSE)

**Site:** [qualitykit.dev](https://qualitykit.dev) · **Repo:** [github.com/maxim-at-autonomiclabs/qualitykit](https://github.com/maxim-at-autonomiclabs/qualitykit)

Read-only **SEO + AEO MCP server** for Next.js codebases.

QualityKit finds what matters, explains why, proposes fixes as diffs, and verifies results. The coding agent applies approved changes. **This server never writes to your repo.**

## Install

```bash
npm install -g qualitykit
# or run without a global install:
npx -y qualitykit
```

From source:

```bash
git clone https://github.com/maxim-at-autonomiclabs/qualitykit.git
cd qualitykit
npm install
npm test
npm run build
```

### Cursor MCP config

```json
{
  "mcpServers": {
    "qualitykit": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "qualitykit"]
    }
  }
}
```

## Primary tools

| Tool | Purpose |
| --- | --- |
| `qualitykit.audit` | Route inventory + technical/metadata/content/schema/links. **Defects vs opportunities**. Optional rendered HTML. |
| `qualitykit.grow` | **Brand-aligned growth:** Site Profile + GSC queries → scored opportunities, deprioritised demand, top 10 changes, safe vs approval. |
| `qualitykit.get_site_profile` | Living Site Profile (brand, ICP, products, voice, pages) with freshness; ephemeral draft when Cloud is offline. |
| `qualitykit.refresh_site_profile` | Cloud model refresh when Pro + `MODEL_*` configured; else offline host-agent brief. |
| `qualitykit.update_site_profile` | Patch profile; brand/ICP/products stay pending until user approval. |
| `qualitykit.ai_audit` | AI readiness scores (crawlability, extractability, entity clarity, citation readiness, structured understanding, topical coverage) |
| `qualitykit.plan` | Content briefs, blog architecture plan, schema, internal links |
| `qualitykit.fix` | Advise-only unified diffs / file specs for selected findings (`safeAutoOnly` supported); blocks irrelevant GSC ids |
| `qualitykit.verify` | Re-audit; report fixed / remaining / regressed (supports `proposedFiles`) |
| `monitor.status` | Latest hosted Pro run when `QUALITYKIT_API_KEY` is set; otherwise `self_hosted` / `not_run` |
| `visibility.report` | Search Console period metrics (incl. position/CTR), profile freshness, ranked opportunities, and `changeOutcomes` via Cloud when API key is set; otherwise `not_connected` |
| `visibility.mark_applied` | Snapshot GSC metrics for grow change ids after deploy so later `visibility.report` shows per-change deltas (Pro + API key) |
| `sitemap.submit` | Register `/sitemap.xml` with Google Search Console (and Bing when a Webmaster key is saved). Free when Cloud + Search Console are connected. Does not request indexing. |
| `sitemap.status` | Read Google/Bing sitemap processing status (pending, errors, warnings) via Cloud |

Responses include additive `schemaVersion` + `coverage` fields. Never treat `not_run` as a pass.

Specialized tools (`codebase.analyze`, `seo.audit`, `blog.scaffold`, etc.) remain available but are secondary.

Resources: `qualitykit://rules/technical-seo`, `qualitykit://rules/aeo`, `qualitykit://rules/content`

Prompt: `audit-site`

## Example workflow

1. `qualitykit.audit` (optionally `includeRendered` + `siteUrl`)
2. `qualitykit.grow` — why impressions are limited, top 10, safe vs approval
3. Optionally `qualitykit.ai_audit` and `qualitykit.plan`
4. Present defects and grow changes (no volumes or impression counts)
5. **Pro dashboard Opportunities:** **Copy MCP prompt** for an item (or call `qualitykit.fix` with that `opportunityId`)
6. Implement `buildContract`s in the repo; then `qualitykit.verify` with `markApplied: true` so the backlog ships
7. `qualitykit.fix` with finding IDs (`safeAutoOnly: true` for low-risk technical diffs) when not using an opportunity card
8. **Sitemap (free):** after deploy, `sitemap.submit` once Search Console is connected in the dashboard. Google usually rediscovers later updates without resubmitting. Check `sitemap.status` for processing errors.
9. Later `visibility.report` for period metrics and `changeOutcomes` (Search Console often lags 1–3 days; deltas are correlational, not a ranking guarantee)

Empty brand/ICP on the Site Profile auto-fills from the Cloud model when `MODEL_*` is configured — no dashboard approve step.

**MCP API key** (`qk_…` from the dashboard) is for the local MCP to call QualityKit Cloud — not for Google OAuth. Free accounts can mint a key for `sitemap.submit` / `sitemap.status`. Connect Search Console (and optionally a Bing Webmaster API key) in the dashboard; set `QUALITYKIT_API_KEY` + `QUALITYKIT_API_BASE=https://app.qualitykit.dev` in Cursor. Pro unlocks `visibility.*`, grow GSC enrichment, and hosted crawls.

## Findings model

Each finding includes `kind` (`defect` | `opportunity`), severity, impact, confidence, effort, `fixSafety`, evidence, why it matters, suggested fix, and verification steps.

- Missing `robots.ts` → opportunity (Next defaults to allow)
- `Disallow: /` → critical defect
- Missing blog → opportunity only

## AI Audit Mode

Heuristic 0–100 scores with evidence. They **do not** predict rankings or AI citations. FAQ schema and `llms.txt` are optional assessments — never required.

## Open source vs Pro

| | Free forever ($0) | Pro ($29/mo) |
| --- | --- | --- |
| Local MCP audits, `qualitykit.grow`, AI readiness, fixes, verify | Yes | Yes |
| Sitemap create/update/validate in MCP | Yes | Yes |
| Account / API key required | Optional (for sitemap submit) | For hosted features |
| `sitemap.submit` / `sitemap.status` (GSC + optional Bing) | Yes when Cloud + GSC linked | Yes |
| Daily hosted crawls + history | — | 1 production site |
| Email regression alerts | — | Yes |
| `monitor.status` via cloud | Self-hosted stub | Connected |
| Google Search Console analytics sync | Connect for sitemap only | Yes (1 site) + impressions/queries |
| `visibility.report` + grow GSC enrichment | Offline / `not_connected` | Connected when GSC linked |
| `visibility.mark_applied` + per-change deltas | — | Snapshot applied recs; outcomes in report / dashboard |

**Free:** explain why impressions are limited from the codebase, rank the next 10 changes, mark safe auto-fixes, verify after the coding agent applies approved diffs, and (with a free Cloud account) submit/monitor the sitemap. No OpenAI key inside QualityKit. Sitemap registration does not guarantee indexing or rankings.

**Pro:** daily crawl, history, email alerts, plus Search Console analytics sync for the monitored site. Re-ranks opportunities with real queries and shows last-28d vs prior-28d impressions/clicks. Mark recommendations applied (dashboard or `visibility.mark_applied`) to snapshot per-change baselines; later syncs power `changeOutcomes` deltas.

Hosted Pro runs at [app.qualitykit.dev](https://app.qualitykit.dev). The cloud app (Workers, D1, Clerk, Stripe, managed GSC) is a separate private product. This repository is the free local MCP and shared `@qualitykit/engine` package. Point Cursor at Pro with `QUALITYKIT_API_KEY` and `QUALITYKIT_API_BASE=https://app.qualitykit.dev`.

Local code fixes stay free. Model tokens come from your coding agent — QualityKit does not fund inference.

## Safety

- Absolute `projectRoot` only; skips `.env*` and secrets
- Advise-only fixes — no file writes, no PR automation
- Ask before changing AI crawler allow/disallow
- No mass article generation or “FAQ schema = rankings” claims

## Requirements

- Node.js 18+
- Deep analysis: **Next.js** (App Router for blog scaffolding)

## Website

Marketing site source is in [`website/`](website/). Preview locally with `npm install` and `npm run dev`.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) and [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md). Security reports: [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE)
