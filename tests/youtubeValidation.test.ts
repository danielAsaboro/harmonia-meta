import { describe, expect, it } from "vitest";

import { CURRENT_YOUTUBE_RULES, validateYouTubeUpload } from "@/lib/publishing/youtubeValidation";

const media = {
  artifactId: "asset-1",
  sha256: "a".repeat(64),
  mimeType: "video/mp4" as const,
  sizeBytes: 1024,
  durationMs: 179_000,
  width: 1080,
  height: 1920,
};

const payload = {
  provider: "youtube" as const,
  connectionId: "conn-1",
  credentialRevision: 1,
  destination: { kind: "youtube_channel" as const, id: "channel-1" },
  mode: "short" as const,
  title: "Launch",
  text: "Description",
  media: [media],
  privacy: "unlisted" as const,
  tags: ["startup", "launch day"],
};

describe("YouTube upload validation", () => {
  it("accepts a vertical MP4 Short up to three minutes", () => {
    expect(validateYouTubeUpload(payload, CURRENT_YOUTUBE_RULES)).toEqual(expect.objectContaining({
      kind: "short",
      durationMs: 179_000,
      width: 1080,
      height: 1920,
    }));
  });

  it("rejects a long, landscape, or metadata-only Short", () => {
    expect(() => validateYouTubeUpload({ ...payload, media: [{ ...media, durationMs: 180_001 }] }, CURRENT_YOUTUBE_RULES))
      .toThrow("Short duration exceeds");
    expect(() => validateYouTubeUpload({ ...payload, media: [{ ...media, width: 1920, height: 1080 }] }, CURRENT_YOUTUBE_RULES))
      .toThrow("Short must be square or vertical");
    expect(() => validateYouTubeUpload({ ...payload, media: [{ ...media, durationMs: undefined, width: undefined }] }, CURRENT_YOUTUBE_RULES))
      .toThrow("Short requires measured duration, width, and height");
  });

  it("enforces title, description byte, tag, privacy, and MP4 boundaries", () => {
    expect(() => validateYouTubeUpload({ ...payload, title: "x".repeat(101) }, CURRENT_YOUTUBE_RULES)).toThrow("title");
    expect(() => validateYouTubeUpload({ ...payload, text: "é".repeat(2501) }, CURRENT_YOUTUBE_RULES)).toThrow("description");
    expect(() => validateYouTubeUpload({ ...payload, tags: ["x".repeat(501)] }, CURRENT_YOUTUBE_RULES)).toThrow("tags");
    expect(() => validateYouTubeUpload({ ...payload, privacy: "friends" }, CURRENT_YOUTUBE_RULES)).toThrow("privacy");
    expect(() => validateYouTubeUpload({ ...payload, media: [{ ...media, mimeType: "image/png" }] }, CURRENT_YOUTUBE_RULES)).toThrow("MP4");
  });
});
