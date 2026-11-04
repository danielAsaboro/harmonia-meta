import { describe, expect, it } from "vitest";
import { SHARE_TOKEN, sharedSnapshot } from "@/lib/briefShares";
import type { StoredBrandBrief } from "@/lib/brandBrief";
import { publicPathAllowed } from "@/proxy";

describe("shared brand brief links", () => {
  it("open without a login only as a read of a well-formed token", () => {
    const token = "a".repeat(32);
    expect(SHARE_TOKEN.test(token)).toBe(true);
    expect(publicPathAllowed("GET", `/b/${token}`)).toBe(true);
    expect(publicPathAllowed("POST", `/b/${token}`)).toBe(false);
    expect(publicPathAllowed("GET", "/b/short")).toBe(false);
    expect(publicPathAllowed("POST", "/api/onboarding/website/share")).toBe(false);
  });

  it("share a snapshot without provider response ids", () => {
    const stored = {
      website: "https://acme.test/", digest: "d", createdAt: "t", evidence: [], pages: [], unverifiedResearchDropped: 0,
      modelCalls: [{ step: "read_site", model: "muse-spark-1.3", responseId: "resp_secret", inputTokens: 1, outputTokens: 1, searchCalls: 0, costUsd: "0.01" }],
      cost: { totalUsd: "0.01", pricingVersion: "2026-11-03", durationMs: 1 },
      brief: { company: "Acme" },
    } as unknown as StoredBrandBrief;
    const shared = sharedSnapshot(stored);
    expect(JSON.stringify(shared)).not.toContain("resp_secret");
    expect(shared.modelCalls[0]).toEqual({ step: "read_site", model: "muse-spark-1.3", inputTokens: 1, outputTokens: 1, searchCalls: 0, costUsd: "0.01" });
  });
});
