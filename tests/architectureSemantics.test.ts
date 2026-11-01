import { describe, expect, it } from "vitest";
import { edgeAppearance } from "../src/components/architecture/ArchitectureEdge";
import { statusTone } from "../src/components/architecture/ArchitectureNode";

describe("architecture visual semantics", () => {
  it("does not rely on color alone for edges", () => {
    expect(edgeAppearance.approval.label).toBe("Human approval");
    expect(edgeAppearance.approval.marker).toBe("gate");
    expect(edgeAppearance.telemetry.dash).toBeTruthy();
    expect(edgeAppearance.verification.label).toMatch(/verification/i);
    expect(edgeAppearance.blocked.marker).toBe("stop");
  });

  it("assigns explicit status labels and tones", () => {
    expect(statusTone["pending-live"].label).toBe("Pending live evidence");
    expect(statusTone["approval-gated"].label).toBe("Approval gated");
    expect(statusTone["read-only"].label).toBe("Read only");
  });
});
