import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

describe("bounded autonomy and KPI documentation", () => {
  const readme = readFileSync(join(process.cwd(), "README.md"), "utf8");
  const document = readFileSync(join(process.cwd(), "docs/operational-model.mdx"), "utf8");
  const durableRuntime = readFileSync(join(process.cwd(), "docs/durable-runtime.md"), "utf8");
  it("explains where Harmonia is and is not an agent", () => {
    expect(readme).toContain("Why Harmonia is an agent—and where it deliberately is not");
    expect(document).toContain("bounded agency inside a durable workflow");
  });
  it.each([
    "agentic cognition", "deterministic workflow", "human authority",
    "hands-off processing time", "approved-output yield", "duplicate-effect prevention",
    "cost per verified asset", "pending authenticated run",
  ])("documents %s", (required) => expect(document).toContain(required));
  it("links bounded agency to durable operation epochs and recovery work", () => {
    expect(durableRuntime).toContain("operation epoch");
    expect(durableRuntime).toContain("recovery_work");
  });
});
