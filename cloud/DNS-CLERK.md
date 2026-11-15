# Clerk DNS for qualitykit.dev

## Auth (done without CNAMEs)

Frontend API is proxied at `https://qualitykit.dev/__clerk` (see `website/src/worker.js`).  
`clerk.qualitykit.dev` / `accounts.qualitykit.dev` CNAMEs are **optional** for sign-in.

## Still recommended (email / DKIM)

Add these as **DNS only** (grey cloud) in Cloudflare → qualitykit.dev → DNS:

| Type | Name | Target |
| --- | --- | --- |
| CNAME | `clkmail` | `mail.q5g3fm1hknb6.clerk.services` |
| CNAME | `clk._domainkey` | `dkim1.q5g3fm1hknb6.clerk.services` |
| CNAME | `clk2._domainkey` | `dkim2.q5g3fm1hknb6.clerk.services` |

Optional (legacy FAPI / accounts portal):

| Type | Name | Target |
| --- | --- | --- |
| CNAME | `clerk` | `frontend-api.clerk.services` |
| CNAME | `accounts` | `accounts.clerk.services` |
