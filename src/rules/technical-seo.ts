export const technicalSeoRules = `# Technical SEO rules (QualityKit)

## Defects vs opportunities
- **Defects** are concrete technical problems (e.g. Disallow: /, broken absolute metadata).
- **Opportunities** are improvements (explicit robots, title template, blog, schema).
- A missing robots file is **not** automatically critical — Next.js defaults to allowing crawlers.
- A missing blog is **never** a defect.

## Crawlability
- Prefer \`app/robots.ts\` when you want an explicit sitemap pointer or AI crawler policy.
- Do not ship production sites with \`Disallow: /\` unless intentionally private.
- Never automatically add Disallow rules for AI crawlers. Report policy and ask the user.

## Indexability & URLs
- Set \`metadataBase\` on the root layout when absolute OG/canonical URLs matter.
- Use App Router Metadata API: title default/template, description, \`alternates.canonical\`.
- Provide \`app/sitemap.ts\` especially when multiple indexable routes exist.

## Content structure
- Prefer clear heading hierarchy. Do not require exactly one H1 as a hard rule.
- Ensure important pages export metadata (title + description).
- Add meaningful \`alt\` text on informative images.

## Findings format
Each finding includes: evidence, why it matters, suggested fix, expected impact, confidence, effort, fixSafety (auto|approval|manual), verification steps.

## Safety
- Safe automatic specs: missing robots, sitemap, metadataBase, simple title templates.
- Ranking changes must not be claimed as caused by edits without measurement caveats.
`;
