#!/usr/bin/env node
/**
 * Rebuild the public `engine-publish` branch from packages/engine.
 * Private qualitykit-cloud depends on:
 *   github:maxim-at-autonomiclabs/qualitykit#engine-publish
 *
 * After changing packages/engine on main:
 *   node scripts/refresh-engine-publish.mjs
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function run(command, args) {
  console.log(`> ${command} ${args.join(" ")}`);
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

run("git", ["branch", "-D", "engine-publish"]);
run("git", ["push", "origin", "--delete", "engine-publish"]);
run("git", ["subtree", "split", "--prefix=packages/engine", "-b", "engine-publish"]);
run("git", ["push", "origin", "engine-publish"]);
console.log("Updated origin/engine-publish");
