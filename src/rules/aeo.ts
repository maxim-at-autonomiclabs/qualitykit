export const aeoRules = `# AEO / AI visibility rules (QualityKit)

## AI Audit Mode
QualityKit scores (0–100) are deterministic heuristics with evidence:
- Crawlability
- AI extractability
- Entity clarity
- Citation readiness
- Structured understanding
- Topical coverage

Scores do **not** predict rankings or AI citations.

## Answer readiness
- Identify real user questions and ensure pages lead with a clear, accurate answer.
- Use descriptive headings that match question phrasing when natural.

## Entity clarity
- Keep organization, product, author, and relationship names consistent across metadata, copy, and JSON-LD.
- Implement Organization/WebSite structured data only when it mirrors visible content.

## Machine-readable information
- Prefer valid JSON-LD with appropriate Schema.org types (Organization, WebSite, BlogPosting, BreadcrumbList).
- Schema markup does not guarantee AI citations.

## Citation-worthy content
- Prefer original explanations, comparisons, evidence, and sourced claims.
- Mark unverified claims with \`[verify]\` and refuse to treat skeletons as publishable.

## What not to do
- Do not promote \`llms.txt\` as a ranking trick (optional assessment only).
- Do not sprinkle FAQ schema on every page.
- Do not invent author credentials or statistics.
- Do not assume Google AI Overviews, ChatGPT search, Perplexity, and Bing/Copilot share ranking mechanisms.

## Crawler policy
- Audit AI bot rules in robots files.
- Changing allow/disallow for AI crawlers requires explicit user approval.
`;
