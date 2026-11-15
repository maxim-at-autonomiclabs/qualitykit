import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  ProjectReadError,
  assertWithinRoot,
  readProjectFiles,
  resolveSafeRoot,
} from "../src/project/read.js";

const fixturesRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../fixtures",
);

describe("project reader", () => {
  it("reads text files and excludes .env", () => {
    const root = path.join(fixturesRoot, "bare-app");
    const files = readProjectFiles(root);
    expect(files.some((f) => f.path === "package.json")).toBe(true);
    expect(files.some((f) => f.path.startsWith(".env"))).toBe(false);
    expect(files.every((f) => !f.path.includes("node_modules"))).toBe(true);
  });

  it("rejects relative projectRoot", () => {
    expect(() => resolveSafeRoot("fixtures/bare-app")).toThrow(ProjectReadError);
  });

  it("rejects path traversal outside root", () => {
    const root = path.join(fixturesRoot, "bare-app");
    expect(() =>
      assertWithinRoot(root, path.join(root, "..", "pages-router")),
    ).toThrow(ProjectReadError);
  });

  it("rejects missing directories", () => {
    expect(() =>
      resolveSafeRoot(path.join(os.tmpdir(), "qualitykit-missing-" + Date.now())),
    ).toThrow(ProjectReadError);
  });

  it("skips secret filenames", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qk-secrets-"));
    fs.writeFileSync(path.join(tmp, "credentials.json"), '{"token":"x"}');
    fs.writeFileSync(path.join(tmp, "ok.txt"), "hello");
    const files = readProjectFiles(tmp);
    expect(files.map((f) => f.path)).toEqual(["ok.txt"]);
    fs.rmSync(tmp, { recursive: true, force: true });
  });
});
