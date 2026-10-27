import { z } from "zod";
import { outputKindSchema } from "../contracts";

const refs = z.array(z.string().min(3)).min(1).max(100);
const section = z.object({ id: z.string().min(1), heading: z.string().min(1), body: z.string().min(1), sourceSegmentRefs: refs }).strict();
const orderedUnique = <T extends z.ZodTypeAny>(schema: T, key: string) => z.array(schema).min(1).superRefine((values, context) => {
  const seen = new Set<string>();
  values.forEach((value, index) => { const id = String((value as Record<string, unknown>)[key]); if (seen.has(id)) context.addIssue({ code: "custom", path: [index, key], message: `${key} must be unique` }); seen.add(id); });
});

export const contentArtifactPayloadSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("x_post"), text: z.string().min(1).max(280) }).strict(),
  z.object({ kind: z.literal("x_thread"), posts: orderedUnique(z.object({ id: z.string().min(1), text: z.string().min(1).max(280), sourceSegmentRefs: refs }).strict(), "id").min(2).max(25) }).strict(),
  z.object({ kind: z.literal("linkedin_post"), body: z.string().min(1).max(3000), title: z.string().min(1).max(200).optional(), cta: z.string().min(1).max(500).optional() }).strict(),
  z.object({ kind: z.literal("blog_article"), headline: z.string().min(1), dek: z.string().min(1), sections: orderedUnique(section, "id"), conclusion: z.string().min(1), cta: z.string().min(1), citations: refs }).strict(),
  z.object({ kind: z.literal("newsletter"), subject: z.string().min(1).max(200), preheader: z.string().min(1).max(300), introduction: z.string().min(1), sections: orderedUnique(section, "id"), cta: z.string().min(1), signOff: z.string().min(1).optional() }).strict(),
  z.object({ kind: z.literal("caption"), platformIntent: z.string().min(1), text: z.string().min(1), cta: z.string().min(1).optional(), hashtags: z.array(z.string().regex(/^#[\p{L}\p{N}_]+$/u)).max(30) }).strict(),
  z.object({ kind: z.literal("carousel_spec"), title: z.string().min(1), slides: orderedUnique(z.object({ id: z.string().min(1), headline: z.string().min(1), body: z.string().min(1), sourceSegmentRefs: refs, role: z.enum(["opening", "content", "cta"]) }).strict(), "id").min(2).max(20) }).strict(),
  z.object({ kind: z.literal("quote_card"), quote: z.string().min(1), attribution: z.string().min(1), sourceSegmentRef: z.string().min(3), renderBrief: z.string().min(1) }).strict(),
  z.object({ kind: z.literal("diagram"), diagramType: z.enum(["flow", "comparison", "timeline", "hierarchy"]), nodes: orderedUnique(z.object({ id: z.string().min(1), label: z.string().min(1), sourceSegmentRefs: refs }).strict(), "id"), edges: z.array(z.object({ from: z.string().min(1), to: z.string().min(1), label: z.string().min(1).optional(), sourceSegmentRefs: refs }).strict()).max(100), renderBrief: z.string().min(1) }).strict(),
  z.object({ kind: z.literal("editorial_calendar"), entries: orderedUnique(z.object({ id: z.string().min(1), artifactId: z.string().min(1), channel: z.string().min(1), intendedAt: z.string().datetime(), purpose: z.string().min(1), dependencyArtifactIds: z.array(z.string().min(1)).max(20) }).strict(), "id") }).strict(),
  z.object({ kind: z.literal("content_pack"), artifacts: orderedUnique(z.object({ artifactId: z.string().min(1), digest: z.string().regex(/^[0-9a-f]{64}$/) }).strict(), "artifactId") }).strict(),
]);

export const contentArtifactSchema = z.object({
  id: z.string().min(1), jobId: z.string().min(1), outputPlanId: z.string().min(1), outputPlanDigest: z.string().regex(/^[0-9a-f]{64}$/),
  outputType: outputKindSchema, revision: z.number().int().positive(), title: z.string().min(1).max(300), sourceSegmentRefs: refs,
  producer: z.object({ role: z.string().min(1), model: z.string().min(1), traceId: z.string().regex(/^[0-9a-f]{32}$/) }).strict(),
  review: z.object({ role: z.string().min(1), traceId: z.string().regex(/^[0-9a-f]{32}$/), decision: z.literal("accept") }).strict(),
  mimeType: z.enum(["text/markdown", "application/json"]), createdAt: z.string().datetime(), payload: contentArtifactPayloadSchema,
  contentDigest: z.string().regex(/^[0-9a-f]{64}$/),
}).strict().superRefine((artifact, context) => {
  if (artifact.outputType !== artifact.payload.kind) context.addIssue({ code: "custom", path: ["payload", "kind"], message: "payload kind must match output type" });
  if (artifact.payload.kind === "content_pack" && artifact.payload.artifacts.some((item) => item.digest === "0".repeat(64))) context.addIssue({ code: "custom", path: ["payload", "artifacts"], message: "sealed content-pack digests cannot retain host-seal markers" });
});

export type ContentArtifact = z.infer<typeof contentArtifactSchema>;
export type ContentArtifactPayload = z.infer<typeof contentArtifactPayloadSchema>;
