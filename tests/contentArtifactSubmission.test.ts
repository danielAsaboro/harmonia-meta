import { describe, expect, it } from "vitest";
import { artifactProductionSubmissionSchema } from "@/lib/contentArtifacts/submission";

const artifact = { id: "artifact-1", outputPlanItemId: "output-1-newsletter", outputType: "newsletter", title: "Launch", sourceSegmentRefs: ["source-1:seg-1"], payload: { kind: "newsletter", subject: "Launch", preheader: "Proof", introduction: "Intro", sections: [{ id: "s1", heading: "Proof", body: "Proof", sourceSegmentRefs: ["source-1:seg-1"] }], cta: "Try it" } };
const checks = ["grounding", "brief", "brand", "format", "cta", "safety", "clarity"].map((kind) => ({ kind, passed: true, note: "Pass" }));

describe("artifact production submission", () => {
  it("accepts an exact accepted batch bound to production lineage", () => {
    const parsed = artifactProductionSubmissionSchema.parse({ jobId: "job-1", producerModel: "gemini-3.7-flash", stage: "draft", operation: "complete", editorialPlanId: "editorial-1", editorialPlanDigest: "a".repeat(64), editorialItemId: "item-1", briefId: "brief-1", result: { original: { artifacts: [artifact] }, firstReview: { reviews: [{ artifactId: "artifact-1", decision: "accept", checks, issues: [] }] }, revision: null, finalReview: null, accepted: { artifacts: [artifact] } } });
    expect(parsed.result.accepted.artifacts[0].outputType).toBe("newsletter");
    expect(parsed.producerModel).toBe("gemini-3.7-flash");
    const { producerModel: _model, ...missingModel } = parsed;
    expect(artifactProductionSubmissionSchema.safeParse(missingModel).success).toBe(false);
  });

  it("rejects action authority and mismatched accepted artifacts", () => {
    const value: Record<string, unknown> = { jobId: "job-1", producerModel: "gemini-3.7-flash", stage: "draft", operation: "complete", editorialPlanId: "editorial-1", editorialPlanDigest: "a".repeat(64), editorialItemId: "item-1", briefId: "brief-1", result: { original: { artifacts: [artifact] }, firstReview: { reviews: [{ artifactId: "artifact-1", decision: "accept", checks, issues: [] }] }, revision: null, finalReview: null, accepted: { artifacts: [{ ...artifact, id: "invented" }] } }, proposedActions: [] };
    expect(artifactProductionSubmissionSchema.safeParse(value).success).toBe(false);
  });
});
