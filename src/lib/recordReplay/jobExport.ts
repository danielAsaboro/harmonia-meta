import type { ContentArtifact } from "@/lib/contentArtifacts/contracts";
import { contentArtifactPreview } from "@/lib/contentArtifacts/presentation";
import type { Job, PlannedAction, Receipt, StageEvent, UsageRecord, VerificationResult } from "@/lib/types";

// Turns one persisted job into replay observations for `recordAuthenticatedRun`.
// Only allowlisted fields leave Firestore; the sanitizer re-checks every one.

type ExportEvent = Omit<StageEvent, "at"> & { at: string | null };

export interface JobExportInput {
  job: Job & { actions?: PlannedAction[]; contentArtifacts?: ContentArtifact[]; verifications?: VerificationResult[] };
  events: ExportEvent[];
  usage: UsageRecord[];
  receipts: Receipt[];
}

interface Observation { sequence: number; capturedAt: string; offsetMs: number; kind: string; payload: Record<string, unknown> }

export function jobObservations({ job, events, usage, receipts }: JobExportInput): Observation[] {
  const timed: { at: string; kind: string; payload: Record<string, unknown> }[] = [];
  const jobId = job.id;
  let lastStage = "";
  for (const event of events) {
    if (!event.at) continue;
    if (event.stage !== lastStage) {
      timed.push({ at: event.at, kind: "stage_transition", payload: { jobId, stage: event.stage, status: "running", traceId: event.traceId } });
      lastStage = event.stage;
    }
    const activity = event.activity;
    if (activity?.kind === "handoff" && activity.fromRole && activity.toRole) {
      timed.push({ at: event.at, kind: "specialist_handoff", payload: { jobId, from: activity.fromRole, to: activity.toRole, summary: activity.publicMessage, traceId: event.traceId } });
    } else if (activity) {
      timed.push({ at: event.at, kind: "activity_summary", payload: { jobId, specialist: activity.role, summary: activity.publicMessage, status: activity.status, traceId: event.traceId } });
    }
  }
  // Moments exist once Nimi hands its analysis on; fall back to the stage's first event.
  const analysedAt = events.find((event) => event.at && event.activity?.kind === "handoff" && event.activity.fromRole === "nimi_analyst")?.at
    ?? events.find((event) => event.stage === "understand" && event.at)?.at ?? job.createdAt;
  for (const moment of job.sourceAnalysis?.moments ?? []) {
    timed.push({ at: analysedAt, kind: "moment", payload: { jobId, momentId: moment.id, title: moment.title, startSec: moment.startSec, endSec: moment.endSec } });
  }
  for (const artifact of job.contentArtifacts ?? []) {
    timed.push({ at: job.updatedAt, kind: "draft", payload: { jobId, draftId: artifact.id, platform: artifact.payload.kind, text: contentArtifactPreview(artifact).slice(0, 20000), valid: true } });
  }
  for (const action of job.actions ?? []) {
    timed.push({ at: job.updatedAt, kind: "action", payload: { jobId, actionId: action.id, actionType: action.type, state: action.state } });
    if (action.approvalState === "approved" || action.approvalState === "rejected" || action.approvalState === "pending") {
      timed.push({ at: job.updatedAt, kind: "approval", payload: { jobId, actionId: action.id, decision: action.approvalState } });
    }
  }
  for (const record of usage) {
    // Audio seconds and video frames carry their cost with zero token counts.
    const tokens = record.unitType === "tokens";
    timed.push({ at: record.createdAt, kind: "usage", payload: { jobId, model: record.model, inputTokens: tokens ? record.inputUnits : 0, outputTokens: tokens ? record.outputUnits : 0, estimatedCostUsd: Number(record.observedCostUsd ?? record.estimatedCostUsd), traceId: record.traceId } });
  }
  const verifications = new Map((job.verifications ?? []).map((item) => [item.receiptId, item]));
  for (const receipt of receipts) {
    const verification = verifications.get(receipt.id);
    timed.push({ at: receipt.performedAt, kind: "receipt", payload: { jobId, receiptId: receipt.id, actionId: receipt.actionId, outcome: receipt.outcome, verified: verification?.verified === true, traceId: receipt.traceId } });
    const critique = (receipt.detail ?? {}).critique as { score?: number; previousScore?: number; model?: string } | undefined;
    if (critique && typeof critique.score === "number") {
      const summary = typeof critique.previousScore === "number"
        ? `${critique.model ?? "Muse Spark"} blind score ${critique.previousScore}/100, re-cut, then ${critique.score}/100`
        : `${critique.model ?? "Muse Spark"} blind score ${critique.score}/100`;
      timed.push({ at: receipt.performedAt, kind: "activity_summary", payload: { jobId, specialist: "clip_critic", summary, status: "succeeded", traceId: receipt.traceId } });
    }
    if (verification) {
      timed.push({ at: verification.checkedAt, kind: "verification", payload: { jobId, receiptId: receipt.id, verified: verification.verified, method: verification.method, traceId: verification.traceId } });
    }
  }
  timed.push({ at: job.updatedAt, kind: "job_snapshot", payload: { jobId, stage: job.stage, status: job.status } });

  const ordered = timed
    .map((item, index) => ({ ...item, ms: Date.parse(item.at), index }))
    .filter((item) => Number.isFinite(item.ms))
    .sort((a, b) => a.ms - b.ms || a.index - b.index);
  const start = ordered[0]?.ms ?? Date.parse(job.createdAt);
  return ordered.map((item, sequence) => ({
    sequence, capturedAt: new Date(item.ms).toISOString(), offsetMs: Math.max(item.ms - start, 0), kind: item.kind,
    payload: Object.fromEntries(Object.entries(item.payload).filter(([, value]) => value !== undefined && value !== "")),
  }));
}
