import type { DataWorkItemState } from "./contracts";

export interface FanInPolicy {
  allowPartial: boolean;
  minimumSuccessRatio: number;
}

export interface BatchOutcome {
  outcome: "running" | "complete" | "partial" | "failed" | "cancelled";
  counts: { total: number; succeeded: number; failed: number; cancelled: number; active: number };
  successRatio: number;
}

export function reduceBatchOutcome(
  items: Array<{ id: string; state: DataWorkItemState }>,
  policy: FanInPolicy,
): BatchOutcome {
  if (items.length === 0) throw new Error("fan-in requires at least one work item");
  if (!Number.isFinite(policy.minimumSuccessRatio) || policy.minimumSuccessRatio < 0 || policy.minimumSuccessRatio > 1) {
    throw new Error("minimum success ratio must be between 0 and 1");
  }
  const succeeded = items.filter((item) => item.state === "succeeded").length;
  const failed = items.filter((item) => item.state === "dead_lettered").length;
  const cancelled = items.filter((item) => item.state === "cancelled").length;
  const active = items.length - succeeded - failed - cancelled;
  const successRatio = succeeded / items.length;
  const counts = { total: items.length, succeeded, failed, cancelled, active };
  if (active > 0) return { outcome: "running", counts, successRatio };
  if (cancelled === items.length) return { outcome: "cancelled", counts, successRatio };
  if (succeeded === items.length) return { outcome: "complete", counts, successRatio };
  if (policy.allowPartial && successRatio >= policy.minimumSuccessRatio) return { outcome: "partial", counts, successRatio };
  return { outcome: "failed", counts, successRatio };
}
