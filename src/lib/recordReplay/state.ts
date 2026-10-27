import { createHash } from "node:crypto";
import { canonicalJson } from "./integrity";
import type { ReplayEvent } from "./schema";

export interface ReplayTerminalState { lastSequence: number; stage?: string; status?: string; approvals: Record<string, string>; receipts: string[]; failures: Array<{ code: string; retryable: boolean }>; duplicateEffectsSuppressed: number; }
export function reduceReplayState(events: ReplayEvent[]): ReplayTerminalState {
  const state: ReplayTerminalState = { lastSequence: -1, approvals: {}, receipts: [], failures: [], duplicateEffectsSuppressed: 0 };
  for (const event of events) {
    state.lastSequence = event.sequence;
    if (event.kind === "stage_transition" || event.kind === "job_snapshot") { const payload = event.payload as { stage: string; status: string }; state.stage = payload.stage; state.status = payload.status; }
    if (event.kind === "approval") { const payload = event.payload as { actionId: string; decision: string }; state.approvals[payload.actionId] = payload.decision; }
    if (event.kind === "receipt") state.receipts.push((event.payload as { receiptId: string }).receiptId);
    if (event.kind === "failure") { const payload = event.payload as { code: string; retryable: boolean }; state.failures.push(payload); }
    if (event.kind === "effect_claim" && (event.payload as { outcome: string }).outcome === "already_applied") state.duplicateEffectsSuppressed += 1;
  }
  return state;
}
export function digestReplayState(state: ReplayTerminalState): string { return createHash("sha256").update(canonicalJson(state)).digest("hex"); }
