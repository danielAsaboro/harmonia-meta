import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import PipelineStepper from "@/components/PipelineStepper";
import type { JobFull } from "@/components/jobTypes";
import { SourcesWorkspace } from "@/components/studio/SourcesWorkspace";
import { ApprovalDock } from "@/components/studio/ApprovalDock";

const selected = {
  id: "item-selected", briefId: "brief-proof", campaignTheme: "Proof week", contentPillar: "Customer outcomes",
  objective: "Earn consideration", audienceId: "founders", funnelStage: "consideration" as const,
  intendedConversion: "Request a demo", ctaIntent: "See the workflow", kpi: "Qualified demos",
  channel: "x", format: "thread", evidenceRefs: ["moment-proof", "context:campaign"],
  publicationWindowStartAt: "2026-09-01T16:00:00Z", publicationWindowEndAt: "2026-09-01T18:00:00Z",
  productionDeadlineAt: "2026-08-31T18:00:00Z", priority: 1, selectionScore: 0.93,
  dependencies: [], productionStatus: "planned" as const, constraints: ["No unverified metrics"], requiredAssets: ["Product capture"],
  planningRationale: "Open the sequence with source-backed proof.", selectionRationale: "Highest-priority eligible brief.", confidence: "high" as const,
};

const remaining = {
  ...selected, id: "item-followup", briefId: "brief-how", campaignTheme: "Education week", format: "video",
  evidenceRefs: ["angle-how"], publicationWindowStartAt: "2026-09-08T16:00:00Z", publicationWindowEndAt: "2026-09-08T18:00:00Z",
  productionDeadlineAt: "2026-09-07T18:00:00Z", priority: 2, selectionScore: 0.72,
  dependencies: ["item-selected"], planningRationale: "Follow proof with implementation detail.", selectionRationale: "Blocked by the proof item.", confidence: "medium" as const,
};

const job: JobFull = {
  id: "job-1", status: "running", stage: "plan", createdAt: "2026-08-27T00:00:00Z", updatedAt: "2026-08-27T00:01:00Z",
  config: { sourceManifestId: "manifest-1", desiredOutputs: ["x_post"], allowedOutputs: ["x_post"], platforms: ["x"] }, normalizedSources: [], actions: [],
  editorialPlan: {
    planId: "plan-1", version: 1, approvedStrategyDigest: "a".repeat(64),
    planningSnapshotId: "planning-job-1-v1", planningSnapshotDigest: "d".repeat(64),
    horizonStartAt: "2026-08-31T00:00:00Z", horizonEndAt: "2026-09-28T00:00:00Z", timezone: "Africa/Lagos",
    summary: "A four-week proof-to-education sequence.", sequencingRationale: "Proof before process.",
    cadenceRationale: "One primary item each week to fit production capacity.", assumptions: ["Founder availability remains stable."],
    confidence: "high", items: [selected, remaining], selectedNextItemId: selected.id,
  },
  editorialPlanDigest: "b".repeat(64), editorialPlanRevision: 1,
  editorialPlanningSnapshot: {
    snapshotId: "planning-job-1-v1", asOf: "2026-08-30T12:00:00Z",
    horizonStartAt: "2026-08-31T00:00:00Z", horizonEndAt: "2026-09-28T00:00:00Z", timezone: "Africa/Lagos",
    channelCapabilities: [{ channel: "x", formats: ["thread"] }], existingCommitments: [],
    productionCapacity: { maxItems: 8, maxItemsPerWeek: 2 }, cadenceConstraints: { minimumHoursBetweenItems: 24, maxItemsPerChannelPerWeek: 2 },
    postingWindowObservations: [], assetReadiness: [], blockedDependencies: [], calendarProjection: [],
    provenanceIds: ["policy:editorial-planning-v1"],
  }, editorialPlanningSnapshotDigest: "d".repeat(64),
  editorialPlanEvidenceLineage: ["angle-how", "context:campaign", "moment-proof"], selectedNextItemId: selected.id,
  editorialItemStates: {
    [selected.id]: { status: "selected", updatedAt: "2026-08-27T00:01:00Z" },
    [remaining.id]: { status: "planned", updatedAt: "2026-08-27T00:01:00Z" },
  },
};

describe("Temi persisted editorial-plan UI", () => {
  it("renders the complete plan, selected item, remaining lifecycle, and provenance", () => {
    const html = renderToStaticMarkup(createElement(SourcesWorkspace, { job, receipts: [] }));

    for (const value of [
      "Temi editorial plan", "Africa/Lagos", "Aug 31, 2026", "Sep 28, 2026",
      "One primary item each week", "Highest-priority eligible brief", "selected", "planned",
      "moment-proof", "angle-how", "Founder availability remains stable", "high confidence",
      "Aug 31, 2026", "Sep 1, 2026", "item-selected", "item-followup",
      "No unverified metrics", "Product capture",
      "Planning snapshot", "policy:editorial-planning-v1",
      "Sep 1, 2026, 5:00 PM GMT+1", "Sep 1, 2026, 7:00 PM GMT+1", "Aug 31, 2026, 7:00 PM GMT+1",
      "Priority 1", "Selection score 0.93", "high item confidence", "Priority 2", "Selection score 0.72", "medium item confidence",
    ]) expect(html).toContain(value);
    expect(html).not.toContain("Receipts &amp; verification");
  });

  it("shows plan as a durable pipeline stage", () => {
    const html = renderToStaticMarkup(createElement(PipelineStepper, { stage: "plan", status: "running" }));
    expect(html).toContain("Plan");
    expect(html).toContain("Draft");
  });

  it("describes strategy approval as preceding a bounded plan proposal without calendar authority", () => {
    const approvalJob = {
      ...job,
      stage: "awaiting_strategy_approval" as const,
      strategyApprovalState: "pending" as const,
      strategyDigest: "a".repeat(64),
      contentStrategy: { version: 1, thesis: "Lead with proof" },
    } as JobFull;
    const html = renderToStaticMarkup(createElement(ApprovalDock, {
      job: approvalJob, jobId: job.id, actions: [], verifications: [], receipts: [],
      busy: false, onDecide: () => undefined,
    }));

    expect(html).toContain("Temi&#x27;s bounded editorial-plan proposal");
    expect(html).toContain("no external-calendar authority");
    expect(html).not.toContain("creates calendar work");
  });
});
