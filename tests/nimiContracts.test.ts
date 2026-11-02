import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { analysisSubmissionSchema, sourceAnalysisSchema } from "@/lib/contracts";
import { sourceAnalysisDigest } from "@/lib/sourceAnalysis";
import { validateAnalysisSearchGrounding } from "@/lib/analysisGrounding";

const analysis = () => ({
  sourceDigest: "a".repeat(64), summary: "Grounded source result.",
  moments: [{
    id: "moment-1", title: "Proof", startSec: 2, endSec: 8,
    hook: "Nine days became forty hours", quote: "We cut nine days to forty hours.",
    sourceSegmentRefs: ["segment-1"], visualEvidenceIds: [], assumptions: [], confidence: "high" as const,
  }],
  angles: [{
    id: "angle-1", angleType: "source_insight" as const, evidenceKind: "source" as const, title: "Time to value", rationale: "Use the measured result.",
    evidenceRefs: ["moment-1"], assumptions: [], confidence: "high" as const,
  }],
  assumptions: [], confidence: "high" as const,
});

describe("Nimi source analysis contracts", () => {
  it.each([18, 500])("preserves Python-authoritative evidence and digest for %i segments", (count) => {
    const value = analysis();
    value.moments[0].sourceSegmentRefs = Array.from({ length: count }, (_, i) => `source-1:segment-${i}`);
    value.angles[0].evidenceRefs = [...value.moments[0].sourceSegmentRefs, ...Array.from({ length: 12 }, (_, i) => `moment-${i}`)];
    const python = existsSync("agent/.venv/bin/python") ? "agent/.venv/bin/python" : "python";
    const serialized = JSON.parse(execFileSync(python, ["-c", `
import hashlib, json, sys
from harmonia_agent.agent_models import SourceAnalysis
from harmonia_agent.stages import _canonical_typed_bytes
value = SourceAnalysis.model_validate(json.load(sys.stdin)).model_dump(mode="json", exclude_none=True)
print(json.dumps({"analysis": value, "digest": hashlib.sha256(_canonical_typed_bytes(value).encode("utf-8")).hexdigest()}))
`], { input: JSON.stringify(value), encoding: "utf8", env: { ...process.env, PYTHONPATH: "agent" } }));
    const parsed = analysisSubmissionSchema.parse({
      jobId: "job-1", stage: "understand", analysis: serialized.analysis,
      analysisDigest: serialized.digest, modelUsed: "gemini-3.7-flash",
      researchRequest: null, searchEvidence: [], searchProvenance: null,
    });
    expect(parsed.analysis).toEqual(serialized.analysis);
    expect(sourceAnalysisDigest(parsed.analysis)).toBe(serialized.digest);
  });

  it("keeps complete host evidence bounded and rejects duplicates", () => {
    const value = analysis();
    value.moments[0].sourceSegmentRefs = Array.from({ length: 501 }, (_, i) => `segment-${i}`);
    expect(sourceAnalysisSchema.safeParse(value).success).toBe(false);
    value.moments[0].sourceSegmentRefs = ["segment-1"];
    value.angles[0].evidenceRefs = Array.from({ length: 513 }, (_, i) => `segment-${i}`);
    expect(sourceAnalysisSchema.safeParse(value).success).toBe(false);
    value.angles[0].evidenceRefs = ["segment-1", "segment-1"];
    expect(sourceAnalysisSchema.safeParse(value).success).toBe(false);
  });

  it("accepts one complete strict persisted analysis", () => {
    expect(sourceAnalysisSchema.safeParse(analysis()).success).toBe(true);
    expect(analysisSubmissionSchema.safeParse({
      jobId: "job-1", stage: "understand", analysis: analysis(),
      analysisDigest: "b".repeat(64), modelUsed: "gemini-3.5-flash",
      researchRequest: null, searchEvidence: [], searchProvenance: null,
    }).success).toBe(true);
  });

  it("matches the Python canonical SHA-256 analysis digest", () => {
    expect(sourceAnalysisDigest(analysis())).toBe("e2e036f55501fa2cede56190da6bfd1e21c414a1256f15237d7c120647525350");
  });

  it("rejects old projections, incomplete provenance, and duplicate ids", () => {
    expect(analysisSubmissionSchema.safeParse({
      jobId: "job-1", stage: "understand", summary: "legacy", moments: [], angles: [], modelUsed: "model",
    }).success).toBe(false);
    const missing = analysis();
    Reflect.deleteProperty(missing.moments[0], "sourceSegmentRefs");
    expect(sourceAnalysisSchema.safeParse(missing).success).toBe(false);
    const duplicate = analysis();
    duplicate.angles[0].id = "moment-1";
    expect(sourceAnalysisSchema.safeParse(duplicate).success).toBe(false);
  });

  it("rejects invalid ranges, implicit visuals, and confident assumptions", () => {
    const range = analysis(); range.moments[0].startSec = 9;
    expect(sourceAnalysisSchema.safeParse(range).success).toBe(false);
    const visual = analysis(); Object.assign(visual.moments[0], { visualHook: "A chart" });
    expect(sourceAnalysisSchema.safeParse(visual).success).toBe(false);
    const assumption = { ...analysis(), assumptions: ["Unverified audience response"] };
    expect(sourceAnalysisSchema.safeParse(assumption).success).toBe(false);
  });

  it("validates cited sources against Meta web search provenance", () => {
    const request = { id: "analysis-research-market", question: "What current public context qualifies this source claim?", justification: "The requested analysis needs current external context." };
    const evidence = [{ evidenceId: "analysis-search-source-1", supportedText: "Current context", title: "Primary source", url: "https://example.com/source" }];
    const provenance = {
      provider: "meta" as const, responseId: "resp_1", model: "muse-spark-1.3", searchCalls: 1,
      results: [{ url: "https://example.com/source", title: "Primary source", snippet: "Current context qualifies the claim." }],
      citations: [], inputTokens: 1200, outputTokens: 300,
    };
    expect(() => validateAnalysisSearchGrounding(request, evidence, provenance)).not.toThrow();
    expect(() => validateAnalysisSearchGrounding(request, evidence, { ...provenance, results: [] })).toThrow("absent from web search provenance");
    expect(() => validateAnalysisSearchGrounding(
      request, [{ ...evidence[0], supportedText: "Invented context" }], provenance,
    )).toThrow("absent from web search provenance");
    expect(() => validateAnalysisSearchGrounding(null, evidence, provenance)).toThrow("exact research request");
    expect(analysisSubmissionSchema.shape.searchProvenance.safeParse({ ...provenance, searchCalls: 0 }).success).toBe(false);
  });
});
