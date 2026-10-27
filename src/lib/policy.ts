import type { ActionType, PlannedAction } from "./types";

export interface PolicyDecision {
  risk: "low" | "medium" | "high";
  requiresApproval: boolean;
  reason: string;
}

export const PLATFORM_LIMITS: Record<string, number> = {
  x: 280,
};

export function validateDraftText(platform: string, text: string): { valid: boolean; note: string } {
  const limit = PLATFORM_LIMITS[platform];
  if (!limit) return { valid: false, note: `unsupported platform '${platform}'` };
  if (text.length > limit)
    return { valid: false, note: `${text.length} chars exceeds ${platform} limit of ${limit}` };
  return { valid: true, note: `${text.length}/${limit} chars` };
}

/**
 * Deterministic action-risk policy. Publishing to a live social account is
 * always approval-gated; exporting a content pack is additive and safe.
 */
export function evaluateActionPolicy(
  type: ActionType,
  payload: Record<string, unknown>,
): PolicyDecision {
  switch (type) {
    case "export_content_artifact":
      if (payload.outputType === "content_pack" || payload.outputType === "editorial_calendar") {
        return { risk: "medium", requiresApproval: true, reason: `exports the operator-facing ${String(payload.outputType).replaceAll("_", " ")} after review` };
      }
      return { risk: "low", requiresApproval: false, reason: "writes an internal content artifact and verifies stored bytes; nothing is published" };
    case "publish_x_post": {
      const text = typeof payload.text === "string" ? payload.text : "";
      const check = validateDraftText("x", text);
      return {
        risk: check.valid ? "high" : "high",
        requiresApproval: true,
        reason: check.valid
          ? `posts live content to X (${check.note})`
          : `blocked: draft invalid for X — ${check.note}`,
      };
    }
    case "publish_x_thread":
      return { risk: "high", requiresApproval: true, reason: "publishes an ordered thread to X" };
    case "publish_linkedin_post":
      return {
        risk: "high",
        requiresApproval: true,
        reason: "posts live content to LinkedIn",
      };
    case "generate_image":
      return {
        risk: "medium",
        requiresApproval: true,
        reason: "incurs paid Muse Image generation; output remains internal until separately published",
      };
    case "generate_video":
    case "generate_music":
      return {
        risk: "medium",
        requiresApproval: true,
        reason: "incurs paid generative media usage; output remains internal until separately published",
      };
    case "render_clip":
    case "render_reel":
      return {
        risk: "low",
        requiresApproval: true,
        reason: "renders the reviewed video selection with ffmpeg after approval; nothing is published",
      };
  }
}

export type ActionSeed = Pick<
  PlannedAction,
  "id" | "jobId" | "type" | "title" | "description" | "payload" | "momentId" | "angleId"
>;

export function applyPolicy(actions: ActionSeed[]): PlannedAction[] {
  return actions.map((a) => {
    const decision = evaluateActionPolicy(a.type, a.payload);
    return {
      ...a,
      risk: decision.risk,
      requiresApproval: decision.requiresApproval,
      approvalState: decision.requiresApproval ? ("pending" as const) : ("not_required" as const),
      state: "planned" as const,
    };
  });
}

export function hasPendingApprovals(actions: PlannedAction[]): boolean {
  return actions.some((a) => a.approvalState === "pending");
}

export function approvedPendingExecution(actions: PlannedAction[]): PlannedAction[] {
  return actions.filter(
    (a) =>
      a.state === "planned" &&
      (!a.requiresApproval || a.approvalState === "approved") &&
      !(a.type === "publish_x_post" &&
        typeof (a.payload as { text?: unknown }).text === "string" &&
        !validateDraftText("x", String((a.payload as { text: unknown }).text)).valid),
  );
}
