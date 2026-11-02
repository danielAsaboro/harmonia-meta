import { afterAll, describe, expect, it } from "vitest";

import { db } from "@/lib/firestore";
import {
  applyDemoHistory,
  discoverDemoHistory,
  verifyDemoHistory,
} from "@/lib/demoHistoryStore";

const emulator = process.env.FIRESTORE_EMULATOR_HOST;
const workspaceId = `demo-history-test-${Date.now()}`;
const brandId = "brand-test";
const datasetId = "aug27";
const manifestPath = `workspaces/${workspaceId}/brands/${brandId}/demo_datasets/${datasetId}`;

describe.skipIf(!emulator)("demo history Firestore copy", () => {
  it("copies job history, preserves sources, and quarantines executable records", async () => {
    const sourceJob = {
      id: "j1",
      workspaceId,
      brandId,
      createdAt: "2026-08-30T00:00:00.000Z",
      updatedAt: "2026-08-31T00:00:00.000Z",
      status: "running",
      stage: "draft",
    };
    await db().doc(`workspaces/${workspaceId}`).set({ defaultBrandId: brandId });
    await db().doc(`workspaces/${workspaceId}/brands/${brandId}`).set({ id: brandId, workspaceId });
    await db().doc(`workspaces/${workspaceId}/jobs/j1`).set(sourceJob);
    await db().doc(`workspaces/${workspaceId}/jobs/j1/stage_attempts/a1`).set({
      jobId: "j1",
      createdAt: "2026-08-30T01:00:00.000Z",
    });
    await db().doc(`workspaces/${workspaceId}/jobs/j1/stage_executions/e1`).set({
      jobId: "j1",
      state: "claimed",
      leaseExpiresAt: "2026-08-30T01:30:00.000Z",
    });
    await db().doc(`workspaces/${workspaceId}/brands/${brandId}/production_plans/p1`).set({
      id: "p1",
      jobId: "j1",
      workspaceId,
      brandId,
      state: "approved",
      createdAt: "2026-08-30T02:00:00.000Z",
    });
    await db().doc(`workspaces/${workspaceId}/brands/${brandId}/production_plans/p1/operation_claims/c1`).set({
      id: "c1",
      jobId: "j1",
      state: "claimed",
      claimedAt: "2026-08-30T03:00:00.000Z",
    });
    await db().doc(`workspaces/${workspaceId}/brands/${brandId}/production_operation_outbox/o1`).set({
      id: "o1",
      jobId: "j1",
      state: "pending",
      createdAt: "2026-08-30T04:00:00.000Z",
    });

    const sourceBefore = (await db().doc(`workspaces/${workspaceId}/jobs/j1`).get()).data();
    const discoveryInput = {
      workspaceId,
      brandId,
      datasetId,
      anchor: "2026-08-27T00:00:00.000Z",
    };
    const plan = await discoverDemoHistory({ ...discoveryInput, mode: "dry-run" } as typeof discoveryInput);
    const applyPlan = await discoverDemoHistory({
      ...discoveryInput,
      mode: "apply",
      expectedDigest: plan.digest,
    } as typeof discoveryInput);

    expect(plan.sourceJobCount).toBe(1);
    expect(plan.minimumSourceTimestamp).toBe("2026-08-30T00:00:00.000Z");
    expect(plan.minimumDemoTimestamp).toBe("2026-08-27T00:00:00.000Z");
    expect(plan.unsafeLiveDestinationCount).toBe(0);
    expect(applyPlan.digest).toBe(plan.digest);

    const manifest = await applyDemoHistory(applyPlan, plan.digest);
    const demoJobs = await db().collection(`workspaces/${workspaceId}/jobs`)
      .where("demoProvenance.datasetId", "==", datasetId).get();
    expect(demoJobs.size).toBe(1);
    expect(demoJobs.docs[0].data()).toMatchObject({
      status: "complete",
      stage: "complete",
      createdAt: "2026-08-27T00:00:00.000Z",
      demoProvenance: {
        kind: "teaching_demo",
        datasetId,
        originalStatus: "running",
        originalStage: "draft",
      },
    });
    expect((await demoJobs.docs[0].ref.collection("stage_attempts").doc("a1").get()).data()).toMatchObject({
      jobId: demoJobs.docs[0].id,
      createdAt: "2026-08-27T01:00:00.000Z",
    });
    expect((await db().collection(`workspaces/${workspaceId}/brands/${brandId}/production_plans`)
      .where("demoProvenance.datasetId", "==", datasetId).get()).size).toBe(1);
    expect((await db().collection(`workspaces/${workspaceId}/brands/${brandId}/production_operation_outbox`)
      .where("demoProvenance.datasetId", "==", datasetId).get()).empty).toBe(true);
    expect((await db().collection(`${manifestPath}/records`).where("quarantined", "==", true).get()).size).toBe(3);
    expect((await demoJobs.docs[0].ref.collection("stage_executions").get()).empty).toBe(true);
    expect((await db().doc(`workspaces/${workspaceId}/jobs/j1`).get()).data()).toEqual(sourceBefore);
    expect(manifest.minimumDemoTimestamp).toBe("2026-08-27T00:00:00.000Z");

    await expect(applyDemoHistory(plan, plan.digest)).rejects.toThrow("demo dataset already exists");
    await expect(applyDemoHistory(plan, "0".repeat(64))).rejects.toThrow("demo history plan digest mismatch");

    await expect(verifyDemoHistory(manifestPath)).resolves.toMatchObject({
      sourceUnchanged: true,
      minimumTimestampMatchesAnchor: true,
      relativeIntervalsPreserved: true,
      executableDestinationCount: 0,
      manifestDigestMatches: true,
    });
  });

  afterAll(async () => {
    if (emulator) await db().recursiveDelete(db().doc(`workspaces/${workspaceId}`));
  });
});
