import { describe, expect, it } from "vitest";
import { architectureDefinition } from "../src/lib/architecture/data";
import { buildArchitectureDetail } from "../src/components/architecture/detailModel";

const byId = (id: string) => architectureDefinition.nodes.find((node) => node.id === id)!;

describe("Harmonia architecture dataset", () => {
  it("contains the exact agent and model team", () => {
    expect(byId("agent-harmonia").model?.name).toBe("Gemini 3.5 Flash-Lite");
    expect(byId("agent-intent-router").model?.name).toBe("Gemini 3.5 Flash-Lite");
    expect(byId("agent-ryan").model?.name).toBe("Gemini 3.5 Flash");
    expect(byId("agent-nimi").model?.name).toBe("Gemini 3.5 Flash");
    expect(byId("agent-noni").model?.name).toBe("Gemini 3.5 Flash");
    expect(byId("agent-dara").model?.name).toBe("Gemini 3.5 Flash");
    expect(byId("agent-temi").model?.name).toBe("Gemini 3.5 Flash-Lite");
    expect(byId("agent-maya").model?.name).toBe("Gemini 3.5 Flash");
    expect(byId("agent-nova").model?.name).toBe("Gemini 3.5 Flash");
  });

  it("contains the eleven stages, routing skill, and read-only data tools", () => {
    for (const id of ["collect-sources", "extract-sources", "analyze", "strategize", "strategy-approval", "plan", "draft", "await-approval", "publish-render", "verify", "learn"]) expect(byId(`stage-${id}`)).toBeTruthy();
    for (const id of ["trend-scan", "signal-watch", "engagement-insights", "job-status", "posting-schedule"]) expect(byId(`skill-${id}`)).toBeTruthy();
    expect(byId("skill-noni-writing-skills")).toBeTruthy();
    expect(byId("skill-dara-editing-skills")).toBeTruthy();
    expect(byId("skill-harmonia-intent-routing")).toBeTruthy();
    expect(byId("agent-intent-router").skills).toEqual(["harmonia-intent-routing"]);
    expect(architectureDefinition.edges).toContainEqual(expect.objectContaining({ source: "agent-harmonia", target: "agent-intent-router", kind: "delegation" }));
    for (const id of ["fetch-trend-signals", "search-trend-signals", "get-engagement-insights", "get-operator-feed", "get-job-status", "suggest-posting-windows", "search-verified-publications", "meta-web-search"]) {
      expect(byId(`tool-${id}`).authorities).toEqual(["read"]);
    }
  });

  it("keeps durable and ephemeral state ownership explicit", () => {
    expect(byId("firestore").stateLifetime).toBe("durable");
    expect(byId("agent-engine").stateLifetime).toBe("ephemeral");
    expect(byId("agent-engine").summary).toMatch(/cognitive runtime/i);
  });

  it("represents Temi planning as agentic cognition inside deterministic controls", () => {
    expect(byId("stage-plan").summary).toMatch(/persist.*select/i);
    expect(byId("agent-temi").summary).toMatch(/approved Ryan strategy/i);
    expect(byId("agent-ryan").promptResponsibility).toMatch(/allow-listed filesystem method skill/i);
    expect(byId("agent-ryan").skills).toEqual(["ryan-strategy-skills"]);
    expect(byId("agent-temi").promptResponsibility).toMatch(/planning-method skill.*request-bound snapshot.*no final copy.*external scheduling.*effects/i);
    expect(byId("agent-temi").skills).toEqual(["temi-editorial-planning-skills"]);
    expect(buildArchitectureDetail(byId("agent-temi")).authorityNote).toMatch(/editorial-plan proposal.*no external calendar authority/i);
    expect(byId("agent-noni").summary).toBe(
      "Produces the exact requested multi-format artifact batch and at most one issue-bound revision from the approved output plan and referenced evidence.",
    );
    expect(byId("agent-dara").summary).toMatch(/all seven editorial checks.*at most one revision.*complete issue resolution/i);
    expect(byId("agent-dara").skills).toEqual(["dara-editing-skills"]);
    expect(byId("agent-dara").promptResponsibility).toMatch(/allow-listed editing method.*no workflow metadata.*replacement copy.*effects/i);
    expect(byId("firestore").summary).toMatch(/editorial plan.*item lifecycle/i);
    expect(architectureDefinition.edges).toContainEqual(expect.objectContaining({
      source: "stage-plan", target: "agent-temi", kind: "delegation",
    }));
    expect(architectureDefinition.edges).toContainEqual(expect.objectContaining({
      source: "agent-temi", target: "firestore", kind: "workflow",
    }));
    expect(architectureDefinition.edges).toContainEqual(expect.objectContaining({
      source: "firestore", target: "agent-noni",
      label: "Selected item + exact Ryan brief + referenced Nimi evidence",
    }));
    expect(architectureDefinition.edges).toContainEqual(expect.objectContaining({
      source: "stage-strategy-approval", target: "stage-plan", kind: "approval",
    }));
    expect(architectureDefinition.edges).toContainEqual(expect.objectContaining({
      source: "stage-await-approval", target: "stage-publish-render", kind: "approval",
    }));
    expect(architectureDefinition.edges).toContainEqual(expect.objectContaining({
      source: "stage-publish-render", target: "stage-verify", kind: "verification",
    }));
  });

  it("does not claim pending providers are live verified", () => {
    for (const id of ["external-veo", "external-lyria", "agent-engine", "memory-bank"]) {
      expect(byId(id).statuses).toContain("pending-live");
      expect(byId(id).statuses).not.toContain("offline-verified");
    }
  });

  it("represents the canonical approval policy for each effect", () => {
    for (const id of ["effect-publish-x", "effect-generate-veo", "effect-generate-lyria", "effect-schedule-content"]) {
      expect(byId(id).statuses).toContain("approval-gated");
      expect(byId(id).approval).toBe("Required");
    }
    for (const id of ["effect-export-artifact", "effect-generate-image", "effect-render-media"]) {
      expect(byId(id).statuses).not.toContain("approval-gated");
      expect(byId(id).approval).toBe("Not required");
      expect(byId(id).summary).toMatch(/internal|artifact|local/i);
    }
    const approvalTargets = architectureDefinition.edges
      .filter((edge) => edge.source === "approval-receipt")
      .map((edge) => edge.target)
      .sort();
    expect(approvalTargets).toEqual([
      "effect-generate-lyria", "effect-generate-veo", "effect-publish-x", "effect-schedule-content",
    ]);
  });

  it("defines all required explorer presets", () => {
    expect(architectureDefinition.presets.map((preset) => preset.id)).toEqual([
      "overview", "agents", "workflow", "effect-safety", "state", "apis", "observability",
    ]);
  });
});
