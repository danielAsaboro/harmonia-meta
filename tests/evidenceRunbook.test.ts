import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

describe("authenticated evidence runbook", () => {
  const runbook = readFileSync(join(process.cwd(), "docs/evidence-runbook.mdx"), "utf8");

  it.each([
    "emulator",
    "awaiting_approval",
    "already_applied",
    "Meta Model API",
    "Cloud Run revision",
    "traceId",
    "private/public boundary",
    "capture-awaiting-approval",
    "capture-complete",
  ])("documents required proof boundary: %s", (required) => {
    expect(runbook).toContain(required);
  });
});
