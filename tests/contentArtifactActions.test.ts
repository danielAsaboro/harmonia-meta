import { describe, expect, it } from "vitest";
import { deriveArtifactActions } from "@/lib/contentArtifacts/actions";
import { sealContentArtifact } from "@/lib/contentArtifacts/digest";
import type { ContentArtifact } from "@/lib/contentArtifacts/contracts";

function artifact(outputType: "x_post" | "linkedin_post", payload: ContentArtifact["payload"]) {
  return sealContentArtifact({ id: `artifact-${outputType}`, jobId: "job-1", outputPlanId: "plan-1", outputPlanDigest: "a".repeat(64), outputType, revision: 1, title: "Launch", sourceSegmentRefs: ["source-1:seg-1"], producer: { role: "noni_artifact_producer", model: "gemini-3.5-flash", traceId: "b".repeat(32) }, review: { role: "dara_artifact_editor", traceId: "c".repeat(32), decision: "accept" }, mimeType: "text/markdown", createdAt: "2026-08-30T00:00:00.000Z", payload } as Omit<ContentArtifact, "contentDigest">);
}

describe("artifact action derivation", () => {
  it("exports every accepted artifact and proposes only connected publishers", () => {
    const actions = deriveArtifactActions([artifact("x_post", { kind: "x_post", text: "Launch" }), artifact("linkedin_post", { kind: "linkedin_post", body: "Launch" })], { x: true, linkedinDestination: null });
    expect(actions.filter((item) => item.type === "export_content_artifact")).toHaveLength(2);
    expect(actions.some((item) => item.type === "publish_x_post")).toBe(true);
    expect(actions.some((item) => item.type === "publish_linkedin_post")).toBe(false);
  });

  it("binds LinkedIn publication to the exact connected destination", () => {
    const actions = deriveArtifactActions([artifact("linkedin_post", { kind: "linkedin_post", body: "Launch" })], { x: false, linkedinDestination: { kind: "linkedin_organization", id: "org-7" } });
    expect(actions.find((item) => item.type === "publish_linkedin_post")?.payload).toEqual({ type: "publish_linkedin_post", artifactId: "artifact-linkedin_post", artifactDigest: expect.any(String), body: "Launch", destination: { kind: "linkedin_organization", id: "org-7" } });
  });
});
