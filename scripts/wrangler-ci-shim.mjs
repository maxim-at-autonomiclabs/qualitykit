#!/usr/bin/env node
/**
 * Replaces node_modules/.bin/wrangler during Workers Builds.
 * On bare `deploy`, prepares the correct monorepo package then calls real wrangler.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const ciName = process.env.WRANGLER_CI_OVERRIDE_NAME;
const isBareDeploy =
  args[0] === "deploy" &&
  !args.includes("-c") &&
  !args.includes("--config") &&
  !args.includes("--cwd");

function realWranglerCli() {
  const candidates = [
    path.join(root, "node_modules", "wrangler", "bin", "wrangler.real.js"),
    path.join(root, "cloud", "node_modules", "wrangler", "bin", "wrangler.real.js"),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  console.error(
    "[wrangler-ci-shim] wrangler.real.js missing — cf-prepare did not patch wrangler",
  );
  process.exit(1);
}

if (ciName && isBareDeploy) {
  console.log(`[wrangler-ci-shim] CI deploy for ${ciName}`);
  const prepare = path.join(root, "scripts", "cf-prepare.mjs");
  const prep = spawnSync(process.execPath, [prepare], {
    cwd: root,
    stdio: "inherit",
    env: process.env,
  });
  if (prep.status !== 0) process.exit(prep.status ?? 1);
}

const cli = realWranglerCli();
const result = spawnSync(process.execPath, [cli, ...args], {
  cwd: process.cwd(),
  stdio: "inherit",
  env: process.env,
});
process.exit(result.status ?? 1);
