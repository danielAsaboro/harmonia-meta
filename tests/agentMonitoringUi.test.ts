import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

describe("agent monitoring surface", () => {
  const root = process.cwd();
  const page = fs.readFileSync(path.join(root, "src/app/dashboard/monitoring/page.tsx"), "utf8");
  const view = fs.readFileSync(path.join(root, "src/components/monitoring/WorkflowActivityView.tsx"), "utf8");
  const route = fs.readFileSync(path.join(root, "src/app/api/events/route.ts"), "utf8");

  it("exposes an Agents tab with success, retry, failure, empty, and load-error states", () => {
    expect(page).toContain('{ key: "agents", label: "Agents" }');
    expect(view).toContain("succeeded");
    expect(view).toContain("retrying");
    expect(view).toContain("failed");
    expect(view).toContain("No structured agent activity matches these filters.");
    expect(view).toContain("Agent activity could not be loaded.");
  });

  it("supports tenant-scoped activity filters through the existing event route", () => {
    expect(route).toContain('params.get("role")');
    expect(route).toContain('params.get("kind")');
    expect(route).toContain('params.get("status")');
    expect(route).toContain("getDurableRuntimeSnapshot");
  });

  it("surfaces durable runtime health and all four explicit ambiguity decisions", () => {
    for (const label of [
      "Stale leases", "Unknown effects", "Inbox lag", "Outbox lag",
      "Projection compiler", "Artifact integrity", "Recovery work",
      "Confirm applied", "Confirm not applied", "Compensate", "Cancel",
    ]) expect(view).toContain(label);
    expect(view).toContain("expectedEpoch");
    expect(view).toContain("artifactId");
    expect(view).toContain("digest");
  });
});
