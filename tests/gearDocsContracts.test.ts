import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("GEAR architecture documentation contracts", () => {
  it("describes claim-before-effect rather than receipt lookup as the concurrency boundary", () => {
    const architecture = readFileSync("docs/architecture/overview.mdx", "utf8");
    expect(architecture).toContain("atomically claims");
    expect(architecture).toContain("expired unresolved claim");
    expect(architecture).toContain("`already_applied` with the original receipt identity");
    expect(architecture).not.toContain("returns the original receipt as `already_applied`");
    expect(architecture).not.toContain("Before executing, the publish stage checks existing receipts");
  });

  it("reserves durable replay observations for explicit operator proof", () => {
    const design = readFileSync("docs/superpowers/specs/2026-08-25-effect-claim-recovery-design.md", "utf8");
    expect(design).toContain("operator replay-proof route");
    expect(design).not.toContain("An `already_applied` claim response writes a durable replay observation");
  });

  it("does not represent ordinary duplicate suppression as a new audit receipt", () => {
    const readme = readFileSync("README.md", "utf8");
    const approvalDocs = readFileSync("docs/approval-and-audit.mdx", "utf8");
    expect(readme).toContain("`already_applied` with the original receipt identity");
    expect(readme).toContain("Only explicit operator replay persists a replay observation");
    expect(readme).not.toContain("outcome (`applied` / `already_applied` / `failed`)");
    expect(approvalDocs).not.toContain("`already_applied` returns the original receipt and suppresses");
  });
});
