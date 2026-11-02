import { afterAll, describe, expect, it } from "vitest";
import { servicePrincipal } from "@/lib/authority";
import { db } from "@/lib/firestore";
import { claimPersistedCycle, createResidentCycle, getResidentCycle } from "@/lib/residentAutonomy/repository";
import type { AutonomyCycle } from "@/lib/residentAutonomy/contracts";
import { runWithTenant } from "@/lib/tenancy";

const emulator = process.env.FIRESTORE_EMULATOR_HOST;
const tenant = { workspaceId: "resident-autonomy-test", brandId: "brand-test", principal: servicePrincipal("resident-autonomy-integration") };
const cycle: AutonomyCycle = { id: "cycle-1", workspaceId: tenant.workspaceId, brandId: tenant.brandId, type: "heartbeat", state: "scheduled", scheduledAt: "2026-08-27T08:00:00.000Z", timezone: "Africa/Lagos", triggerReason: "scheduler", cycleVersion: "1.0.0", effectBearing: false, armsAttempted: [], evidenceRefs: [], modelUsageIds: [], estimatedCostUsd: 0, outcome: "pending" };
describe.skipIf(!emulator)("resident autonomy Firestore transactions", () => {
  it("creates one immutable cycle and grants one active lease", async () => {
    expect(await runWithTenant(tenant, () => createResidentCycle(cycle))).toEqual({ created: true });
    expect(await runWithTenant(tenant, () => createResidentCycle(cycle))).toEqual({ created: false });
    const claim = await runWithTenant(tenant, () => claimPersistedCycle(cycle.id, { ownerId: "worker", claimToken: "token", now: "2026-08-27T08:00:01.000Z", leaseExpiresAt: "2026-08-27T08:05:01.000Z" }));
    expect(claim.outcome).toBe("execute"); expect((await runWithTenant(tenant, () => getResidentCycle(cycle.id)))?.state).toBe("claimed");
  });
  afterAll(async () => { if (emulator) await db().recursiveDelete(db().doc(`workspaces/${tenant.workspaceId}`)); });
});
