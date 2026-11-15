/**
 * Meta reliability gate: dogfood QualityKit on fixtures + the marketing site.
 * Exit 1 on any assertion failure.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { qualitykitAudit } from "../dist/tools/qualitykit-audit.js";
import { qualitykitFix } from "../dist/tools/qualitykit-fix.js";
import { qualitykitGrow } from "../dist/tools/qualitykit-grow.js";
import { qualitykitVerify } from "../dist/tools/qualitykit-verify.js";

const rootDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const failures = [];

function parse(result) {
  return JSON.parse(result.content[0].text);
}

function assert(cond, message) {
  if (!cond) failures.push(message);
}

async function smokeBareApp() {
  const projectRoot = path.join(rootDir, "fixtures/bare-app");
  const siteUrl = "https://example.com";

  const audit = parse(await qualitykitAudit({ projectRoot, siteUrl }));
  assert(audit.ok !== false, "bare-app audit ok");
  assert(audit.defects?.length > 0, "bare-app should have defects");

  const grow = parse(await qualitykitGrow({ projectRoot, siteUrl }));
  assert(grow.ok, "bare-app grow ok");
  const page = (grow.topChanges || []).find((c) => c.kind === "page");
  assert(page, "bare-app grow should emit page opportunities");

  const fixTech = parse(
    await qualitykitFix({
      projectRoot,
      siteUrl,
      findingIds: ["missing-robots"],
      safeAutoOnly: true,
    }),
  );
  assert(
    fixTech.diffs?.some((d) => d.path?.endsWith("robots.ts")),
    "bare-app fix missing-robots → robots.ts diff",
  );

  const fixPage = parse(
    await qualitykitFix({
      projectRoot,
      siteUrl,
      opportunityIds: [page.id],
    }),
  );
  assert(
    fixPage.buildContracts?.length === 1,
    "bare-app page opportunity → one buildContract",
  );
  assert(
    !(fixPage.diffs || []).some((d) =>
      String(d.path || "").includes("features"),
    ),
    "bare-app page opportunity must not invent feature FileSpecs",
  );

  const missing = parse(
    await qualitykitVerify({
      projectRoot,
      siteUrl,
      opportunityIds: [page.id],
      markApplied: false,
    }),
  );
  assert(missing.pageResults?.[0]?.present === false, "page missing before create");
  assert(
    (missing.readyToShip || []).length === 0,
    "not readyToShip when page missing",
  );

  const present = parse(
    await qualitykitVerify({
      projectRoot,
      siteUrl,
      opportunityIds: [page.id],
      paths: { [page.id]: page.page.path },
      proposedFiles: [
        {
          path: `app${page.page.path}/page.tsx`,
          content: `export default function Page(){return <main><h1>Ok</h1></main>}\n`,
        },
      ],
      markApplied: false,
    }),
  );
  assert(present.pageResults?.[0]?.present === true, "page present via proposedFiles");
  assert(present.readyToShip?.includes(page.id), "readyToShip includes page id");
  assert(present.shipped == null, "offline verify does not ship");
}

async function smokeWebsite() {
  const projectRoot = path.join(rootDir, "website");
  const siteUrl = "https://qualitykit.dev";

  const audit = parse(await qualitykitAudit({ projectRoot, siteUrl }));
  assert(audit.ok !== false, "website audit ok");

  const grow = parse(await qualitykitGrow({ projectRoot, siteUrl }));
  assert(grow.ok, "website grow ok");
  const pages = (grow.topChanges || []).filter((c) => c.kind === "page");
  assert(pages.length > 0, "website grow emits page opportunities");

  // Explicit missing finding must not dump unrelated Next.js diffs on a static site
  const bogus = parse(
    await qualitykitFix({
      projectRoot,
      siteUrl,
      findingIds: ["missing-robots"],
      safeAutoOnly: true,
    }),
  );
  assert(
    (bogus.diffs || []).length === 0,
    "website: unknown findingIds must not emit unrelated diffs",
  );
  assert(
    (bogus.skipped || []).some((s) => s.id === "missing-robots"),
    "website: missing finding is skipped with reason",
  );

  const pageIds = pages.map((p) => p.id);
  const contracts = parse(
    await qualitykitFix({
      projectRoot,
      siteUrl,
      opportunityIds: pageIds,
    }),
  );
  assert(
    contracts.buildContracts?.length === pages.length,
    "website: one buildContract per page opportunity",
  );
  assert(
    contracts.buildContracts.every((c) =>
      c.constraints?.some((x) => /static html/i.test(x)),
    ),
    "website: contracts mention static HTML implementation",
  );
  assert(
    (contracts.diffs || []).length === 0,
    "website: page opportunities must not invent FileSpecs",
  );

  const shippedId = "page-feature-features-seo-mcp";
  const shipped = parse(
    await qualitykitVerify({
      projectRoot,
      siteUrl,
      opportunityIds: [shippedId],
      paths: { [shippedId]: "/features/seo-mcp" },
      markApplied: false,
    }),
  );
  assert(
    shipped.pageResults?.[0]?.present === true,
    "website: /features/seo-mcp present after meta ship",
  );
  assert(
    shipped.readyToShip?.includes(shippedId),
    "website: seo-mcp page is readyToShip",
  );

  // Fix should skip already-present path
  const skipFix = parse(
    await qualitykitFix({
      projectRoot,
      siteUrl,
      opportunityIds: [shippedId],
    }),
  );
  assert(
    (skipFix.skipped || []).some((s) => s.id === shippedId),
    "website: existing page opportunity is skipped (already_present)",
  );

  const missingPage = pages.find((p) => p.page?.path !== "/features/seo-mcp");
  if (missingPage) {
    const staticFile = `${missingPage.page.path
      .replace(/^\//, "")
      .replace(/\/$/, "")}/index.html`;
    const verifyHit = parse(
      await qualitykitVerify({
        projectRoot,
        siteUrl,
        opportunityIds: [missingPage.id],
        proposedFiles: [
          {
            path: staticFile,
            content: `<!doctype html><html><head><title>Meta</title></head><body><h1>Meta</h1></body></html>\n`,
          },
        ],
        markApplied: false,
      }),
    );
    assert(
      verifyHit.pageResults?.[0]?.present === true,
      `website: proposed ${staticFile} detected as route`,
    );
  }
}

async function main() {
  await smokeBareApp();
  await smokeWebsite();

  if (failures.length) {
    console.error(
      JSON.stringify({ ok: false, failures }, null, 2),
    );
    process.exit(1);
  }
  console.log(
    JSON.stringify(
      {
        ok: true,
        message: "meta smoke passed (bare-app + website grow/fix/verify)",
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
