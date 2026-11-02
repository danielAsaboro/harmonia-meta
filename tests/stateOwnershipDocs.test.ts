import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

describe("state ownership documentation", () => {
  const document = readFileSync(join(process.cwd(), "docs/state-ownership.mdx"), "utf8");
  const readme = readFileSync(join(process.cwd(), "README.md"), "utf8");
  const interfaces = readFileSync(join(process.cwd(), "docs/interfaces.mdx"), "utf8");
  it.each([
    "Invocation state", "Managed ADK session", "Firestore job", "Approval decisions",
    "Receipts and verification", "Chat history", "Memory Bank", "Secrets", "Private evidence",
    "Source of truth", "Retention",
  ])("documents %s", (required) => expect(document).toContain(required));

  it("assigns editorial-plan persistence and lifecycle authority to Firestore and deterministic code", () => {
    expect(document).toMatch(/complete Temi editorial plan/i);
    expect(document).toMatch(/canonical digest/i);
    expect(document).toMatch(/selected item lifecycle/i);
    expect(document).toMatch(/Memory Bank[\s\S]*never.*authoriz/i);
  });

  it("shows the plan worker stage and exact editorial item lifecycle without conflating effects", () => {
    expect(readme).toMatch(/strategy approval · plan · draft · publish · verify handlers/);
    expect(interfaces).toContain("planned → selected → drafting → reviewed → awaiting_approval");
    expect(interfaces).toMatch(/Approval, scheduling, external calendar synchronization, and publishing are downstream effects/);
  });
});
