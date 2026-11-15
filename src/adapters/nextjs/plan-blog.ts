import type {
  BlogOptions,
  FileSpec,
  Recommendation,
  SiteModel,
} from "../../model/site.js";
import { scorePriority } from "../../model/site.js";
import {
  appDirPrefix,
  contentDirPrefix,
  libDirPrefix,
} from "./parse.js";

export function planBlog(
  site: SiteModel,
  options: BlogOptions = {},
): Recommendation[] {
  if (site.router === "pages") {
    return [
      {
        id: "blog-unsupported-pages-router",
        title: "Blog scaffolding supports App Router only",
        category: "blog",
        severity: "info",
        impact: 4,
        confidence: 1,
        effort: 8,
        risk: 4,
        priority: scorePriority(4, 1, 8, 4),
        evidence: ["Detected Pages Router"],
        rationale:
          "v1 blog.scaffold targets the App Router with MDX. Migrate to App Router or scaffold manually.",
        files: [],
      },
    ];
  }

  if (site.router !== "app") {
    return [
      {
        id: "blog-unknown-router",
        title: "Cannot scaffold blog without App Router",
        category: "blog",
        severity: "info",
        impact: 3,
        confidence: 0.9,
        effort: 5,
        risk: 3,
        priority: scorePriority(3, 0.9, 5, 3),
        evidence: ["Router kind is unknown"],
        rationale: "Detect or create an App Router tree before scaffolding a blog.",
        files: [],
      },
    ];
  }

  if (site.blog.present) {
    return planBlogImprovements(site);
  }

  if (!businessWouldBenefit(site)) {
    return [
      {
        id: "blog-not-recommended",
        title: "Blog not clearly justified",
        category: "blog",
        severity: "info",
        impact: 2,
        confidence: 0.55,
        effort: 6,
        risk: 2,
        priority: scorePriority(2, 0.55, 6, 2),
        evidence: [
          `business confidence=${site.business.confidence}`,
          `topics=${site.business.topics.slice(0, 5).join(", ") || "none"}`,
        ],
        rationale:
          "Signals are too weak to justify a blog. Improve homepage clarity first, then revisit content architecture.",
        files: [],
      },
    ];
  }

  const appPrefix = appDirPrefix(site.files);
  const libPrefix = libDirPrefix(site.files);
  const contentPrefix = contentDirPrefix(site.files);
  const includeCategories = options.includeCategories ?? true;
  const brand = site.business.name ?? site.packageName ?? "Acme";
  const origin =
    site.siteUrl ?? site.metadata.metadataBaseValue ?? "https://example.com";
  const slug = suggestFirstSlug(site);
  const topic = site.business.topics[0] ?? "product";

  const files: FileSpec[] = [
    {
      path: `${libPrefix}/blog.ts`,
      kind: "create",
      content: blogLibTemplate(),
      rationale: "MDX post reader using gray-matter",
    },
    {
      path: `${appPrefix}/blog/page.tsx`,
      kind: "create",
      content: blogIndexTemplate(brand),
      rationale: "Blog index listing posts",
    },
    {
      path: `${appPrefix}/blog/[slug]/page.tsx`,
      kind: "create",
      content: blogSlugTemplate(origin),
      rationale: "Post page with generateStaticParams and generateMetadata",
    },
    {
      path: `${appPrefix}/blog/rss.xml/route.ts`,
      kind: "create",
      content: rssRouteTemplate(brand, origin),
      rationale: "RSS feed for subscribers and discovery",
    },
    {
      path: `${contentPrefix}/blog/${slug}.mdx`,
      kind: "create",
      content: skeletonMdx(brand, slug, topic),
      rationale:
        "One MDX skeleton with [verify] markers — not a finished publishable article",
    },
  ];

  if (includeCategories) {
    files.push({
      path: `${appPrefix}/blog/category/[tag]/page.tsx`,
      kind: "create",
      content: categoryPageTemplate(),
      rationale: "Tag/category listing justified by topic clusters",
    });
  }

  if (site.sitemap.present && site.sitemap.file) {
    files.push({
      path: site.sitemap.file,
      kind: "edit",
      anchor: "return [",
      snippet: `// Include blog posts from getAllPosts() in sitemap entries`,
      rationale:
        "Extend sitemap to include /blog and each post slug after scaffolding",
    });
  } else {
    files.push({
      path: `${appPrefix}/sitemap.ts`,
      kind: "create",
      content: sitemapWithBlogTemplate(origin, site),
      rationale: "Sitemap covering static routes plus blog posts",
    });
  }

  return [
    {
      id: "blog-scaffold-mdx",
      title: "Scaffold App Router MDX blog",
      category: "blog",
      severity: "high",
      impact: 9,
      confidence: 0.85,
      effort: 6,
      risk: 3,
      priority: scorePriority(9, 0.85, 6, 3),
      evidence: [
        "No existing blog detected",
        `Business: ${brand}`,
        `Audience: ${site.business.audienceHints.join("; ")}`,
      ],
      rationale:
        "A focused blog helps answer buyer questions and builds topical authority. Install gray-matter and next-mdx-remote; do not mass-generate articles.",
      files,
      dependencies: ["gray-matter", "next-mdx-remote"],
      requiresUserApproval: true,
    },
  ];
}

function planBlogImprovements(site: SiteModel): Recommendation[] {
  const recs: Recommendation[] = [
    {
      id: "blog-already-exists",
      title: "Blog already present — scaffold refused",
      category: "blog",
      severity: "info",
      impact: 1,
      confidence: 1,
      effort: 1,
      risk: 1,
      priority: scorePriority(1, 1, 1, 1),
      evidence: [
        `routes=${site.blog.routes.join(", ") || "n/a"}`,
        `posts≈${site.blog.postCount}`,
      ],
      rationale:
        "Refusing a second blog. Prefer improving metadata, schema, internal links, and content quality on the existing architecture.",
      files: [],
    },
  ];

  if (site.blog.postCount === 0) {
    recs.push({
      id: "blog-empty-content",
      title: "Blog routes exist without MDX posts",
      category: "blog",
      severity: "medium",
      impact: 6,
      confidence: 0.8,
      effort: 4,
      risk: 2,
      priority: scorePriority(6, 0.8, 4, 2),
      evidence: site.blog.routes,
      rationale:
        "Add a verified first article targeting a real audience question before expanding the catalog.",
      files: [
        {
          path: `${site.blog.contentDir ?? "content/blog"}/getting-started.mdx`,
          kind: "note",
          rationale: "Create one sourced, audience-aligned MDX post",
        },
      ],
    });
  }

  return recs;
}

function businessWouldBenefit(site: SiteModel): boolean {
  if (site.business.confidence >= 0.5) return true;
  if (site.business.topics.length >= 3) return true;
  if (site.metadata.hasRootTitle && site.metadata.hasRootDescription) return true;
  if (site.routes.some((r) => r.kind === "page")) return true;
  return false;
}

function suggestFirstSlug(site: SiteModel): string {
  const topic = site.business.topics.find((t) => t.length > 3) ?? "guide";
  return `understanding-${topic}`;
}

function blogLibTemplate(): string {
  return `import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";

export type BlogPostMeta = {
  slug: string;
  title: string;
  description: string;
  date: string;
  updated?: string;
  author: string;
  tags: string[];
};

const postsDirectory = path.join(process.cwd(), "content/blog");

export function getPostSlugs(): string[] {
  if (!fs.existsSync(postsDirectory)) return [];
  return fs
    .readdirSync(postsDirectory)
    .filter((f) => f.endsWith(".mdx") || f.endsWith(".md"))
    .map((f) => f.replace(/\\.mdx?$/, ""));
}

export function getPostBySlug(slug: string): {
  meta: BlogPostMeta;
  content: string;
} {
  const fullPathMdx = path.join(postsDirectory, \`\${slug}.mdx\`);
  const fullPathMd = path.join(postsDirectory, \`\${slug}.md\`);
  const fullPath = fs.existsSync(fullPathMdx) ? fullPathMdx : fullPathMd;
  const raw = fs.readFileSync(fullPath, "utf8");
  const { data, content } = matter(raw);
  return {
    meta: {
      slug,
      title: String(data.title ?? slug),
      description: String(data.description ?? ""),
      date: String(data.date ?? ""),
      updated: data.updated ? String(data.updated) : undefined,
      author: String(data.author ?? "Editorial Team"),
      tags: Array.isArray(data.tags) ? data.tags.map(String) : [],
    },
    content,
  };
}

export function getAllPosts(): BlogPostMeta[] {
  return getPostSlugs()
    .map((slug) => getPostBySlug(slug).meta)
    .sort((a, b) => (a.date < b.date ? 1 : -1));
}

export function getPostsByTag(tag: string): BlogPostMeta[] {
  return getAllPosts().filter((p) =>
    p.tags.map((t) => t.toLowerCase()).includes(tag.toLowerCase()),
  );
}
`;
}

function blogIndexTemplate(brand: string): string {
  return `import type { Metadata } from "next";
import Link from "next/link";
import { getAllPosts } from "@/lib/blog";

export const metadata: Metadata = {
  title: "Blog",
  description: "Articles and guides from ${brand}",
  alternates: { canonical: "/blog" },
};

export default function BlogIndexPage() {
  const posts = getAllPosts();
  return (
    <main>
      <h1>Blog</h1>
      <p>Practical guides and answers from ${brand}.</p>
      <ul>
        {posts.map((post) => (
          <li key={post.slug}>
            <Link href={\`/blog/\${post.slug}\`}>{post.title}</Link>
            <p>{post.description}</p>
          </li>
        ))}
      </ul>
    </main>
  );
}
`;
}

function blogSlugTemplate(origin: string): string {
  return `import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { MDXRemote } from "next-mdx-remote/rsc";
import { getPostBySlug, getPostSlugs } from "@/lib/blog";

type Props = { params: Promise<{ slug: string }> };

export function generateStaticParams() {
  return getPostSlugs().map((slug) => ({ slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  try {
    const { meta } = getPostBySlug(slug);
    return {
      title: meta.title,
      description: meta.description,
      alternates: { canonical: \`/blog/\${meta.slug}\` },
      openGraph: {
        title: meta.title,
        description: meta.description,
        type: "article",
        publishedTime: meta.date,
        modifiedTime: meta.updated ?? meta.date,
        authors: [meta.author],
      },
    };
  } catch {
    return { title: "Post" };
  }
}

export default async function BlogPostPage({ params }: Props) {
  const { slug } = await params;
  let post;
  try {
    post = getPostBySlug(slug);
  } catch {
    notFound();
  }
  const { meta, content } = post;
  const url = new URL(\`/blog/\${meta.slug}\`, "${origin.replace(/\/$/, "")}/").toString();

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: meta.title,
    description: meta.description,
    datePublished: meta.date,
    dateModified: meta.updated ?? meta.date,
    author: {
      "@type": "Person",
      name: meta.author,
    },
    mainEntityOfPage: url,
  };

  const breadcrumbLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: "${origin.replace(/\/$/, "")}/" },
      { "@type": "ListItem", position: 2, name: "Blog", item: "${origin.replace(/\/$/, "")}/blog" },
      { "@type": "ListItem", position: 3, name: meta.title, item: url },
    ],
  };

  return (
    <main>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbLd) }}
      />
      <article>
        <header>
          <p>
            <a href="/blog">Blog</a>
          </p>
          <h1>{meta.title}</h1>
          <p>
            By {meta.author} · <time dateTime={meta.date}>{meta.date}</time>
          </p>
          <p>{meta.description}</p>
        </header>
        <MDXRemote source={content} />
      </article>
    </main>
  );
}
`;
}

function categoryPageTemplate(): string {
  return `import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getAllPosts, getPostsByTag } from "@/lib/blog";

type Props = { params: Promise<{ tag: string }> };

export async function generateStaticParams() {
  const tags = new Set<string>();
  for (const post of getAllPosts()) {
    for (const tag of post.tags) tags.add(tag);
  }
  return [...tags].map((tag) => ({ tag }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { tag } = await params;
  return {
    title: \`Category: \${tag}\`,
    description: \`Articles tagged \${tag}\`,
    alternates: { canonical: \`/blog/category/\${tag}\` },
  };
}

export default async function BlogCategoryPage({ params }: Props) {
  const { tag } = await params;
  const posts = getPostsByTag(tag);
  if (posts.length === 0) notFound();
  return (
    <main>
      <h1>Category: {tag}</h1>
      <ul>
        {posts.map((post) => (
          <li key={post.slug}>
            <Link href={\`/blog/\${post.slug}\`}>{post.title}</Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
`;
}

function rssRouteTemplate(brand: string, origin: string): string {
  const base = origin.replace(/\/$/, "");
  return `import { getAllPosts } from "@/lib/blog";

const SITE = "${base}";

export async function GET() {
  const posts = getAllPosts();
  const items = posts
    .map(
      (post) => \`    <item>
      <title><![CDATA[\${post.title}]]></title>
      <link>\${SITE}/blog/\${post.slug}</link>
      <guid>\${SITE}/blog/\${post.slug}</guid>
      <pubDate>\${new Date(post.date).toUTCString()}</pubDate>
      <description><![CDATA[\${post.description}]]></description>
    </item>\`,
    )
    .join("\\n");

  const xml = \`<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>${brand} Blog</title>
    <link>\${SITE}/blog</link>
    <description>Articles from ${brand}</description>
\${items}
  </channel>
</rss>\`;

  return new Response(xml, {
    headers: {
      "Content-Type": "application/rss+xml; charset=utf-8",
    },
  });
}
`;
}

function skeletonMdx(brand: string, slug: string, topic: string): string {
  const today = new Date().toISOString().slice(0, 10);
  return `---
title: "Understanding ${topic} for ${brand} customers"
description: "A practical overview of ${topic} with clear answers and next steps. [verify]"
date: "${today}"
updated: "${today}"
author: "Editorial Team"
tags:
  - "${topic}"
  - "guides"
---

## Direct answer

[verify] Write 2–4 sentences that directly answer the main question a searcher has about ${topic}.

## Why this matters

[verify] Explain the business context with facts you can source. Do not invent statistics.

## Step-by-step guidance

1. [verify] First concrete step
2. [verify] Second concrete step
3. [verify] Third concrete step

## Common mistakes

[verify] List mistakes you have observed or can cite. Remove this section if unverified.

## Related resources

- Link to your product or service page that helps with ${topic}
- Link to another relevant site page

> Do not publish until every [verify] marker is resolved with accurate, sourced information.
`;
}

function sitemapWithBlogTemplate(origin: string, site: SiteModel): string {
  const base = origin.replace(/\/$/, "");
  const staticPaths = [
    ...new Set(
      site.routes
        .filter((r) => r.kind === "page" && !r.path.includes(":"))
        .map((r) => r.path),
    ),
    "/blog",
  ];
  const staticEntries = staticPaths
    .map(
      (p) => `    {
      url: "${base}${p === "/" ? "" : p}",
      lastModified: new Date(),
      changeFrequency: "weekly" as const,
      priority: ${p === "/" ? "1" : p === "/blog" ? "0.8" : "0.7"},
    }`,
    )
    .join(",\n");

  return `import type { MetadataRoute } from "next";
import { getAllPosts } from "@/lib/blog";

export default function sitemap(): MetadataRoute.Sitemap {
  const posts = getAllPosts().map((post) => ({
    url: \`${base}/blog/\${post.slug}\`,
    lastModified: new Date(post.updated ?? post.date),
    changeFrequency: "monthly" as const,
    priority: 0.6,
  }));

  return [
${staticEntries},
    ...posts,
  ];
}
`;
}
