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
      },
    },
  },
});
