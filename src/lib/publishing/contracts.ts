import { z } from "zod";

export const socialProviderSchema = z.enum(["x", "linkedin", "instagram", "youtube"]);
export type SocialProvider = z.infer<typeof socialProviderSchema>;

export const publishDestinationSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("linkedin_member"), id: z.string().min(1) }).strict(),
  z.object({ kind: z.literal("linkedin_organization"), id: z.string().min(1) }).strict(),
  z.object({
    kind: z.literal("instagram_professional"),
    id: z.string().min(1),
    pageId: z.string().min(1),
  }).strict(),
  z.object({ kind: z.literal("youtube_channel"), id: z.string().min(1) }).strict(),
]);
export type PublishDestination = z.infer<typeof publishDestinationSchema>;

export const publishMediaSchema = z.object({
  artifactId: z.string().min(1),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  mimeType: z.enum(["image/jpeg", "image/png", "video/mp4"]),
  sizeBytes: z.number().int().positive(),
  durationMs: z.number().int().positive().optional(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
}).strict();
export type PublishMedia = z.infer<typeof publishMediaSchema>;

const base = {
  connectionId: z.string().min(1),
  credentialRevision: z.number().int().positive(),
  text: z.string().max(10_000).default(""),
};

const linkedInPayloadSchema = z.object({
  ...base,
  provider: z.literal("linkedin"),
  destination: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("linkedin_member"), id: z.string().min(1) }).strict(),
    z.object({ kind: z.literal("linkedin_organization"), id: z.string().min(1) }).strict(),
  ]),
  mode: z.enum(["text", "image", "video"]),
  media: z.array(publishMediaSchema).max(1),
}).strict().superRefine((payload, context) => {
  const expected = payload.mode === "text" ? 0 : 1;
  if (payload.media.length !== expected) {
    context.addIssue({ code: "custom", path: ["media"], message: `${payload.mode} requires ${expected} media item${expected === 1 ? "" : "s"}` });
  }
  if (payload.mode === "image" && payload.media[0]?.mimeType === "video/mp4") {
    context.addIssue({ code: "custom", path: ["media", 0, "mimeType"], message: "LinkedIn image mode requires an image" });
  }
  if (payload.mode === "video" && payload.media[0]?.mimeType !== "video/mp4") {
    context.addIssue({ code: "custom", path: ["media", 0, "mimeType"], message: "LinkedIn video mode requires video/mp4" });
  }
});

const instagramPayloadSchema = z.object({
  ...base,
  provider: z.literal("instagram"),
  destination: z.object({
    kind: z.literal("instagram_professional"),
    id: z.string().min(1),
    pageId: z.string().min(1),
  }).strict(),
  mode: z.enum(["image", "carousel", "reel"]),
  media: z.array(publishMediaSchema).min(1).max(10),
}).strict().superRefine((payload, context) => {
  if (payload.mode !== "carousel" && payload.media.length !== 1) {
    context.addIssue({ code: "custom", path: ["media"], message: `${payload.mode} requires exactly one media item` });
  }
  if (payload.mode === "carousel" && payload.media.length < 2) {
    context.addIssue({ code: "custom", path: ["media"], message: "carousel requires at least two media items" });
  }
  if (payload.mode === "image" && payload.media[0]?.mimeType === "video/mp4") {
    context.addIssue({ code: "custom", path: ["media", 0, "mimeType"], message: "Instagram image mode requires an image" });
  }
  if (payload.mode === "reel" && payload.media[0]?.mimeType !== "video/mp4") {
    context.addIssue({ code: "custom", path: ["media", 0, "mimeType"], message: "Instagram Reel mode requires video/mp4" });
  }
});

const youtubePayloadSchema = z.object({
  ...base,
  provider: z.literal("youtube"),
  destination: z.object({ kind: z.literal("youtube_channel"), id: z.string().min(1) }).strict(),
  mode: z.enum(["video", "short"]),
  title: z.string().min(1).max(100),
  media: z.array(publishMediaSchema).length(1),
  privacy: z.enum(["private", "unlisted", "public"]),
  tags: z.array(z.string().min(1)).max(100).optional(),
}).strict().superRefine((payload, context) => {
  if (payload.media[0]?.mimeType !== "video/mp4") {
    context.addIssue({ code: "custom", path: ["media", 0, "mimeType"], message: "YouTube uploads require video/mp4" });
  }
});

export const publishPayloadSchema = z.union([
  linkedInPayloadSchema,
  instagramPayloadSchema,
  youtubePayloadSchema,
]);
export type PublishPayload = z.infer<typeof publishPayloadSchema>;
