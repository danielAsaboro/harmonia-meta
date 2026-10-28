import { createHash } from "node:crypto";
import { z } from "zod";

export const nudgeScopeSchema = z.enum(["current_stage", "remaining_job", "content_item"]);
const protectedAuthority = /(?:ignore|bypass|skip|disable|override).{0,40}(?:approval|policy|security|rights|budget|tenant|provenance)|publish\s+(?:automatically|without approval)/i;
export const jobNudgeSchema = z.object({ id: z.string().min(1), jobId: z.string().min(1), expectedControlEpoch: z.number().int().nonnegative(), scope: nudgeScopeSchema, contentItemId: z.string().min(1).optional(), instruction: z.string().min(3).max(2000), proposedBySubjectId: z.string().min(1), proposedAt: z.string().datetime({ offset: true }) }).strict().superRefine((value, context) => { if (value.scope === "content_item" && !value.contentItemId) context.addIssue({ code: "custom", path: ["contentItemId"], message: "content item scope requires an item" }); if (protectedAuthority.test(value.instruction)) context.addIssue({ code: "custom", path: ["instruction"], message: "nudge cannot claim protected authority" }); });
export const steeringCommandSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("pause"), jobId: z.string().min(1), expectedControlEpoch: z.number().int().nonnegative() }).strict(),
  z.object({ kind: z.literal("cancel"), jobId: z.string().min(1), expectedControlEpoch: z.number().int().nonnegative(), confirmation: z.string().min(1) }).strict(),
  z.object({ kind: z.literal("redo"), jobId: z.string().min(1), expectedControlEpoch: z.number().int().nonnegative(), targetStage: z.string().min(1), confirmation: z.string().min(1) }).strict(),
]);
export type JobNudge = z.infer<typeof jobNudgeSchema>;
export interface NudgeImpact { jobId: string; nudgeId: string; invalidatedStages: string[]; revokesApprovals: boolean; cancelsPendingEffects: boolean; preservesExecutedReceipts: true; digest: string }
export function impactDigest(impact: Omit<NudgeImpact, "digest">): string { return createHash("sha256").update(JSON.stringify(impact)).digest("hex"); }
