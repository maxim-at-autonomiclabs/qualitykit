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
| `qualitykit.ai_audit` | AI readiness scores (crawlability, extractability, entity clarity, citation readiness, structured understanding, topical coverage) |
| `qualitykit.plan` | Content briefs, blog architecture plan, schema, internal links |
| `qualitykit.fix` | Advise-only unified diffs / file specs for selected findings (`safeAutoOnly` supported) |
| `qualitykit.verify` | Re-audit; report fixed / remaining / regressed (supports `proposedFiles`) |
| `monitor.status` | Latest hosted Pro run when `QUALITYKIT_API_KEY` is set; otherwise `self_hosted` / `not_run` |
| `visibility.report` | Stub (`not_connected`) until Search/AI visibility ships |

Responses include additive `schemaVersion` + `coverage` fields. Never treat `not_run` as a pass.

Specialized tools (`codebase.analyze`, `seo.audit`, `blog.scaffold`, etc.) remain available but are secondary.

Resources: `qualitykit://rules/technical-seo`, `qualitykit://rules/aeo`, `qualitykit://rules/content`

Prompt: `audit-site`

## Example workflow

1. `qualitykit.audit` (optionally `includeRendered` + `siteUrl`)
2. `qualitykit.ai_audit`
3. `qualitykit.plan`
4. Present defects, then opportunities
5. `qualitykit.fix` with approved finding IDs (`safeAutoOnly: true` for low-risk)
6. Apply diffs in the repo
7. `qualitykit.verify`

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
| Local MCP audits, AI readiness, fixes, verify | Yes | Yes |
| Account / API key required | No | For hosted features |
| Daily hosted crawls + history | — | 1 production site |
| Email regression alerts | — | Yes |
| `monitor.status` via cloud | Self-hosted stub | Connected |
| GSC / AI citation credits | Later / self-run | Later phases |

Cloud app: [`cloud/`](cloud/) (Cloudflare Workers + D1 + Queues + Cron, Clerk, Stripe). Optional self-hosted Pro infrastructure; setup is in [`cloud/README.md`](cloud/README.md). The local MCP runs on its own.

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
