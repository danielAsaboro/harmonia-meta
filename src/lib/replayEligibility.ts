import type { EffectClaimSummary, PlannedAction, Receipt } from "./types";

export function isReplayableAction(
  action: PlannedAction,
  receipts: Receipt[],
  claims: EffectClaimSummary[],
): boolean {
  if (action.state !== "executed") return false;
  const receipt = receipts.find((candidate) => candidate.actionId === action.id && candidate.outcome === "applied");
  if (!receipt) return false;
  return claims.some((claim) =>
    claim.actionId === action.id
    && claim.state === "applied"
    && claim.receiptId === receipt.id
    && claim.idempotencyKey === receipt.idempotencyKey
    && Boolean(claim.finalizedAt)
  );
}
