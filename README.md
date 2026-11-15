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

| Free (this repo) | Pro (planned) |
| --- | --- |
| Local audits, AI readiness heuristics, advise-only diffs, verification | Live crawl at scale, AI search prompt monitoring, competitor gaps, alerts, history |

Local code fixes stay free. Hosted intelligence is where Pro belongs — not charging developers to generate a `robots.ts`.

## Safety

- Absolute `projectRoot` only; skips `.env*` and secrets
- Advise-only fixes — no file writes, no PR automation
- Ask before changing AI crawler allow/disallow
- No mass article generation or “FAQ schema = rankings” claims

## Requirements

- Node.js 18+
- Deep analysis: **Next.js** (App Router for blog scaffolding)

## Website (qualitykit.dev)

The marketing/docs site lives in [`website/`](website/) and deploys to **Cloudflare Workers** (static assets).

Live Worker: [qualitykit-web.maxim-a63.workers.dev](https://qualitykit-web.maxim-a63.workers.dev)

```bash
cd website
npm install
npm run deploy
```

### Custom domain

1. Add the `qualitykit.dev` zone to the same Cloudflare account used by Wrangler.
2. Uncomment the `routes` custom domains in [`website/wrangler.toml`](website/wrangler.toml).
3. Run `npm run deploy` again (or attach the domain in Workers → qualitykit-web → Custom Domains).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) and [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md). Security reports: [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE)
