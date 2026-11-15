export const contentRules = `# Content quality rules (QualityKit)

## Prioritization
- At most three content briefs per request.
- Prefer topics aligned to business, audience, and existing site gaps.
- Skip ideas that duplicate existing routes.

## Drafting standards
- Lead with a direct answer section.
- Include author, date, and updated fields in frontmatter.
- Use \`[verify]\` markers for any claim that needs sourcing.
- Do not publish until every \`[verify]\` marker is resolved.

## Blog architecture (Next.js App Router + MDX)
- \`content/blog/*.mdx\` with frontmatter: title, description, date, updated, author, tags.
- Reader helper in \`lib/blog.ts\` (gray-matter + next-mdx-remote/rsc).
- Routes: \`/blog\`, \`/blog/[slug]\`, optional \`/blog/category/[tag]\`, RSS, sitemap entries.
- Refuse scaffolding a second blog when one already exists.

## Internal linking
- Suggest contextual links using shared topical terms.
- Provide source file, href, and anchor — no mass rewrites.

## Integrity
- No fabricated case studies, fake authors, or unsourced competitor claims.
- Quality over volume: one useful article beats dozens of thin pages.
`;
