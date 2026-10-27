export interface YouTubeRuleSet {
  version: string;
  shortMaxDurationMs: number;
  maxTitleChars: number;
  maxDescriptionBytes: number;
  maxTagChars: number;
}

export const CURRENT_YOUTUBE_RULES: YouTubeRuleSet = Object.freeze({
  version: "youtube-2026-07-08",
  shortMaxDurationMs: 180_000,
  maxTitleChars: 100,
  maxDescriptionBytes: 5_000,
  maxTagChars: 500,
});

export interface YouTubeUploadSpec {
  kind: "video" | "short";
  title: string;
  description: string;
  privacy: "private" | "unlisted" | "public";
  tags: string[];
  artifactId: string;
  sha256: string;
  sizeBytes: number;
  durationMs?: number;
  width?: number;
  height?: number;
  ruleVersion: string;
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} is invalid`);
  return value as Record<string, unknown>;
}

function tagLength(tags: readonly string[]): number {
  return tags.reduce((total, tag, index) => total + (index ? 1 : 0) + tag.length + (tag.includes(" ") ? 2 : 0), 0);
}

export function validateYouTubeUpload(payload: unknown, rules: YouTubeRuleSet): YouTubeUploadSpec {
  const input = record(payload, "YouTube upload");
  if (input.provider !== "youtube") throw new Error("YouTube provider is required");
  const mode = input.mode;
  if (mode !== "video" && mode !== "short") throw new Error("YouTube mode is invalid");
  if (typeof input.title !== "string" || !input.title || input.title.length > rules.maxTitleChars || /[<>]/.test(input.title)) {
    throw new Error(`YouTube title must contain 1-${rules.maxTitleChars} supported characters`);
  }
  const description = typeof input.text === "string" ? input.text : "";
  if (Buffer.byteLength(description, "utf8") > rules.maxDescriptionBytes || /[<>]/.test(description)) {
    throw new Error(`YouTube description exceeds ${rules.maxDescriptionBytes} bytes or contains unsupported characters`);
  }
  if (input.privacy !== "private" && input.privacy !== "unlisted" && input.privacy !== "public") {
    throw new Error("YouTube privacy must be private, unlisted, or public");
  }
  const tags = input.tags === undefined ? [] : input.tags;
  if (!Array.isArray(tags) || tags.some((tag) => typeof tag !== "string" || !tag) || tagLength(tags as string[]) > rules.maxTagChars) {
    throw new Error(`YouTube tags exceed ${rules.maxTagChars} characters or contain an empty tag`);
  }
  if (!Array.isArray(input.media) || input.media.length !== 1) throw new Error("YouTube upload requires exactly one MP4");
  const media = record(input.media[0], "YouTube media");
  if (media.mimeType !== "video/mp4") throw new Error("YouTube upload requires MP4 media");
  if (typeof media.artifactId !== "string" || !media.artifactId || typeof media.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(media.sha256)) {
    throw new Error("YouTube media identity is invalid");
  }
  if (typeof media.sizeBytes !== "number" || !Number.isSafeInteger(media.sizeBytes) || media.sizeBytes <= 0) {
    throw new Error("YouTube media size is invalid");
  }

  const durationMs = typeof media.durationMs === "number" ? media.durationMs : undefined;
  const width = typeof media.width === "number" ? media.width : undefined;
  const height = typeof media.height === "number" ? media.height : undefined;
  if (mode === "short") {
    if (!durationMs || !width || !height) throw new Error("Short requires measured duration, width, and height");
    if (durationMs > rules.shortMaxDurationMs) throw new Error(`Short duration exceeds ${rules.shortMaxDurationMs}ms`);
    if (width > height) throw new Error("Short must be square or vertical");
  }

  return {
    kind: mode,
    title: input.title,
    description,
    privacy: input.privacy,
    tags: [...tags as string[]],
    artifactId: media.artifactId,
    sha256: media.sha256,
    sizeBytes: media.sizeBytes,
    ...(durationMs ? { durationMs } : {}),
    ...(width ? { width } : {}),
    ...(height ? { height } : {}),
    ruleVersion: rules.version,
  };
}
