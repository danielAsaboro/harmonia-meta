import { z } from "zod";
import { outputKindSchema } from "../contracts";
import { canonicalJson } from "../recordReplay/integrity";
import { contentArtifactPayloadSchema } from "./contracts";

export const contentArtifactDraftSchema = z.object({
  id: z.string().min(1), outputPlanItemId: z.string().min(1), outputType: outputKindSchema,
  title: z.string().min(1).max(300), sourceSegmentRefs: z.array(z.string().min(3)).min(1).max(100), payload: contentArtifactPayloadSchema,
}).strict().superRefine((value, context) => {
  if (value.outputType !== value.payload.kind) context.addIssue({ code: "custom", path: ["payload", "kind"], message: "payload kind must match output type" });
  if (value.payload.kind === "content_pack" && value.payload.artifacts.some((item) => item.digest !== "0".repeat(64))) context.addIssue({ code: "custom", path: ["payload", "artifacts"], message: "draft content-pack digests must use the host-seal marker" });
});

const batchSchema = z.object({ artifacts: z.array(contentArtifactDraftSchema).min(1).max(30) }).strict();
const checkKind = z.enum(["grounding", "brief", "brand", "format", "cta", "safety", "clarity"]);
const reviewSchema = z.object({ artifactId: z.string().min(1), decision: z.enum(["accept", "revise"]), checks: z.array(z.object({ kind: checkKind, passed: z.boolean(), note: z.string().min(1).max(600) }).strict()).length(7), issues: z.array(z.object({ id: z.string().min(1), check: checkKind, instruction: z.string().min(1).max(600) }).strict()).max(20) }).strict();
const reviewBatchSchema = z.object({ reviews: z.array(reviewSchema).min(1).max(30) }).strict();

const resultSchema = z.object({ original: batchSchema, firstReview: reviewBatchSchema, revision: batchSchema.nullable(), finalReview: reviewBatchSchema.nullable(), accepted: batchSchema }).strict().superRefine((value, context) => {
  const acceptedOriginal = value.firstReview.reviews.every((review) => review.decision === "accept");
  const expected = acceptedOriginal ? value.original : value.revision;
  if (!expected || canonicalJson(expected) !== canonicalJson(value.accepted)) context.addIssue({ code: "custom", path: ["accepted"], message: "accepted artifacts must equal the accepted reviewed batch" });
  if (value.firstReview.reviews.map((review) => review.artifactId).join("\0") !== value.original.artifacts.map((artifact) => artifact.id).join("\0")) context.addIssue({ code: "custom", path: ["firstReview"], message: "review coverage must match original artifacts" });
  if (!acceptedOriginal && (!value.revision || !value.finalReview || !value.finalReview.reviews.every((review) => review.decision === "accept"))) context.addIssue({ code: "custom", path: ["finalReview"], message: "one accepted revision review is required" });
});

export const artifactProductionSubmissionSchema = z.object({
  jobId: z.string().min(1), stage: z.literal("draft"), operation: z.literal("complete"),
  producerModel: z.string().min(1).max(200),
  editorialPlanId: z.string().min(1), editorialPlanDigest: z.string().regex(/^[0-9a-f]{64}$/), editorialItemId: z.string().min(1), briefId: z.string().min(1), result: resultSchema,
}).strict();

export type ContentArtifactDraft = z.infer<typeof contentArtifactDraftSchema>;
export type ArtifactProductionResult = z.infer<typeof resultSchema>;
