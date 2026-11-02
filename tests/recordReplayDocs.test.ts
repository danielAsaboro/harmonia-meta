import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
describe("record replay operator guide", () => {
  it("documents trust boundaries and the full no-capture workflow", () => {
    const doc = readFileSync("docs/record-replay.mdx", "utf8");
    for (const phrase of ["fixture", "recorded_replay", "live", "Recorded authenticated run — replay mode", "not fresh", "private_candidate", "approved_public_bundle", "pause", "resume", "after", "Do not fabricate"]) expect(doc).toContain(phrase);
  });
});
