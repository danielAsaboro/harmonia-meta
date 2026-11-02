import { describe, expect, it } from "vitest";

import { publishPayloadSchema } from "@/lib/publishing/contracts";

const digest = "a".repeat(64);

describe("multiplatform publishing contracts", () => {
  it("accepts an explicitly targeted YouTube Short", () => {
    const parsed = publishPayloadSchema.parse({
      provider: "youtube",
      connectionId: "connection-1",
      credentialRevision: 2,
      destination: { kind: "youtube_channel", id: "channel-1" },
      mode: "short",
      text: "The launch in under a minute.",
      title: "Harmonia launch",
      media: [{
        artifactId: "asset-1",
        sha256: digest,
        mimeType: "video/mp4",
        sizeBytes: 1_024,
        durationMs: 45_000,
        width: 1_080,
        height: 1_920,
      }],
      privacy: "unlisted",
    });

    expect(parsed.mode).toBe("short");
    expect(parsed.destination).toEqual({ kind: "youtube_channel", id: "channel-1" });
  });

  it("rejects an Instagram carousel without media", () => {
    expect(() => publishPayloadSchema.parse({
      provider: "instagram",
      connectionId: "connection-1",
      credentialRevision: 4,
      destination: { kind: "instagram_professional", id: "ig-1", pageId: "page-1" },
      mode: "carousel",
      text: "Launch",
      media: [],
    })).toThrow();
  });

  it("rejects a provider and destination mismatch", () => {
    expect(() => publishPayloadSchema.parse({
      provider: "linkedin",
      connectionId: "connection-1",
      credentialRevision: 1,
      destination: { kind: "youtube_channel", id: "channel-1" },
      mode: "text",
      text: "Launch",
      media: [],
    })).toThrow();
  });

  it("requires exactly one video for a regular YouTube upload", () => {
    expect(() => publishPayloadSchema.parse({
      provider: "youtube",
      connectionId: "connection-1",
      credentialRevision: 2,
      destination: { kind: "youtube_channel", id: "channel-1" },
      mode: "video",
      title: "Launch",
      text: "Launch recording",
      media: [],
      privacy: "private",
    })).toThrow();
  });
});
