import { aggregateModelUsage, microsToUsd, usdToMicros } from "@/lib/costs";
import { listEvents, listJobs, listReceipts, listUsageRecords } from "@/lib/firestore";
import { STAGES } from "@/lib/types";
import { tenantHandler } from "@/lib/auth";

export interface StageDwell {
  stage: string;
  avgSec: number;
  p50Sec: number;
  p95Sec: number;
  samples: number;
}

export interface StageStat {
  stage: string;
  reached: number;
  failed: number;
  successRate: number;
}

export interface MetricsResponse {
  totals: {
    jobs: number;
    running: number;
    waiting_for_approval: number;
    complete: number;
    failed: number;
  };
  stages: Array<{ stage: string; count: number }>;
  receipts: { applied: number; already_applied: number; failed: number; rejected: number };
  stageDwell: StageDwell[];
  stageStats: StageStat[];
  modelUsage: Array<{
    model: string;
    role: string;
    calls: number;
    inputUnits: number;
    outputUnits: number;
    estimatedCostUsd: string;
  }>;
  costs: {
    estimatedUsd: string;
    observedUsd: string;
    reservedUsd: string;
  };
  recentEvents: Array<{ at: string | null; jobId: string; stage: string; message: string; actor: string }>;
}

const DWELL_SAMPLE_JOBS = 15;
const RECENT_EVENTS_LIMIT = 40;

function diffSeconds(fromIso: string, toIso: string): number | null {
  const from = Date.parse(fromIso);
  const to = Date.parse(toIso);
  if (Number.isNaN(from) || Number.isNaN(to)) return null;
  return Math.max(0, Math.round((to - from) / 1000));
}

async function get(_req: Request) {
  const jobs = await listJobs(100);

  const totals = {
    jobs: jobs.length,
    running: jobs.filter((j) => j.status === "running").length,
    waiting_for_approval: jobs.filter((j) => j.stage === "awaiting_approval" || j.stage === "awaiting_strategy_approval").length,
    complete: jobs.filter((j) => j.status === "complete").length,
    failed: jobs.filter((j) => j.status === "failed").length,
  };

  const stages = STAGES.map((stage) => ({
    stage,
    count: jobs.filter((j) => j.stage === stage).length,
  })).filter((s) => s.count > 0);

  const sample = jobs.slice(0, DWELL_SAMPLE_JOBS);
  const [dwellLists, receiptLists, eventLists, usageLists] = await Promise.all([
    Promise.all(sample.map((j) => listEvents(j.id))),
    Promise.all(sample.map((j) => listReceipts(j.id))),
    Promise.all(sample.map((j) => listEvents(j.id))),
    Promise.all(sample.map((j) => listUsageRecords(j.id))),
  ]);

  const dwellAcc = new Map<string, number[]>();
  for (const events of dwellLists) {
    const ordered = [...events].sort(
      (a, b) => (Date.parse(a.at ?? "0") || 0) - (Date.parse(b.at ?? "0") || 0),
    );
    for (let i = 0; i < ordered.length - 1; i++) {
      const sec = diffSeconds(ordered[i].at ?? "", ordered[i + 1].at ?? "");
      if (sec === null) continue;
      const list = dwellAcc.get(ordered[i].stage) ?? [];
      list.push(sec);
      dwellAcc.set(ordered[i].stage, list);
    }
  }
  const percentile = (secs: number[], p: number) => {
    const sorted = [...secs].sort((a, b) => a - b);
    const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
    return sorted[idx] ?? 0;
  };
  const stageDwell: StageDwell[] = [...dwellAcc.entries()]
    .map(([stage, secs]) => ({
      stage,
      avgSec: Math.round(secs.reduce((a, b) => a + b, 0) / secs.length),
      p50Sec: percentile(secs, 50),
      p95Sec: percentile(secs, 95),
      samples: secs.length,
    }))
    .sort((a, b) => b.samples - a.samples);

  // Reliability per stage: jobs that passed through vs jobs that failed there.
  const reachedByStage = new Map<string, Set<string>>();
  for (let i = 0; i < sample.length; i++) {
    for (const e of eventLists[i]) {
      const set = reachedByStage.get(e.stage) ?? new Set<string>();
      set.add(sample[i].id);
      reachedByStage.set(e.stage, set);
    }
  }
  const stageStats: StageStat[] = STAGES.filter(
    (st) => st !== "queued" && st !== "complete" && st !== "failed",
  ).map((stage) => {
    const reached = reachedByStage.get(stage)?.size ?? 0;
    const failed = jobs.filter((j) => j.failure?.stage === stage).length;
    return { stage, reached, failed, successRate: reached ? (reached - failed) / reached : 1 };
  }).filter((s2) => s2.reached > 0);

  const receipts = { applied: 0, already_applied: 0, failed: 0, rejected: 0 };
  for (const rs of receiptLists) {
    for (const r of rs) {
      if (r.outcome in receipts) {
        receipts[r.outcome as keyof typeof receipts] += 1;
      }
    }
  }

  const recentEvents = eventLists
    .flatMap((events, i) => events.map((e) => ({ ...e, jobId: sample[i].id })))
    .sort((a, b) => (Date.parse(b.at ?? "0") || 0) - (Date.parse(a.at ?? "0") || 0))
    .slice(0, RECENT_EVENTS_LIMIT)
    .map((e) => ({ at: e.at, jobId: e.jobId, stage: e.stage, message: e.message, actor: e.actor }));

  const usage = aggregateModelUsage(usageLists.flat());
  const reservedMicros = sample.reduce(
    (total, job) => total + usdToMicros(job.budget?.reservedUsd ?? "0.00"),
    BigInt(0),
  );
  const costs = {
    estimatedUsd: usage.estimatedUsd,
    observedUsd: usage.observedUsd,
    reservedUsd: microsToUsd(reservedMicros),
  };

  return Response.json({
    totals,
    stages,
    receipts,
    stageDwell,
    stageStats,
    modelUsage: usage.modelUsage,
    costs,
    recentEvents,
  } satisfies MetricsResponse);
}

export const GET = tenantHandler(get);
