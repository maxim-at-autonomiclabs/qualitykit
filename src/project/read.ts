import fs from "node:fs";
import path from "node:path";
import type { ProjectFile } from "../model/site.js";

const SKIP_DIRS = new Set([
  ".git",
  "node_modules",
  ".next",
  "dist",
  "build",
  "out",
  "coverage",
  ".turbo",
  ".vercel",
  ".cache",
]);

const SKIP_FILE_NAMES = new Set([
  "credentials.json",
  "service-account.json",
  "id_rsa",
  "id_ed25519",
]);

const SKIP_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".ico",
  ".svg",
  ".woff",
  ".woff2",
  ".ttf",
  ".eot",
  ".mp4",
  ".mp3",
  ".pdf",
  ".zip",
  ".map",
]);

const TEXT_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".json",
  ".md",
  ".mdx",
  ".txt",
  ".css",
  ".scss",
  ".html",
  ".xml",
  ".yml",
  ".yaml",
  ".toml",
]);

const DEFAULT_MAX_FILE_BYTES = 200_000;
const DEFAULT_MAX_FILES = 400;

export interface ReadProjectOptions {
  maxFileBytes?: number;
  maxFiles?: number;
}

export class ProjectReadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProjectReadError";
  }
}

export function resolveSafeRoot(projectRoot: string): string {
  if (!projectRoot || typeof projectRoot !== "string") {
    throw new ProjectReadError("projectRoot is required");
  }
  if (!path.isAbsolute(projectRoot)) {
    throw new ProjectReadError(
      `projectRoot must be an absolute path, got: ${projectRoot}`,
    );
  }
  const resolved = path.resolve(projectRoot);
  if (!fs.existsSync(resolved)) {
    throw new ProjectReadError(`projectRoot does not exist: ${resolved}`);
  }
  const stat = fs.statSync(resolved);
  if (!stat.isDirectory()) {
    throw new ProjectReadError(`projectRoot is not a directory: ${resolved}`);
  }
  return resolved;
}

export function assertWithinRoot(root: string, candidate: string): string {
  const resolvedRoot = path.resolve(root);
  const resolvedCandidate = path.resolve(candidate);
  const relative = path.relative(resolvedRoot, resolvedCandidate);
  if (
    relative.startsWith("..") ||
    path.isAbsolute(relative) ||
    relative.includes(`..${path.sep}`)
  ) {
    throw new ProjectReadError(
      `Path escapes projectRoot: ${candidate} (root: ${resolvedRoot})`,
    );
  }
  return resolvedCandidate;
}

function shouldSkipDir(name: string): boolean {
  return SKIP_DIRS.has(name) || name.startsWith(".git");
}

function shouldSkipFile(name: string): boolean {
  if (name.startsWith(".env")) return true;
  if (SKIP_FILE_NAMES.has(name)) return true;
  if (name.endsWith(".pem") || name.endsWith(".key")) return true;
  return false;
}

function isProbablyText(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  if (SKIP_EXTENSIONS.has(ext)) return false;
  if (TEXT_EXTENSIONS.has(ext)) return true;
  // Allow extensionless config-ish names
  const base = path.basename(filePath);
  return (
    base === "Dockerfile" ||
    base === "Makefile" ||
    base === "LICENSE" ||
    base === "robots.txt"
  );
}

function toPosix(relativePath: string): string {
  return relativePath.split(path.sep).join("/");
}

export function readProjectFiles(
  projectRoot: string,
  options: ReadProjectOptions = {},
): ProjectFile[] {
  const root = resolveSafeRoot(projectRoot);
  const maxFileBytes = options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;
  const maxFiles = options.maxFiles ?? DEFAULT_MAX_FILES;
  const files: ProjectFile[] = [];

  function walk(dir: string): void {
    if (files.length >= maxFiles) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (files.length >= maxFiles) break;
      const full = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        if (shouldSkipDir(entry.name)) continue;
        walk(full);
        continue;
      }

      if (!entry.isFile()) continue;
      if (shouldSkipFile(entry.name)) continue;
      if (!isProbablyText(full)) continue;

      let stat: fs.Stats;
      try {
        stat = fs.statSync(full);
      } catch {
        continue;
      }
      if (stat.size > maxFileBytes) continue;

      let content: string;
      try {
        content = fs.readFileSync(full, "utf8");
      } catch {
        continue;
      }

      // Skip binary-looking content
      if (content.includes("\u0000")) continue;

      const relative = toPosix(path.relative(root, full));
      files.push({
        path: relative,
        content,
        size: stat.size,
      });
    }
  }

  walk(root);
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

export function findFile(
  files: ProjectFile[],
  ...candidates: string[]
): ProjectFile | undefined {
  const set = new Map(files.map((f) => [f.path, f]));
  for (const c of candidates) {
    const hit = set.get(c);
    if (hit) return hit;
  }
  return undefined;
}

export function filesMatching(
  files: ProjectFile[],
  predicate: (file: ProjectFile) => boolean,
): ProjectFile[] {
  return files.filter(predicate);
}
