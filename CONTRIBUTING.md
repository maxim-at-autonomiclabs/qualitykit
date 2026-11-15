# Contributing to QualityKit

Thanks for helping improve QualityKit.

## Development setup

```bash
git clone https://github.com/maxim-at-autonomiclabs/qualitykit.git
cd qualitykit
npm install
npm test
npm run build
```

Run the MCP locally:

```bash
node dist/index.js
```

Or with Cursor, point MCP at `node` + `dist/index.js` after a build.

## Project layout

- `src/` — MCP server, adapters, and tools
- `packages/engine/` — shared `@qualitykit/engine` audit package (also published to npm)
- `fixtures/` — tiny Next.js trees for tests
- `tests/` — Vitest suite (no network)
- `website/` — qualitykit.dev landing and docs (`npm run dev` in that directory to preview)

Hosted Pro (app.qualitykit.dev) lives in a separate private repository.

## Guidelines

- Keep the MCP **advise-only** — never write the target repository from the server.
- Separate **defects** from **opportunities**. A missing blog is not a defect.
- Do not claim ranking wins or guaranteed AI citations.
- Prefer evidence-backed findings (file paths, routes, rendered signals).
- Framework adapters implement `FrameworkAdapter` in `src/adapters/types.ts`. Next.js is the reference; Astro/Nuxt/WordPress are welcome as new adapters with tests.

## Pull requests

1. Branch from `main`.
2. Add or update tests for behavior changes.
3. Run `npm test` and `npm run build`.
4. Open a PR with a short “why” and how you verified.

## Reporting security issues

See [SECURITY.md](SECURITY.md). Do not open public issues for vulnerabilities.
