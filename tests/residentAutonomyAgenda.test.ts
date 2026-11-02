import { describe, expect, it } from "vitest";
import { buildWakeupAgenda } from "@/lib/residentAutonomy/agenda";

const base = { workspaceId: "w", brandId: "b", cycleId: "wake-1", scheduledFor: "2026-08-27T06:00:00.000Z", createdAt: "2026-08-27T06:00:01.000Z", briefing: "One approval needs attention." };
describe("durable wakeup agenda", () => {
  it("derives stable agenda and item identities with all four authority classes", () => {
    const input = { ...base, items: [
      { key: "maintenance", title: "Retry stage outbox", evidenceRefs: ["cycle-1"], estimatedCostUsd: 0, deadline: "2026-08-27T07:00:00.000Z", risk: "low", authority: "execute" },
      { key: "tune", title: "Prefer 09:00", evidenceRefs: ["exp-1"], estimatedCostUsd: 0, deadline: "2026-08-28T06:00:00.000Z", risk: "low", authority: "auto_tune", tuning: { category: "preferred_posting_hour", currentValue: 14, candidateValue: 9 } },
      { key: "prompt", title: "Change agent prompt", evidenceRefs: ["hyp-1"], estimatedCostUsd: 0, deadline: "2026-08-28T06:00:00.000Z", risk: "medium", authority: "auto_tune", tuning: { category: "prompt", currentValue: "old", candidateValue: "new" } },
      { key: "attention", title: "Resolve uncertain effect", evidenceRefs: ["claim-1"], estimatedCostUsd: 0, deadline: "2026-08-27T07:00:00.000Z", risk: "high", authority: "request_attention" },
    ] } as const;
    const first = buildWakeupAgenda(input); const second = buildWakeupAgenda(input);
    expect(first).toEqual(second); expect(first.agenda.itemIds).toHaveLength(4);
    expect(first.items.map((item) => item.authority)).toEqual(["execute", "auto_tune", "propose", "request_attention"]);
    expect(first.items.every((item) => /^[a-f0-9]{64}$/.test(item.idempotencyKey))).toBe(true);
  });
  it("rejects agenda items without evidence", () => {
    expect(() => buildWakeupAgenda({ ...base, items: [{ key: "bad", title: "Ungrounded", evidenceRefs: [], estimatedCostUsd: 0, deadline: "2026-08-27T07:00:00.000Z", risk: "low", authority: "execute" }] })).toThrow();
  });
});
