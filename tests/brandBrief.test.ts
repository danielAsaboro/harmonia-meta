import { describe, expect, it } from "vitest";
import { applyBriefEdit, briefMemoryFacts, onboardingResultSchema, websiteOnboardingTarget, withBrandContext, type StoredBrandBrief } from "@/lib/brandBrief";
import type { StrategyContext } from "@/lib/types";

const saved: StrategyContext = {
  company: "Acme", product: "Client reporting", positioning: "Five-minute client reports",
  differentiators: ["Automatic slides"], brandVoice: ["Numbers first"], exclusions: [], safetyConstraints: [],
  businessObjectives: ["Grow trials"], campaignObjectives: ["Show time saved"],
  audiences: [{ id: "agency-owners", name: "Agency owners", pains: ["Reporting eats a day"] }],
  funnelStage: "awareness", intendedConversion: "Start a trial", requestedChannels: ["x"], supportedChannels: ["x"], horizonWeeks: 4,
};

describe("website onboarding", () => {
  it("finds the site in natural requests and ignores social links", () => {
    expect(websiteOnboardingTarget("Here's our website: acme.com. Learn it.")).toBe("acme.com");
    expect(websiteOnboardingTarget("onboard https://www.acme.io/product")).toBe("https://www.acme.io/product");
    expect(websiteOnboardingTarget("Repurpose this https://youtu.be/abc for our site")).toBeNull();
    expect(websiteOnboardingTarget("Write a post about https://acme.com")).toBeNull();
    expect(websiteOnboardingTarget("Can you help more founders find us? Here's our site: https://example.com")).toBeNull();
  });

  it("keeps the onboarded company and ICP but lets the router set this job's campaign", () => {
    const routed: StrategyContext = { ...saved, company: "Guessed Co", audiences: [{ id: "x", name: "Everyone", pains: ["?"] }], campaignObjectives: ["Launch v2"], funnelStage: "conversion" };
    const merged = withBrandContext(routed, saved, true)!;
    expect(merged.company).toBe("Acme");
    expect(merged.audiences).toEqual(saved.audiences);
    expect(merged.campaignObjectives).toEqual(["Launch v2"]);
    expect(merged.funnelStage).toBe("conversion");
    expect(withBrandContext(undefined, saved, true)).toEqual(saved);
    expect(withBrandContext(routed, saved, false)).toBe(routed);
  });

  it("turns the brief into memory facts traced to its version and cited sources", () => {
    const result = onboardingResultSchema.parse({
      website: "https://acme.test/", strategyContext: saved,
      brief: {
        company: "Acme", product: "Client reporting", category: "Reporting", positioning: "Five-minute reports", differentiators: ["Slides"],
        audiences: [{ id: "agency-owners", name: "Agency owners", pains: ["Reporting eats a day"], jobsToBeDone: [], objections: [], evidenceIds: ["web:1"] }],
        competitors: [{ name: "Rival", howWeDiffer: "Slides, not dashboards", evidenceIds: ["web:2"] }],
        pillars: [{ name: "Get your day back", purpose: "Pain to proof", evidenceIds: ["site:p1-seg-1"] }],
        voiceRules: ["Numbers first"], exclusions: [], businessObjectives: ["Trials"], campaignObjectives: ["Time saved"],
        funnelStage: "awareness", intendedConversion: "Trial",
      },
      evidence: [
        { id: "web:1", kind: "pain", text: "I lose a day", url: "https://reddit.com/r/agency/1", title: "t" },
        { id: "web:2", kind: "competitor", text: "Rival", url: "https://g2.example/rival", title: "t" },
      ],
      pages: [{ pageId: "p1", role: "home", url: "https://acme.test/", title: "Acme" }],
      unverifiedResearchDropped: 0, modelCalls: [],
    });
    const facts = briefMemoryFacts(result, "a".repeat(64), { workspaceId: "w1", brandId: "b1" });
    expect(facts.map((fact) => fact.fact)).toEqual([
      "Brand brief: Acme — Five-minute reports. Category: Reporting.",
      'ICP "Agency owners" pains: Reporting eats a day (sources: https://reddit.com/r/agency/1)',
      "Competitor Rival: Slides, not dashboards (sources: https://g2.example/rival)",
      'Messaging pillar "Get your day back": Pain to proof',
    ]);
    expect(facts.every((fact) => fact.kind === "learning" && fact.evidence_ref.job_id === "onboarding")).toBe(true);
    expect(facts[1].evidence_ref.record_id).toBe(`brief:${"a".repeat(24)}:2`);
  });

  it("applies an operator's edit to the brief and the strategy context jobs start from", () => {
    const stored = {
      website: "https://acme.test/", digest: "d".repeat(64), createdAt: "2026-11-04T00:00:00.000Z",
      brief: {
        company: "Acme", product: "Reporting", category: "Reporting", positioning: "Old", differentiators: ["Slides"],
        audiences: [{ id: "agency-owners", name: "Agency owners", pains: ["Reporting eats a day"], jobsToBeDone: ["Ship reports"], objections: [], evidenceIds: ["web:1"] }],
        competitors: [], pillars: [], voiceRules: ["Numbers first"], exclusions: [], businessObjectives: ["Trials"], campaignObjectives: ["Time saved"],
        funnelStage: "awareness", intendedConversion: "Trial",
      },
      evidence: [], pages: [], unverifiedResearchDropped: 0, modelCalls: [],
    } satisfies StoredBrandBrief;
    const { brief, context } = applyBriefEdit(stored, saved, {
      positioning: "Client reports in five minutes", voiceRules: ["Plain", "Specific"],
      audiences: [{ id: "agency-owners", name: "Agency founders", pains: ["Clients ignore dashboards"] }],
    });
    expect(brief.brief.audiences[0]).toMatchObject({ name: "Agency founders", pains: ["Clients ignore dashboards"], evidenceIds: ["web:1"], jobsToBeDone: ["Ship reports"] });
    expect(brief.digest).not.toBe(stored.digest);
    expect(brief.editedAt).toBeDefined();
    expect(context.positioning).toBe("Client reports in five minutes");
    expect(context.brandVoice).toEqual(["Plain", "Specific"]);
    expect(context.audiences).toEqual([{ id: "agency-owners", name: "Agency founders", pains: ["Clients ignore dashboards"] }]);
    expect(context.campaignObjectives).toEqual(saved.campaignObjectives);
  });
});
