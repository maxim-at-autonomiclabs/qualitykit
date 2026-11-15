import { defineConfig } from "vite";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: rootDir,
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolve(rootDir, "index.html"),
        docs: resolve(rootDir, "docs/index.html"),
        aiAudit: resolve(rootDir, "docs/ai-audit/index.html"),
        pricing: resolve(rootDir, "pricing/index.html"),
        seoMcp: resolve(rootDir, "features/seo-mcp/index.html"),
        seoAeo: resolve(rootDir, "features/seo-aeo/index.html"),
        aeoMcp: resolve(rootDir, "features/aeo-mcp/index.html"),
        solutionsNextjs: resolve(rootDir, "solutions/nextjs-developers/index.html"),
        compareSeoMcp: resolve(rootDir, "compare/seo-mcp-tools/index.html"),
        guideAeoMcp: resolve(rootDir, "guides/how-to-aeo-mcp/index.html"),
      },
    },
  },
});
