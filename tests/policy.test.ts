import { describe, expect, it } from "vitest";
import { applyPolicy, approvedPendingExecution, evaluateActionPolicy, validateDraftText } from "@/lib/policy";
import { OUTPUT_CAPABILITIES } from "@/lib/outputCapabilities";

describe("evaluateActionPolicy", () => {
  it.each(["render_clip", "render_reel"] as const)("requires approval before %s rendering", (type) => {
    const actions = applyPolicy([{ id: "clip-1", jobId: "j1", type, title: "Clip", description: "", payload: {} }]);
    expect(actions[0].approvalState).toBe("pending");
    expect(approvedPendingExecution(actions)).toEqual([]);
    expect(OUTPUT_CAPABILITIES[type === "render_clip" ? "short_clip" : "reel"].approvalClass).toBe("effect");
  });
  it.each([
    ["publish_linkedin_post", "LinkedIn"],
  ] as const)("requires approval for %s", (type, provider) => {
    expect(evaluateActionPolicy(type, {})).toEqual({
      risk: "high",
      requiresApproval: true,
      reason: `posts live content to ${provider}`,
    });
  });

  it("always gates X publishing behind approval", () => {
    const d = evaluateActionPolicy("publish_x_post", { text: "hello" });
    expect(d.requiresApproval).toBe(true);
    expect(d.risk).toBe("high");
  });

  it("blocks over-limit drafts from executing", () => {
    const d = evaluateActionPolicy("publish_x_post", { text: "x".repeat(300) });
    expect(d.reason).toContain("blocked");
    const actions = applyPolicy([{ id: "1", jobId: "j", type: "publish_x_post", title: "t", description: "", payload: { type: "publish_x_post", text: "x".repeat(300) } }]);
    expect(approvedPendingExecution(actions)).toHaveLength(0);
  });

  it("gates operator-facing pack and calendar exports while allowing an internal draft export", () => {
    for (const outputType of ["content_pack", "editorial_calendar"]) {
      const decision = evaluateActionPolicy("export_content_artifact", { outputType });
      expect(decision.risk).toBe("medium");
      expect(decision.requiresApproval).toBe(true);
    }
    expect(evaluateActionPolicy("export_content_artifact", { outputType: "linkedin_post" }).requiresApproval).toBe(false);
  });

  it("gates Muse Image generation because it consumes paid model capacity", () => {
    const decision = evaluateActionPolicy("generate_image", { prompt: "launch energy" });
    expect(decision).toEqual({
      risk: "medium",
      requiresApproval: true,
      reason: "incurs paid Muse Image generation; output remains internal until separately published",
    });
  });
});

describe("validateDraftText", () => {
  it("enforces the 280-char X limit", () => {
    expect(validateDraftText("x", "y".repeat(281)).valid).toBe(false);
    expect(validateDraftText("x", "y".repeat(280)).valid).toBe(true);
    expect(validateDraftText("tiktok", "hi").valid).toBe(false);
  });
});
