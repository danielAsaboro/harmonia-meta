import { describe, expect, it } from "vitest";
import { architectureDefinition } from "../src/lib/architecture/data";
import { buildArchitectureDetail, getResponsiveMode } from "../src/components/architecture/detailModel";

const byId = (id: string) => architectureDefinition.nodes.find((node) => node.id === id)!;

describe("architecture interaction view models", () => {
  it("builds truthful selected-node details", () => {
    const detail = buildArchitectureDetail(byId("agent-temi"));
    expect(detail.model).toBe("Gemini 3.5 Flash-Lite");
    expect(detail.authorityNote).toMatch(/proposes.*cannot approve.*publish/i);
    expect(detail.deepLink).toBe("?node=agent-temi");
  });

  it("uses an intentional narrow-screen tree fallback", () => {
    expect(getResponsiveMode(639)).toBe("tree");
    expect(getResponsiveMode(640)).toBe("graph");
  });
});
