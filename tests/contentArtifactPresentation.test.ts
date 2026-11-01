import { describe, expect, it } from "vitest";

import { contentArtifactPreview } from "@/lib/contentArtifacts/presentation";
import type { ContentArtifact } from "@/lib/contentArtifacts/contracts";

function artifact(payload: ContentArtifact["payload"]): ContentArtifact {
  return { id: "a1", jobId: "j1", outputPlanId: "p1", outputPlanDigest: "a".repeat(64), outputType: payload.kind, revision: 2, title: "Launch", sourceSegmentRefs: ["s:1"], producer: { role: "noni", model: "gemini-3.5-flash", traceId: "b".repeat(32) }, review: { role: "dara", traceId: "c".repeat(32), decision: "accept" }, mimeType: "text/markdown", createdAt: "2026-08-30T00:00:00.000Z", payload, contentDigest: "d".repeat(64) };
}

describe("content artifact presentation", () => {
  it("renders native ordered thread and carousel previews", () => {
    expect(contentArtifactPreview(artifact({ kind: "x_thread", posts: [{ id: "p1", text: "One", sourceSegmentRefs: ["s:1"] }, { id: "p2", text: "Two", sourceSegmentRefs: ["s:1"] }] }))).toBe("1. One\n\n2. Two");
    expect(contentArtifactPreview(artifact({ kind: "carousel_spec", title: "Deck", slides: [{ id: "s1", headline: "Start", body: "Body", sourceSegmentRefs: ["s:1"], role: "opening" }, { id: "s2", headline: "Act", body: "CTA", sourceSegmentRefs: ["s:1"], role: "cta" }] }))).toContain("Slide 2 — Act");
  });

  it("shows manifest identities rather than duplicating content-pack prose", () => {
    expect(contentArtifactPreview(artifact({ kind: "content_pack", artifacts: [{ artifactId: "child-1", digest: "e".repeat(64) }] }))).toBe(`child-1 · ${"e".repeat(64)}`);
  });
});
