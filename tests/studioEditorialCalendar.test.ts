import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { EditorialCalendar } from "@/components/studio/EditorialCalendar";
import type { JobFull } from "@/components/jobTypes";

const baseItem = {
  id: "item-1", briefId: "brief-1", campaignTheme: "Proof", contentPillar: "Outcomes", objective: "Earn trust", audienceId: "founders", funnelStage: "consideration" as const,
  intendedConversion: "Book demo", ctaIntent: "See it", kpi: "Demos", channel: "x", format: "thread", evidenceRefs: ["moment-1"],
  publicationWindowStartAt: "2026-09-08T16:00:00.000Z", publicationWindowEndAt: "2026-09-08T18:00:00.000Z", productionDeadlineAt: "2026-09-07T18:00:00.000Z",
  priority: 1, selectionScore: 0.9, dependencies: [], productionStatus: "planned" as const, constraints: [], requiredAssets: [], planningRationale: "Lead with proof.", selectionRationale: "Highest priority.", confidence: "high" as const,
};

const job = {
  id: "job-1", status: "running", stage: "plan", createdAt: "2026-09-04T00:00:00.000Z", updatedAt: "2026-09-04T00:01:00.000Z",
  config: { sourceManifestId: "manifest-1", desiredOutputs: ["x_post"], allowedOutputs: ["x_post"], platforms: ["x"] }, normalizedSources: [], actions: [],
  editorialPlan: { planId: "plan-1", version: 1, approvedStrategyDigest: "a".repeat(64), planningSnapshotId: "snapshot-1", planningSnapshotDigest: "b".repeat(64), horizonStartAt: "2026-09-08T00:00:00.000Z", horizonEndAt: "2026-09-15T00:00:00.000Z", timezone: "Africa/Lagos", summary: "Two-week launch", sequencingRationale: "Proof first", cadenceRationale: "Weekly", assumptions: [], confidence: "high" as const, items: [baseItem, { ...baseItem, id: "item-2", channel: "linkedin", publicationWindowStartAt: "2026-09-10T09:00:00.000Z", publicationWindowEndAt: "2026-09-10T11:00:00.000Z", priority: 2 }], selectedNextItemId: "item-1" },
  selectedNextItemId: "item-1", editorialItemStates: { "item-1": { status: "selected" as const, updatedAt: "2026-09-04T00:01:00.000Z" } },
} satisfies JobFull;

describe("studio editorial calendar", () => {
  it("groups the persisted plan into human-readable publishing dates", () => {
    const html = renderToStaticMarkup(createElement(EditorialCalendar, { job }));
    expect(html).toContain("Editorial calendar");
    expect(html).toContain("Africa/Lagos");
    expect(html).toContain("Sep 8");
    expect(html).toContain("Sep 10");
    expect(html).toContain("Up next");
    expect(html).toContain("LinkedIn");
    expect(html).not.toContain("item-1");
  });
});
