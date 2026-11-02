import { describe, expect, it } from "vitest";

import { assertPublishAuthorization, publishApprovalDigest } from "@/lib/publishing/approval";
import type { PublishPayload } from "@/lib/publishing/contracts";

const payload: PublishPayload = {
  provider: "youtube",
  connectionId: "connection-1",
  credentialRevision: 2,
  destination: { kind: "youtube_channel", id: "channel-1" },
  mode: "short",
  text: "Launch",
  title: "Launch",
  media: [{ artifactId: "asset-1", sha256: "a".repeat(64), mimeType: "video/mp4", sizeBytes: 100 }],
  privacy: "unlisted",
};

describe("publishing approval binding", () => {
  it("accepts the exact approved payload", () => {
    expect(() => assertPublishAuthorization(payload, publishApprovalDigest(payload))).not.toThrow();
  });

  it.each([
    ["credential revision", { ...payload, credentialRevision: 3 }],
    ["destination", { ...payload, destination: { kind: "youtube_channel" as const, id: "channel-2" } }],
    ["privacy", { ...payload, privacy: "public" as const }],
    ["media", { ...payload, media: [{ ...payload.media[0], sha256: "b".repeat(64) }] }],
  ])("invalidates approval after changing %s", (_field, changed) => {
    expect(() => assertPublishAuthorization(changed, publishApprovalDigest(payload))).toThrow("approval payload digest mismatch");
  });
});
