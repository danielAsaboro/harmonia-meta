import { afterAll, describe, expect, it } from "vitest";

import { servicePrincipal } from "@/lib/authority";
import {
  claimStageOutbox,
  createJob,
  db,
  finalizeStageOutboxPublish,
  listDispatchableStageOutbox,
  markFailed,
  retryFailedJobWithOutbox,
  transitionStageWithOutbox,
} from "@/lib/firestore";
import { createSourceJob } from "@/lib/sourceManifest";
import { runWithTenant } from "@/lib/tenancy";

const emulator = process.env.FIRESTORE_EMULATOR_HOST;
const scope = {
  workspaceId: "stage-outbox-test",
  brandId: "brand-test",
  principal: servicePrincipal("stage-outbox-integration"),
};

describe.skipIf(!emulator)("stage outbox Firestore transaction", () => {
  it("omits undefined optional job configuration before persistence", async () => {
    const job = await runWithTenant(scope, () => createJob({
      sourceManifestId: "manifest-optional-config",
      desiredOutputs: ["x_post"],
      allowedOutputs: ["x_post"],
      platforms: ["x"],
      strategyContext: undefined,
      analysisResearchRequest: undefined,
    }, "collect_sources"));

    const snapshot = await db().doc(`workspaces/${scope.workspaceId}/jobs/${job.id}`).get();
    expect(snapshot.get("config")).toEqual({
      sourceManifestId: "manifest-optional-config",
      desiredOutputs: ["x_post"],
      allowedOutputs: ["x_post"],
      platforms: ["x"],
    });
  });

  it("persists a direct-source manifest without undefined optional fields", async () => {
    const job = await runWithTenant(scope, () => createSourceJob({
      directSources: [{
        kind: "pasted_text",
        title: "Harmonia brief",
        text: "Harmonia turns source material into approval-gated content.",
        rightsAuthorizationId: "rights:harmonia-brief",
      }],
      desiredOutputs: ["x_post"],
      allowedOutputs: ["x_post"],
      platforms: ["x"],
    }));

    const manifests = await db().collection(`workspaces/${scope.workspaceId}/jobs/${job.id}/source_manifests`).get();
    expect(manifests.size).toBe(1);
    expect(manifests.docs[0].data()).not.toHaveProperty("librarySnapshotId");
  });

  it("atomically creates the initial trigger and grants one concurrent publisher", async () => {
    const job = await runWithTenant(scope, () => createJob({ sourceManifestId: "manifest-1", desiredOutputs: ["x_post"], allowedOutputs: ["x_post"], platforms: ["x"] }, "understand"));
    const records = await runWithTenant(scope, () => listDispatchableStageOutbox());
    const record = records.find((candidate) => candidate.jobId === job.id);
    expect(record).toBeDefined();
    if (!record) throw new Error("job stage outbox not found");
    expect(record).toMatchObject({ jobId: job.id, stage: "understand", state: "pending" });

    const outcomes = await runWithTenant(scope, () => Promise.all([
      claimStageOutbox(record.id, "owner-a"),
      claimStageOutbox(record.id, "owner-b"),
    ]));
    expect(outcomes.map((result) => result.outcome).sort()).toEqual(["in_progress", "publish"]);

    const winnerIndex = outcomes.findIndex((result) => result.outcome === "publish");
    const winnerDigest = winnerIndex === 0 ? "owner-a" : "owner-b";
    await runWithTenant(scope, () => finalizeStageOutboxPublish(record.id, winnerDigest, "pubsub-message-1"));
    const snapshot = await db().doc(`workspaces/${scope.workspaceId}/stage_outbox/${record.id}`).get();
    expect(snapshot.data()).toMatchObject({ state: "published", pubsubMessageId: "pubsub-message-1" });
  });

  it("starts retry accounting at zero for every newly entered stage", async () => {
    const job = await runWithTenant(scope, () => createJob({
      sourceManifestId: "manifest-stage-attempts",
      desiredOutputs: ["x_post"],
      allowedOutputs: ["x_post"],
      platforms: ["x"],
    }, "collect_sources"));
    await runWithTenant(scope, () => transitionStageWithOutbox(job.id, "collect_sources", "extract_sources", "collected"));
    await runWithTenant(scope, () => transitionStageWithOutbox(job.id, "extract_sources", "understand", "extracted"));

    const records = (await runWithTenant(scope, () => listDispatchableStageOutbox(100)))
      .filter((record) => record.jobId === job.id);
    expect(Object.fromEntries(records.map((record) => [record.stage, record.attempt]))).toEqual({
      collect_sources: 0,
      extract_sources: 0,
      understand: 0,
    });
  });

  it("enqueues an operator retry for a retryable persisted failure", async () => {
    const job = await runWithTenant(scope, () => createJob({
      sourceManifestId: "manifest-retryable",
      desiredOutputs: ["x_post"],
      allowedOutputs: ["x_post"],
      platforms: ["x"],
    }, "collect_sources"));
    await runWithTenant(scope, () => transitionStageWithOutbox(job.id, "collect_sources", "extract_sources", "collected"));
    await runWithTenant(scope, () => transitionStageWithOutbox(job.id, "extract_sources", "understand", "extracted"));
    await runWithTenant(scope, () => markFailed({
      jobId: job.id,
      stage: "understand",
      category: "dependency",
      code: "managed_dependency_unavailable",
      publicMessage: "A required dependency is temporarily unavailable.",
      retryable: true,
      operationId: `job:${job.id}:stage:understand:generation:2`,
      traceId: "a".repeat(32),
      attempt: 1,
      maxAttempts: 3,
      details: {},
    }));

    await runWithTenant(scope, () => retryFailedJobWithOutbox(job.id, "understand"));
    const retriedJob = await db().doc(`workspaces/${scope.workspaceId}/jobs/${job.id}`).get();
    expect(retriedJob.data()).toMatchObject({ status: "running", stage: "understand" });
    expect(retriedJob.data()).not.toHaveProperty("failure");
    const retry = (await runWithTenant(scope, () => listDispatchableStageOutbox(100)))
      .find((record) => record.jobId === job.id && record.stage === "understand" && record.attempt === 0);
    expect(retry).toMatchObject({ stage: "understand", state: "pending", attempt: 0 });
  });

  afterAll(async () => {
    if (emulator) await db().recursiveDelete(db().doc(`workspaces/${scope.workspaceId}`));
  });
});
