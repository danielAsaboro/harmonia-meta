import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("public documentation truth boundaries", () => {
  const readme = readFileSync("README.md", "utf8");
  const overview = readFileSync("docs/index.mdx", "utf8");
  const quickstart = readFileSync("docs/quickstart.mdx", "utf8");
  const deployment = readFileSync("docs/deployment.mdx", "utf8");
  const durableRuntime = readFileSync("docs/durable-runtime.md", "utf8");
  const continuity = readFileSync("docs/optimization/context-memory-continuity.mdx", "utf8");
  const durableRuntimeNote = readFileSync("docs/durable-runtime.md", "utf8");

  it("shows the recoverable stage outbox instead of direct transition publication", () => {
    expect(readme).toContain("one transaction --> OUTBOX");
    expect(readme).not.toContain("API -- stage transitions --> PS");
  });

  it("does not describe Telegram long polling as the production surface", () => {
    expect(readme).not.toContain("T -- long polling");
    expect(readme).toContain("not live-evidenced");
    expect(readme).toContain("ordinary allow-listed messages through the canonical chat router");
  });

  it("distinguishes the A2UI wire protocol from installed package versions", () => {
    expect(readme).toContain("v0.9 wire protocol");
    expect(readme).toContain("`@a2ui/react` 0.10.2");
    expect(readme).toContain("`@a2ui/web_core` 0.10.6");
  });

  it("separates fixture inspection from authenticated evidence", () => {
    expect(quickstart).toContain("Fixtures are never submission evidence");
    expect(quickstart).toContain("model-parsed text cannot authorize");
    expect(overview).toContain("web-only preview");
  });

  it("documents Agent Engine as mandatory in the managed worker", () => {
    expect(deployment).toContain("mandatory in the managed worker");
    expect(deployment).not.toContain("optional explicit production mode");
  });

  it("documents durable context, crash ambiguity, and honest verification limits", () => {
    for (const required of [
      "prune + spill", "intent before effect", "unknown is not failed", "operator resolution",
      "Firestore emulator", "does not prove multi-week uptime",
    ]) expect(durableRuntime).toContain(required);
  });

  it("explains the implemented context and memory rot controls without treating memory as authority", () => {
    for (const required of [
      "Context rot", "Memory rot", "prune + spill", "Authority comes first",
      "intent before effect", "attempt generation", "10/10", "does not prove multi-week uptime",
    ]) expect(continuity).toContain(required);
    expect(continuity).toContain("Memory Bank is advisory");
    expect(continuity).not.toContain("exactly-once external effects");
  });

  it("archives the orphaned runtime note and marks cited obsolete designs as historical", () => {
    expect(durableRuntimeNote).toContain("Archived implementation note (superseded 2026-08-28)");
    for (const path of [
      "docs/superpowers/specs/2026-08-23-managed-multimodel-agent-platform-design.md",
      "docs/superpowers/specs/2026-08-26-interactive-architecture-explorer-design.md",
      "docs/superpowers/plans/2026-08-23-role-routing-multimodal-analysis.md",
      "docs/superpowers/specs/2026-08-28-documentation-information-architecture-design.md",
    ]) expect(readFileSync(path, "utf8")).toContain("superseded 2026-08-28");
  });
});
