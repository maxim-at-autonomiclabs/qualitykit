# Security Policy

## Supported versions

| Version | Supported |
| --- | --- |
| 0.3.x | Yes |
| < 0.3 | Best effort |

## Reporting a vulnerability

Please **do not** open a public GitHub issue for security problems.

Use [GitHub Security Advisories](https://github.com/maxim-at-autonomiclabs/qualitykit/security/advisories/new) for this repository, or contact the repository owner privately on GitHub.

Include:

- A description of the issue
- Steps to reproduce
- Affected versions / commit if known
- Any suggested fix

We aim to acknowledge reports within 7 days.

## Scope notes

QualityKit is a **read-only** local MCP: it reads project files you point it at and may optionally fetch public HTML when you pass `siteUrl` + `includeRendered`. It should never write your repository or exfiltrate secrets. The file reader skips `.env*` and common credential filenames — please report bypasses.
