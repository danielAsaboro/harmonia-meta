import { z } from "zod";
import { db } from "@/lib/firestore";
import { newId } from "@/lib/idempotency";
import { ONBOARDING_STEPS, type OnboardingRun } from "@/lib/onboardingSteps";
import { currentTenant, tenantCollectionPath } from "@/lib/tenancy";

export const onboardingProgressSchema = z.object({
  runId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
  step: z.enum(ONBOARDING_STEPS),
  status: z.enum(["running", "done", "failed"]),
  detail: z.string().trim().max(240).optional(),
}).strict();
export type OnboardingProgress = z.infer<typeof onboardingProgressSchema>;

const RUNS = "onboardingRuns";

function runs() {
  return db().collection(tenantCollectionPath(currentTenant(), RUNS));
}

export function newOnboardingRun(url: string, now = new Date().toISOString()): OnboardingRun {
  return { id: newId(), url, status: "running", steps: ONBOARDING_STEPS.map((id) => ({ id, status: "pending" })), createdAt: now, updatedAt: now };
}

/** Steps only move forward: a late or repeated report never reopens a finished step. */
export function applyStepProgress(run: OnboardingRun, progress: Omit<OnboardingProgress, "runId">, now = new Date().toISOString()): OnboardingRun {
  if (run.status !== "running") return run;
  const steps = run.steps.map((step) => {
    if (step.id !== progress.step || step.status === "done" || step.status === "failed") return step;
    if (progress.status === "running") return step.status === "running" ? step : { ...step, status: "running" as const, startedAt: now };
    return { ...step, status: progress.status, startedAt: step.startedAt ?? now, finishedAt: now, ...(progress.detail ? { detail: progress.detail } : {}) };
  });
  return { ...run, steps, updatedAt: now };
}

export function finishRun(run: OnboardingRun, outcome: { briefDigest: string } | { error: string }, now = new Date().toISOString()): OnboardingRun {
  if ("error" in outcome) {
    const steps = run.steps.map((step) => (step.status === "running" ? { ...step, status: "failed" as const, finishedAt: now } : step));
    return { ...run, steps, status: "failed", error: outcome.error.slice(0, 300), updatedAt: now, finishedAt: now };
  }
  const steps = run.steps.map((step) => (step.status === "done" ? step : { ...step, status: "done" as const, startedAt: step.startedAt ?? now, finishedAt: now }));
  return { ...run, steps, status: "done", briefDigest: outcome.briefDigest, updatedAt: now, finishedAt: now };
}

export async function createOnboardingRun(url: string): Promise<OnboardingRun> {
  const run = newOnboardingRun(url);
  await runs().doc(run.id).create(run);
  return run;
}

export async function updateOnboardingRun(runId: string, change: (run: OnboardingRun) => OnboardingRun): Promise<OnboardingRun | null> {
  const ref = runs().doc(runId);
  return db().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return null;
    const next = change(snap.data() as OnboardingRun);
    tx.set(ref, JSON.parse(JSON.stringify(next)));
    return next;
  });
}

export async function latestOnboardingRun(): Promise<OnboardingRun | null> {
  const snap = await runs().orderBy("createdAt", "desc").limit(1).get();
  return snap.empty ? null : (snap.docs[0].data() as OnboardingRun);
}

export async function getOnboardingRun(runId: string): Promise<OnboardingRun | null> {
  const snap = await runs().doc(runId).get();
  return snap.exists ? (snap.data() as OnboardingRun) : null;
}

/** Yield the run each time it changes until it finishes or the wait runs out. */
export async function* watchOnboardingRun(runId: string, options: { intervalMs?: number; timeoutMs?: number } = {}): AsyncGenerator<OnboardingRun> {
  const deadline = Date.now() + (options.timeoutMs ?? 300_000);
  let last = "";
  while (Date.now() < deadline) {
    const run = await getOnboardingRun(runId);
    if (!run) return;
    if (run.updatedAt !== last) {
      last = run.updatedAt;
      yield run;
    }
    if (run.status !== "running") return;
    await new Promise((resolve) => setTimeout(resolve, options.intervalMs ?? 1_500));
  }
}
