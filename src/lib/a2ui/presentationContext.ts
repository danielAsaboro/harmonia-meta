import type { ChatResponse } from "@/app/api/chat/route";
import type { JobFull, Receipt } from "@/components/jobTypes";
import { uiContextSchema, type UiContext } from "./presentationContracts";

interface BuildUiContextInput {
  runId: string;
  message: string;
  response: ChatResponse;
  job?: JobFull | null;
  receipts: Receipt[];
}

function mediaKind(mime: string): "image" | "video" | "audio" | "document" | "other" {
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  if (mime === "application/pdf" || mime.startsWith("text/")) return "document";
  return "other";
}

function sourceKind(job: JobFull): "video" | "audio" | "document" | "web" | "text" | "mixed" {
  const kinds = new Set((job.normalizedSources ?? []).map((source) => source.sourceKind));
  if (kinds.size !== 1) return "mixed";
  return [...kinds][0] ?? "mixed";
}

function receiptIsVerified(job: JobFull, receipt: Receipt): boolean {
  return (job.verifications ?? []).some((verification) => {
    const candidate = verification as typeof verification & { actionId?: string };
    return verification.verified && (
      candidate.actionId === receipt.actionId
      || Boolean(receipt.artifact?.digest && verification.evidence.digest === receipt.artifact.digest)
    );
  });
}

export function buildUiContext(input: BuildUiContextInput): UiContext {
  const { job, response } = input;
  const responseJob = response.job;
  const actions = job
    ? job.actions.slice(0, 20).map((action) => ({
      id: action.id,
      type: action.type,
      pending: action.approvalState === "pending" && action.state === "planned",
    }))
    : (response.pendingActions ?? []).slice(0, 20).map((action) => ({
      id: action.id,
      type: action.type,
      pending: true,
    }));
  const sources = job ? (job.normalizedSources ?? []).flatMap((source) => [
    { id: source.sourceId, kind: source.sourceKind, label: source.title.slice(0, 300) },
    ...source.segments.slice(0, 8).map((segment) => ({ id: `${source.sourceId}:${segment.id}`, kind: "segment" as const, label: `${segment.locator.kind} · ${segment.id}` })),
  ]).slice(0, 50) : [];

  return uiContextSchema.parse({
    runId: input.runId,
    operatorRequest: input.message,
    intent: response.intent,
    job: job ? {
      id: job.id,
      stage: job.stage,
      status: job.status,
      ...(job.sourceAnalysis?.summary ? { title: job.sourceAnalysis.summary.slice(0, 300) } : {}),
      sourceKind: sourceKind(job),
    } : responseJob ? {
      id: responseJob.id,
      stage: responseJob.stage,
      status: responseJob.status,
      ...(responseJob.title ? { title: responseJob.title.slice(0, 300) } : {}),
      sourceKind: "mixed" as const,
    } : null,
    drafts: (job?.contentArtifacts ?? response.artifacts ?? []).slice(0, 20).map((artifact) => ({
      id: artifact.id,
      platform: artifact.outputType,
      valid: true,
    })),
    moments: (job?.sourceAnalysis?.moments ?? []).slice(0, 20).map((moment) => ({
      id: moment.id,
      title: moment.title.slice(0, 300),
      startSec: moment.startSec,
      endSec: moment.endSec,
    })),
    sources,
    assets: (job?.assets ?? response.assets ?? []).slice(0, 20).map((asset) => ({
      actionId: asset.actionId,
      kind: mediaKind(asset.mime),
      mime: asset.mime,
    })),
    actions,
    receipts: input.receipts.slice(0, 20).map((receipt) => ({
      id: receipt.id,
      actionId: receipt.actionId,
      outcome: receipt.outcome,
      verified: job ? receiptIsVerified(job, receipt) : false,
    })),
  });
}
