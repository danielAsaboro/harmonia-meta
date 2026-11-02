import { afterAll, describe, expect, it } from "vitest";

import { servicePrincipal } from "@/lib/authority";
import { db } from "@/lib/firestore";
import { getDurableRuntimeSnapshot } from "@/lib/observability/repository";
import { runWithTenant, tenantCollectionPath } from "@/lib/tenancy";

const emulator = process.env.FIRESTORE_EMULATOR_HOST;
const scope = { workspaceId: "runtime-observability-test", brandId: "brand-test", principal: servicePrincipal("runtime-observability") };
const now = "2026-08-28T12:00:00.000Z";

describe.skipIf(!emulator)("durable runtime observability snapshot", () => {
  it("reports stale leases, ambiguity, projection identity, artifacts, lag, and recovery work without payloads", async () => {
    const path = (name: string, id: string) => `${tenantCollectionPath(scope, name)}/${id}`;
    await Promise.all([
      db().doc(path("operations", "job:job-1:stage:draft")).set({ workspaceId: scope.workspaceId, brandId: scope.brandId, state: "claimed", leaseExpiresAt: "2026-08-28T11:59:00.000Z" }),
      db().doc(path("event_inbox", "inbox-1")).set({ workspaceId: scope.workspaceId, brandId: scope.brandId, state: "processing", claimUntil: "2026-08-28T11:59:00.000Z", receivedAt: "2026-08-28T11:58:00.000Z" }),
      db().doc(path("stage_outbox", "outbox-1")).set({ workspaceId: scope.workspaceId, brandId: scope.brandId, state: "claimed", claimUntil: "2026-08-28T11:59:00.000Z", createdAt: "2026-08-28T11:57:00.000Z" }),
      db().doc(path("effect_commands", "command-1")).set({ workspaceId: scope.workspaceId, brandId: scope.brandId, jobId: "job-1", state: "unknown", operationId: "job:job-1:effect:command-1", operationEpoch: 3, unknownReason: "provider response lost", dispatchedAt: "2026-08-28T11:55:00.000Z", payload: { private: "must not surface" } }),
      db().doc(path("context_projections", "projection-1")).set({ workspaceId: scope.workspaceId, brandId: scope.brandId, compilerVersion: "harmonia-context/v1", manifestDigest: "a".repeat(64), createdAt: "2026-08-28T11:50:00.000Z" }),
      db().doc(path("artifacts", "artifact-ready")).set({ workspaceId: scope.workspaceId, brandId: scope.brandId, state: "ready" }),
      db().doc(path("artifacts", "artifact-failed")).set({ workspaceId: scope.workspaceId, brandId: scope.brandId, state: "failed" }),
      db().doc(path("recovery_work", "recovery-1")).set({ workspaceId: scope.workspaceId, brandId: scope.brandId, state: "pending", action: "reconcile_effect", createdAt: "2026-08-28T11:59:30.000Z" }),
    ]);
    const snapshot = await runWithTenant(scope, () => getDurableRuntimeSnapshot(now));
    expect(snapshot).toMatchObject({
      staleLeases: { operations: 1, inbox: 1, outbox: 1 },
      inboxLagSeconds: 120, outboxLagSeconds: 180,
      unknownEffects: [{ commandId: "command-1", epoch: 3, reason: "provider response lost" }],
      projection: { count: 1, compilerVersion: "harmonia-context/v1", manifestDigest: "a".repeat(64) },
      artifacts: { ready: 1, failed: 1, writing: 0 }, recovery: { pending: 1 },
    });
    expect(JSON.stringify(snapshot)).not.toContain("must not surface");
  });

  afterAll(async () => {
    if (emulator) await db().recursiveDelete(db().doc(`workspaces/${scope.workspaceId}`));
  });
});
