import { expect, it } from "vitest";
import { calculateNudgeImpact } from "@/lib/steering/lineage";
it("revokes downstream approval without erasing receipts", () => { const impact = calculateNudgeImpact({ id: "j1", stage: "draft" }, { id: "n1", jobId: "j1", expectedControlEpoch: 0, scope: "remaining_job", instruction: "Make it technical", proposedBySubjectId: "u1", proposedAt: "2026-08-30T00:00:00Z" }); expect(impact.revokesApprovals).toBe(true); expect(impact.preservesExecutedReceipts).toBe(true); expect(impact.digest).toMatch(/^[a-f0-9]{64}$/); });
