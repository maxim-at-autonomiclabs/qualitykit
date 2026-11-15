#!/usr/bin/env node
/**
 * Local / explicit monorepo deploy.
 * Usage: npm run cf:deploy -- qualitykit-cloud|qualitykit-web
 * Workers Builds uses postinstall (cf-prepare) + `npx wrangler deploy` instead.
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const worker =
  process.env.WRANGLER_CI_OVERRIDE_NAME ||
  process.argv[2] ||
  "qualitykit-cloud";

function run(command, args) {
  console.log(`\n> ${command} ${args.join(" ")}`);
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: "inherit",
    shell: process.platform === "win32",
    env: process.env,
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

process.env.WRANGLER_CI_OVERRIDE_NAME = worker;
run(process.execPath, [path.join(root, "scripts", "cf-prepare.mjs")]);
run("npx", ["wrangler", "deploy"]);
