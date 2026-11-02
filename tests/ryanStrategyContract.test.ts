import { describe, expect, it } from "vitest";
import { contentStrategySchema } from "@/lib/contracts";
import { strategySourceEvidenceIds, validatePersistedStrategy, validateStrategySearchGrounding } from "@/lib/strategyApproval";

const refs = ["m1"];
const valid = {
  strategyId: "strategy-job-1-v1", version: 1, horizonWeeks: 4,
  thesis: "Lead with verified proof", differentiatedNarrative: "Evidence connects to governed execution",
  objectives: [{ text: "Increase qualified demos", evidenceRefs: ["context:campaign"] }],
  audiencePriorities: [{ audienceId: "aud-founders", priority: 1, reason: "They own the bottleneck", evidenceRefs: ["context:campaign"] }],
  funnelIntent: "consideration", intendedConversions: ["request a demo"],
  pillars: [{ name: "operational proof", purpose: "Show measurable gains", evidenceRefs: refs }],
  campaignThemes: [{ name: "Delay to flow", message: "Governance accelerates delivery", evidenceRefs: refs }],
  channelRoles: [{ channel: "x", role: "discovery", operationallySupported: true, formats: ["text_post"], cadence: "twice weekly", evidenceRefs: ["context:campaign"] }],
  contentMix: [{ format: "text_post", percentage: 100 }], cadenceGuidance: "Two items weekly",
  priorityRules: ["Prefer proof"], ctaGuidance: ["Invite a demo request"],
  kpis: [{ name: "demo requests", target: "measure weekly", measurement: "verified attribution", evidenceRefs: ["context:campaign"] }],
  successCriteria: ["One verified request"], constraints: ["Use supplied evidence"], exclusions: [], brandSafety: [],
  briefs: [{ id: "brief-1", title: "Nine days to forty hours", objective: "Show proof", audienceId: "aud-founders", funnelStage: "consideration", keyMessage: "Governed workflows reduce delay", channelCandidates: ["x"], formatCandidates: ["text_post"], ctaIntent: "request demo", intendedConversion: "qualified request", kpi: "demo requests", priority: 1, dependencies: [], constraints: ["Quote exactly"], evidenceRefs: refs }],
  assumptions: [], confidence: "high",
};

describe("Ryan strategy wire contract", () => {
  it("persists every source-backed evidence ID that Ryan may cite", () => {
    const analysis = {
      sourceDigest: "a".repeat(64), summary: "Grounded proof", assumptions: [], confidence: "high" as const,
      moments: [{ id: "m1", title: "Proof", startSec: 0, endSec: 1, hook: "Proof", quote: "Proof",
        sourceSegmentRefs: ["segment-1"], visualEvidenceIds: [], assumptions: [], confidence: "high" as const }],
      angles: [{ id: "a1", angleType: "source_insight" as const, evidenceKind: "source" as const,
        title: "Proof angle", rationale: "Use the proof.", evidenceRefs: ["m1", "segment-1"], assumptions: [], confidence: "high" as const }],
    };
    expect(strategySourceEvidenceIds(analysis)).toEqual(["a1", "m1", "segment-1"]);
  });

  it("accepts the same complete strict shape persisted by Python", () => {
    expect(contentStrategySchema.parse(valid).briefs[0].id).toBe("brief-1");
  });

  it("fails closed on incomplete briefs, final copy, and invalid mix", () => {
    type Mutable = Omit<typeof valid, "briefs"> & { briefs: Array<Partial<(typeof valid.briefs)[number]> & { finalPostCopy?: string }> };
    const incomplete = structuredClone(valid) as Mutable;
    delete incomplete.briefs[0].ctaIntent;
    expect(contentStrategySchema.safeParse(incomplete).success).toBe(false);
    const copy = structuredClone(valid) as Mutable;
    copy.briefs[0].finalPostCopy = "Buy now";
    expect(contentStrategySchema.safeParse(copy).success).toBe(false);
    const mix = structuredClone(valid);
    mix.contentMix[0].percentage = 90;
    expect(contentStrategySchema.safeParse(mix).success).toBe(false);
  });

  it("revalidates provenance and channels against persisted job truth", () => {
    const strategy = contentStrategySchema.parse(valid);
    const job = { config: { platforms: ["x"], strategyContext: {
      company: "Harmonia", product: "content engine", positioning: "governed",
      differentiators: ["evidence"], brandVoice: ["direct"], exclusions: [], safetyConstraints: [],
      businessObjectives: ["demos"], campaignObjectives: ["educate"],
      audiences: [{ id: "aud-founders", name: "Founders", pains: ["bottlenecks"] }],
      funnelStage: "consideration" as const, intendedConversion: "request demo",
      requestedChannels: ["x"], supportedChannels: ["x"], horizonWeeks: 4,
    } }, sourceAnalysis: { sourceDigest: "a".repeat(64), summary: "Grounded proof", assumptions: [], confidence: "high",
      moments: [{ id: "m1", title: "Proof", startSec: 0, endSec: 1, hook: "Proof", quote: "Proof",
        sourceSegmentRefs: ["segment-1"], visualEvidenceIds: [], assumptions: [], confidence: "high" }], angles: [] }, strategyInvocationContext: {
      revision: 1, sourceIds: ["m1"], operatorContextIds: ["context:company", "context:campaign"],
      performance: [], memoryFacts: [], audienceIds: ["aud-founders"],
      requestedChannels: ["x"], supportedChannels: ["x"], horizonWeeks: 4,
      researchRequest: null, searchEvidence: [],
    } };
    expect(() => validatePersistedStrategy(job as never, strategy)).not.toThrow();
    const segmentStrategy = structuredClone(strategy);
    segmentStrategy.briefs[0].evidenceRefs = ["segment-1"];
    const segmentJob = structuredClone(job);
    segmentJob.strategyInvocationContext.sourceIds.push("segment-1");
    expect(() => validatePersistedStrategy(segmentJob as never, segmentStrategy)).not.toThrow();
    const forged = structuredClone(strategy);
    forged.briefs[0].evidenceRefs = ["invented"];
    expect(() => validatePersistedStrategy(job as never, forged)).toThrow("unknown persisted evidence");
    const inventedMemory = structuredClone(strategy);
    inventedMemory.assumptions = [{ text: "invented", evidenceRefs: ["memory:invented"], confidence: "low" }];
    expect(() => validatePersistedStrategy(job as never, inventedMemory)).toThrow("unknown persisted evidence");
    const wrongChannel = structuredClone(strategy);
    wrongChannel.briefs[0].channelCandidates = ["linkedin"];
    expect(() => validatePersistedStrategy(job as never, wrongChannel)).toThrow("unrequested channel");
  });

  it("requires request-bound web search provenance for strategy search evidence", () => {
    const request = { id: "research-current-market", question: "What current public evidence describes governed content operations?", justification: "Current external information is necessary." };
    const evidence = [{ evidenceId: "search-1", title: "Search grounding", url: "https://dev.meta.ai/docs/search-grounding", supportedText: "Grounded responses connect claims to sources." }];
    const provenance = {
      provider: "meta" as const, responseId: "resp_1", model: "muse-spark-1.3", searchCalls: 2, results: [],
      citations: [{ url: evidence[0].url, title: evidence[0].title, citedText: "Grounded responses connect claims to sources." }],
      inputTokens: 1200, outputTokens: 300,
    };
    expect(() => validateStrategySearchGrounding(request, evidence, provenance)).not.toThrow();
    expect(() => validateStrategySearchGrounding(null, evidence, provenance)).toThrow("exact research request");
    expect(() => validateStrategySearchGrounding(request, evidence, { ...provenance, citations: [] })).toThrow("absent from web search provenance");
    expect(() => validateStrategySearchGrounding(request, [...evidence, evidence[0]], provenance)).toThrow("duplicate strategy search evidence");
  });
});
