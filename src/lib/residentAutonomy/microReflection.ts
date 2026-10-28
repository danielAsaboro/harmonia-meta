import { createHash } from "node:crypto";
import { z } from "zod";
import { evidenceProvenanceSchema, observationSchema, type Observation } from "./contracts";

const common = { workspaceId: z.string().min(1), brandId: z.string().min(1), sourceRecordId: z.string().min(1), observedAt: z.string().datetime({ offset: true }), provenance: evidenceProvenanceSchema, authorized: z.boolean(), verified: z.boolean() } as const;
const measured = { latencyMs: z.number().int().nonnegative(), costUsd: z.number().nonnegative() } as const;
export const microReflectionEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("job_completed"), ...common, ...measured, contentFormat: z.string().max(100).optional(), postingHour: z.number().int().min(0).max(23).optional() }).strict(),
  z.object({ type: z.literal("job_failed"), ...common, ...measured, failureCategory: z.string().min(1).max(100) }).strict(),
  z.object({ type: z.literal("verification_recorded"), ...common, ...measured, outcome: z.enum(["applied", "already_applied", "rejected", "failed"]) }).strict(),
  z.object({ type: z.literal("proposal_decided"), ...common, decision: z.enum(["approved", "rejected"]), contentFormat: z.string().min(1).max(100) }).strict(),
  z.object({ type: z.literal("engagement_measured"), ...common, measurementWindowClosed: z.boolean(), impressions: z.number().int().nonnegative(), engagements: z.number().int().nonnegative(), contentFormat: z.string().min(1).max(100), postingHour: z.number().int().min(0).max(23) }).strict(),
]);
export type MicroReflectionEvent = z.infer<typeof microReflectionEventSchema>;

function observationId(sourceRecordId: string, observationType: string): string { return createHash("sha256").update(`${sourceRecordId}\n${observationType}`, "utf8").digest("hex"); }
export function deriveEligibleObservations(input: unknown): Observation[] {
  const event = microReflectionEventSchema.parse(input);
  if (event.provenance !== "verified_live" || !event.authorized || !event.verified) return [];
  if (event.type === "engagement_measured" && !event.measurementWindowClosed) return [];
  let observationType: string; let facts: Record<string, string | number | boolean | null>;
  switch (event.type) {
    case "job_completed": observationType = "job_outcome"; facts = { outcome: "completed", latencyMs: event.latencyMs, costUsd: event.costUsd, ...(event.contentFormat ? { contentFormat: event.contentFormat } : {}), ...(event.postingHour !== undefined ? { postingHour: event.postingHour } : {}) }; break;
    case "job_failed": observationType = "job_failure"; facts = { failureCategory: event.failureCategory, latencyMs: event.latencyMs, costUsd: event.costUsd }; break;
    case "verification_recorded": observationType = "verified_effect"; facts = { outcome: event.outcome, latencyMs: event.latencyMs, costUsd: event.costUsd }; break;
    case "proposal_decided": observationType = "operator_decision"; facts = { decision: event.decision, contentFormat: event.contentFormat }; break;
    case "engagement_measured": observationType = "measured_engagement"; facts = { impressions: event.impressions, engagements: event.engagements, contentFormat: event.contentFormat, postingHour: event.postingHour }; break;
  }
  return [observationSchema.parse({ id: observationId(event.sourceRecordId, observationType), workspaceId: event.workspaceId, brandId: event.brandId, sourceRecordId: event.sourceRecordId, observationType, provenance: event.provenance, verified: event.verified, authorized: event.authorized, observedAt: event.observedAt, facts })];
}
