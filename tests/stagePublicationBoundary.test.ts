import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

function sourceFiles(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : entry.name.endsWith(".ts") ? [path] : [];
  });
}

describe("stage publication boundary", () => {
  it("allows Pub/Sub stage publication only inside the outbox dispatcher", () => {
    const root = join(process.cwd(), "src");
    const callers = sourceFiles(root)
      .filter((path) => /\bpublishStage\s*\(/.test(readFileSync(path, "utf8")))
      .map((path) => relative(process.cwd(), path))
      .sort();
    expect(callers).toEqual([
      "src/lib/pubsub.ts",
      "src/lib/stageOutboxDispatcher.ts",
    ]);
  });
});
