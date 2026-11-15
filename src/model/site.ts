export type FrameworkId = "nextjs" | "generic";

export type RouterKind = "app" | "pages" | "unknown";

export type Severity = "critical" | "high" | "medium" | "low" | "info";

export type ChangeKind = "create" | "edit" | "note";

export interface ProjectFile {
  /** Posix-style path relative to project root */
  path: string;
  content: string;
  size: number;
}

export interface AnalyzeOptions {
  siteUrl?: string;
}

export interface BlogOptions {
  includeCategories?: boolean;
  skeletonCount?: number;
}

export interface RouteInfo {
  path: string;
  file: string;
  kind: "page" | "layout" | "route" | "other";
  title?: string;
  description?: string;
  hasMetadata: boolean;
  hasCanonical: boolean;
  headings: string[];
  h1Count: number;
  imagesMissingAlt: number;
  internalLinks: string[];
}

export interface MetadataSignals {
  hasMetadataBase: boolean;
  hasTitleTemplate: boolean;
  hasRootTitle: boolean;
  hasRootDescription: boolean;
  metadataBaseValue?: string;
  titleTemplate?: string;
  rootTitle?: string;
  rootDescription?: string;
  layoutFile?: string;
}

export interface RobotsSignals {
  present: boolean;
  source?: "app/robots.ts" | "app/robots.txt" | "public/robots.txt" | "pages";
  file?: string;
  content?: string;
  blocksAll?: boolean;
  aiCrawlers: AiCrawlerStatus[];
}

export interface AiCrawlerStatus {
  name: string;
  status: "allowed" | "disallowed" | "unknown";
  evidence?: string;
}

export interface SitemapSignals {
  present: boolean;
  source?: "app/sitemap.ts" | "public/sitemap.xml" | "pages";
  file?: string;
  routesHint: string[];
}

export interface RedirectSignals {
  present: boolean;
  file?: string;
  count: number;
  snippets: string[];
}

export interface StructuredDataSignals {
  files: string[];
  types: string[];
}

export interface BlogSignals {
  present: boolean;
  routes: string[];
  contentDir?: string;
  postCount: number;
}

export interface BusinessHints {
  name?: string;
  description?: string;
  audienceHints: string[];
  topics: string[];
  packageName?: string;
  confidence: number;
}

export interface SiteModel {
  projectRoot: string;
  framework: FrameworkId;
  frameworkConfidence: number;
  router: RouterKind;
  siteUrl?: string;
  packageName?: string;
  nextVersion?: string;
  routes: RouteInfo[];
  metadata: MetadataSignals;
  robots: RobotsSignals;
  sitemap: SitemapSignals;
  redirects: RedirectSignals;
  structuredData: StructuredDataSignals;
  blog: BlogSignals;
  business: BusinessHints;
  unsupportedReason?: string;
  files: ProjectFile[];
}

export interface FileSpec {
  path: string;
  kind: ChangeKind;
  content?: string;
  /** For edits: text that should already exist near the change */
  anchor?: string;
  /** For edits: suggested replacement or insertion */
  snippet?: string;
  rationale: string;
}

export interface Recommendation {
  id: string;
  title: string;
  category:
    | "technical-seo"
    | "blog"
    | "schema"
    | "internal-links"
    | "content"
    | "aeo"
    | "performance";
  severity: Severity;
  impact: number;
  confidence: number;
  effort: number;
  risk: number;
  priority: number;
  evidence: string[];
  rationale: string;
  files: FileSpec[];
  dependencies?: string[];
  requiresUserApproval?: boolean;
}

export interface AuditFinding {
  id: string;
  severity: Severity;
  title: string;
  detail: string;
  evidence: string[];
  relatedRecommendationIds?: string[];
}

export interface AuditResult {
  site: Omit<SiteModel, "files">;
  findings: AuditFinding[];
  summary: {
    critical: number;
    high: number;
    medium: number;
    low: number;
    info: number;
  };
}

export interface LinkSuggestion {
  sourceFile: string;
  sourceRoute: string;
  targetHref: string;
  anchorText: string;
  rationale: string;
  sharedTerms: string[];
}

export interface ContentBrief {
  slug: string;
  title: string;
  audience: string;
  intent: string;
  questionsToAnswer: string[];
  outline: string[];
  claimsNeedingSources: string[];
  internalLinks: string[];
  doNotPublishIf: string[];
  priority: number;
}

export function scorePriority(
  impact: number,
  confidence: number,
  effort: number,
  risk: number,
): number {
  const safeImpact = clamp(impact, 1, 10);
  const safeConfidence = clamp(confidence, 0.1, 1);
  const safeEffort = clamp(effort, 1, 10);
  const safeRisk = clamp(risk, 1, 10);
  return round2((safeImpact * safeConfidence) / (safeEffort + safeRisk));
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function stripFiles(site: SiteModel): Omit<SiteModel, "files"> {
  const { files: _files, ...rest } = site;
  return rest;
}
