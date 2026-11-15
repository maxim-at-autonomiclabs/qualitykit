import type { FileSpec } from "../model/site.js";

export interface UnifiedDiff {
  path: string;
  kind: FileSpec["kind"];
  diff: string;
  rationale: string;
}

export function fileSpecToDiff(
  spec: FileSpec,
  existingContent?: string,
): UnifiedDiff {
  if (spec.kind === "create" && spec.content != null) {
    const lines = spec.content.split(/\r?\n/);
    const body = lines.map((l) => `+${l}`).join("\n");
    return {
      path: spec.path,
      kind: "create",
      rationale: spec.rationale,
      diff: [
        `--- /dev/null`,
        `+++ b/${spec.path}`,
        `@@ -0,0 +1,${lines.length} @@`,
        body,
      ].join("\n"),
    };
  }

  if (spec.kind === "edit" && spec.snippet) {
    const before = existingContent ?? "";
    let after = before;
    if (spec.anchor && before.includes(spec.anchor)) {
      after = before.replace(
        spec.anchor,
        `${spec.anchor}\n  ${spec.snippet}`,
      );
    } else if (spec.snippet) {
      after = before ? `${before}\n${spec.snippet}\n` : spec.snippet;
    }
    return {
      path: spec.path,
      kind: "edit",
      rationale: spec.rationale,
      diff: makeUnifiedDiff(spec.path, before, after),
    };
  }

  return {
    path: spec.path,
    kind: spec.kind,
    rationale: spec.rationale,
    diff: `# note: ${spec.path}\n# ${spec.rationale}\n${spec.content ?? spec.snippet ?? ""}`,
  };
}

function makeUnifiedDiff(path: string, before: string, after: string): string {
  const a = before.split(/\r?\n/);
  const b = after.split(/\r?\n/);
  // Simple full-file replace style diff for clarity
  const remove = a.map((l) => `-${l}`).join("\n");
  const add = b.map((l) => `+${l}`).join("\n");
  return [
    `--- a/${path}`,
    `+++ b/${path}`,
    `@@ -1,${a.length} +1,${b.length} @@`,
    remove,
    add,
  ].join("\n");
}
