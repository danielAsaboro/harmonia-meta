import type { Stage } from "@/lib/types";

export type OperatorStatusKind = "working" | "needs_information" | "needs_approval" | "blocked" | "complete";

export interface OperatorStatus {
  kind: OperatorStatusKind;
  label: "Working" | "Needs information" | "Needs approval" | "Blocked" | "Complete";
  headline: string;
  detail: string;
}

const workingDetails: Partial<Record<Stage, string>> = {
  queued: "Your job is queued and will start shortly.",
  collect_sources: "Collecting the sources you selected.",
  extract_sources: "Preparing your source material for analysis.",
  understand: "Finding useful moments, themes, and evidence.",
  strategize: "Turning the source material into a content direction.",
  plan: "Building the editorial plan and production sequence.",
  draft: "Creating platform-ready drafts and media briefs.",
  publish: "Carrying out only the actions you approved.",
  verify: "Checking the result against persisted receipts.",
  learn: "Recording outcomes and useful campaign learnings.",
};

export function operatorStatusForJob(input: { stage: Stage; status: string; failed?: boolean; reviewCount?: number }): OperatorStatus {
  if (input.failed || input.status === "failed" || input.stage === "failed") {
    return { kind: "blocked", label: "Blocked", headline: "This job needs attention", detail: "Your saved work is still here. Review the interruption below before continuing." };
  }
  if (input.stage === "awaiting_source_resolution") {
    return { kind: "needs_information", label: "Needs information", headline: "A source needs your input", detail: "Choose a recovery option so Harmonia can continue with the right material." };
  }
  if (input.status === "waiting_for_approval" || input.stage === "awaiting_strategy_approval" || input.stage === "awaiting_approval") {
    const count = Math.max(1, input.reviewCount ?? 1);
    return { kind: "needs_approval", label: "Needs approval", headline: count === 1 ? "One decision is waiting for you" : `${count} decisions are waiting for you`, detail: "Nothing with external impact will happen until you review and decide." };
  }
  if (input.status === "complete" || input.stage === "complete") {
    return { kind: "complete", label: "Complete", headline: "This content job is complete", detail: "Open an artifact below, or inspect the audit trail for verification details." };
  }
  return { kind: "working", label: "Working", headline: "Harmonia is building your content", detail: workingDetails[input.stage] ?? "The job is moving through its next saved step." };
}
