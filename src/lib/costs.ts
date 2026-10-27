import type { JobBudget } from "./types";

const USD_PATTERN = /^\d+(?:\.\d{1,6})?$/;
const SCALE = BigInt(1_000_000);

export function usdToMicros(value: string): bigint {
  if (!USD_PATTERN.test(value)) throw new Error(`invalid USD decimal: ${value}`);
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole) * SCALE + BigInt(fraction.padEnd(6, "0"));
}

export function microsToUsd(value: bigint): string {
  if (value < BigInt(0)) throw new Error("USD micro-value cannot be negative");
  const whole = value / SCALE;
  const fraction = (value % SCALE).toString().padStart(6, "0");
  const trimmed = fraction.replace(/0+$/, "").padEnd(2, "0");
  return `${whole}.${trimmed}`;
}

export function canReserve(budget: JobBudget, requestedUsd: string): boolean {
  return usdToMicros(budget.observedUsd)
    + usdToMicros(budget.reservedUsd)
    + usdToMicros(requestedUsd)
    <= usdToMicros(budget.limitUsd);
}

export function exceedsApprovalThreshold(budget: JobBudget, requestedUsd: string): boolean {
  return usdToMicros(requestedUsd) > usdToMicros(budget.approvalThresholdUsd);
}

export function applyReservation(budget: JobBudget, requestedUsd: string): JobBudget {
  if (!canReserve(budget, requestedUsd)) throw new Error("job budget exceeded");
  const requested = usdToMicros(requestedUsd);
  return {
    ...budget,
    estimatedUsd: microsToUsd(usdToMicros(budget.estimatedUsd) + requested),
    reservedUsd: microsToUsd(usdToMicros(budget.reservedUsd) + requested),
  };
}

export function applyFinalizedUsage(
  budget: JobBudget,
  reservedUsd: string,
  actualUsd: string,
): JobBudget {
  const reserved = usdToMicros(reservedUsd);
  const currentReserved = usdToMicros(budget.reservedUsd);
  if (reserved > currentReserved) throw new Error("usage exceeds reserved job amount");
  return {
    ...budget,
    reservedUsd: microsToUsd(currentReserved - reserved),
    observedUsd: microsToUsd(usdToMicros(budget.observedUsd) + usdToMicros(actualUsd)),
  };
}

export function applyReleasedReservation(
  budget: JobBudget,
  reservedUsd: string,
): JobBudget {
  const released = usdToMicros(reservedUsd);
  const currentReserved = usdToMicros(budget.reservedUsd);
  if (released > currentReserved) throw new Error("release exceeds reserved job amount");
  return {
    ...budget,
    reservedUsd: microsToUsd(currentReserved - released),
  };
}

export function summarizeUsage(
  records: Array<{ model: string; estimatedCostUsd: string }>,
): { totalEstimatedUsd: string; byModel: Record<string, string> } {
  let total = BigInt(0);
  const byModelMicros = new Map<string, bigint>();
  for (const record of records) {
    const cost = usdToMicros(record.estimatedCostUsd);
    total += cost;
    byModelMicros.set(record.model, (byModelMicros.get(record.model) ?? BigInt(0)) + cost);
  }
  return {
    totalEstimatedUsd: microsToUsd(total),
    byModel: Object.fromEntries(
      [...byModelMicros.entries()].map(([model, cost]) => [model, microsToUsd(cost)]),
    ),
  };
}

export interface ModelUsageSummary {
  model: string;
  role: string;
  calls: number;
  inputUnits: number;
  outputUnits: number;
  estimatedCostUsd: string;
}

export function aggregateModelUsage(records: Array<{
  model: string;
  role: string;
  inputUnits: number;
  outputUnits: number;
  estimatedCostUsd: string;
  observedCostUsd?: string;
}>): {
  modelUsage: ModelUsageSummary[];
  estimatedUsd: string;
  observedUsd: string;
} {
  const groups = new Map<string, {
    model: string;
    role: string;
    calls: number;
    inputUnits: number;
    outputUnits: number;
    estimatedMicros: bigint;
  }>();
  let estimatedMicros = BigInt(0);
  let observedMicros = BigInt(0);
  for (const record of records) {
    const estimated = usdToMicros(record.estimatedCostUsd);
    estimatedMicros += estimated;
    if (record.observedCostUsd !== undefined) {
      observedMicros += usdToMicros(record.observedCostUsd);
    }
    const key = `${record.model}\u0000${record.role}`;
    const group = groups.get(key) ?? {
      model: record.model,
      role: record.role,
      calls: 0,
      inputUnits: 0,
      outputUnits: 0,
      estimatedMicros: BigInt(0),
    };
    group.calls += 1;
    group.inputUnits += record.inputUnits;
    group.outputUnits += record.outputUnits;
    group.estimatedMicros += estimated;
    groups.set(key, group);
  }
  return {
    modelUsage: [...groups.values()].map((group) => ({
      model: group.model,
      role: group.role,
      calls: group.calls,
      inputUnits: group.inputUnits,
      outputUnits: group.outputUnits,
      estimatedCostUsd: microsToUsd(group.estimatedMicros),
    })),
    estimatedUsd: microsToUsd(estimatedMicros),
    observedUsd: microsToUsd(observedMicros),
  };
}
