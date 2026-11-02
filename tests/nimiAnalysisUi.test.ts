import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { JobFull } from "@/components/jobTypes";
import { SourcesWorkspace } from "@/components/studio/SourcesWorkspace";

describe("Nimi persisted analysis UI", () => {
  it("renders source and analysis digests, grounding, assumptions, and confidence", () => {
    const job = {
      id: "job-1", status: "running", stage: "strategize",
      createdAt: "2026-08-27T00:00:00Z", updatedAt: "2026-08-27T00:01:00Z",
      config: { sourceManifestId: "manifest-1", desiredOutputs: ["x_post"], allowedOutputs: ["x_post"], platforms: ["x"] }, actions: [],
      normalizedSources: [{ sourceId: "source-1", sourceKind: "video", title: "Interview", mimeType: "video/mp4", contentDigest: "c".repeat(64), extractorVersion: "media-v1", extractedAt: "2026-08-27T00:00:00Z", extractionReceiptId: "receipt-1", metadata: {}, segments: [{ id: "segment-1", text: "We cut nine days to forty hours.", digest: "d".repeat(64), locator: { kind: "time_range", startMs: 2000, endMs: 8000 } }] }],
      analysisDigest: "b".repeat(64),
      analysisResearchRequest: { id: "analysis-research-market", question: "What current public context qualifies this source?", justification: "Current context was explicitly requested." },
      analysisSearchEvidence: [{ evidenceId: "analysis-search-source-1", title: "Primary source", url: "https://example.com/source", supportedText: "Current context qualifies the source." }],
      sourceAnalysis: {
        sourceDigest: "a".repeat(64), summary: "A grounded activation result.", confidence: "medium",
        assumptions: ["The result applies only to the described workflow."],
        moments: [{ id: "moment-1", title: "Activation compression", startSec: 2, endSec: 8,
          hook: "Nine days became forty hours", quote: "We cut nine days to forty hours.",
          sourceSegmentRefs: ["segment-1"], visualHook: "Founder shows the chart",
          cropSuitability: "good", captionSafeRegion: "lower third", visualEvidenceIds: ["frame-1"],
          assumptions: [], confidence: "high" }],
        angles: [{ id: "angle-1", angleType: "memory_learning", evidenceKind: "memory", title: "Concise proof", rationale: "Use eligible prior learning.",
          evidenceRefs: ["memory-1"], assumptions: ["Preference remains applicable."], confidence: "medium" }],
      },
    } as JobFull;
    const html = renderToStaticMarkup(createElement(SourcesWorkspace, { job, receipts: [] }));
    for (const value of ["Nimi source analysis", "A grounded activation result", "segment-1", "frame-1",
      "memory-1", "medium", "The result applies only", "Preference remains applicable", "a".repeat(64), "b".repeat(64),
      "Web research", "analysis-search-source-1", "Primary source", "Current context qualifies"]) {
      expect(html).toContain(value);
    }
  });
});
