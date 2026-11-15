import { z } from "zod";
import type { ContentBrief, SiteModel } from "../model/site.js";
import { errorResult, jsonResult, loadSite } from "./helpers.js";

export const contentBriefInputSchema = {
  projectRoot: z
    .string()
    .describe("Absolute path to the website repository root"),
  siteUrl: z.string().url().optional(),
  maxBriefs: z.number().int().min(1).max(3).optional().default(3),
};

export async function contentBrief(args: {
  projectRoot: string;
  siteUrl?: string;
  maxBriefs?: number;
}) {
  try {
    const site = loadSite(args.projectRoot, args.siteUrl);
    const briefs = buildContentBriefs(site, args.maxBriefs ?? 3);
    return jsonResult({
      ok: true,
      tool: "content.brief",
      briefCount: briefs.length,
      briefs,
      notes: [
        "At most three briefs. Do not mass-generate articles.",
        "Do not publish if claims are unverified or content overlaps existing pages.",
      ],
    });
  } catch (error) {
    return errorResult(error);
  }
}

export function buildContentBriefs(
  site: SiteModel,
  maxBriefs: number,
): ContentBrief[] {
  const brand = site.business.name ?? site.packageName ?? "the product";
  const topics =
    site.business.topics.length > 0
      ? site.business.topics
      : ["getting-started", "best-practices", "comparison"];
  const audience =
    site.business.audienceHints[0] ?? "people evaluating this product or service";
  const existingPaths = new Set(site.routes.map((r) => r.path.toLowerCase()));

  const templates: Array<() => ContentBrief> = [
    () => {
      const topic = topics[0] ?? "basics";
      return {
        slug: `understanding-${topic}`,
        title: `Understanding ${topic} for ${brand}`,
        audience,
        intent: "informational",
        questionsToAnswer: [
          `What is ${topic} in the context of ${brand}?`,
          `Who should care about ${topic}?`,
          `What is the first step to get value?`,
        ],
        outline: [
          "Direct answer (2–4 sentences)",
          "Why it matters",
          "How it works with the product/service",
          "Practical next steps",
          "Related internal pages",
        ],
        claimsNeedingSources: [
          "Any market size, ranking, or performance statistic",
          "Competitive comparisons",
        ],
        internalLinks: pickInternalLinks(site, ["/"]),
        doNotPublishIf: [
          "Any [verify] marker remains",
          `A page already covers the same ${topic} overview`,
          "Author attribution is invented",
        ],
        priority: 0.9,
      };
    },
    () => {
      const topic = topics[1] ?? topics[0] ?? "workflow";
      return {
        slug: `how-to-${topic}`,
        title: `How to ${topic} with ${brand}`,
        audience,
        intent: "transactional / how-to",
        questionsToAnswer: [
          `How do I ${topic}?`,
          "What prerequisites are required?",
          "What mistakes should I avoid?",
        ],
        outline: [
          "Direct answer summary",
          "Prerequisites",
          "Step-by-step instructions",
          "Common mistakes",
          "When to use a related feature/page",
        ],
        claimsNeedingSources: [
          "Time estimates",
          "Compatibility claims",
        ],
        internalLinks: pickInternalLinks(site, ["/", "/blog"]),
        doNotPublishIf: [
          "Steps cannot be verified against the current product",
          "Overlaps an existing docs/how-to page without adding value",
        ],
        priority: 0.8,
      };
    },
    () => {
      const topic = topics[2] ?? "alternatives";
      return {
        slug: `${topic}-guide`,
        title: `${capitalize(topic)} guide for teams evaluating ${brand}`,
        audience,
        intent: "commercial investigation",
        questionsToAnswer: [
          `How should teams evaluate ${topic}?`,
          `Where does ${brand} fit?`,
          "What criteria matter most?",
        ],
        outline: [
          "Direct answer / decision criteria",
          "Evaluation framework",
          "Evidence and examples",
          "Honest limitations",
          "Recommended next step",
        ],
        claimsNeedingSources: [
          "Any claim about competitors",
          "Customer results or case-study numbers",
        ],
        internalLinks: pickInternalLinks(site, ["/", "/pricing", "/about"]),
        doNotPublishIf: [
          "Competitor claims are unsourced",
          "Page would be thin affiliate-style content",
        ],
        priority: 0.7,
      };
    },
  ];

  const briefs: ContentBrief[] = [];
  for (const make of templates) {
    if (briefs.length >= maxBriefs) break;
    const brief = make();
    if (existingPaths.has(`/blog/${brief.slug}`)) continue;
    briefs.push(brief);
  }
  return briefs;
}

function pickInternalLinks(site: SiteModel, preferred: string[]): string[] {
  const available = new Set(site.routes.map((r) => r.path));
  const links = preferred.filter((p) => available.has(p) || p === "/");
  if (links.length === 0 && available.has("/")) links.push("/");
  for (const route of site.routes) {
    if (links.length >= 4) break;
    if (route.kind === "page" && !links.includes(route.path)) {
      links.push(route.path);
    }
  }
  return links;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
