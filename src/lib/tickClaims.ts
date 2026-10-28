export interface TickClaimState {
  claimId: string;
  claimedAt: string;
  leaseUntil: string;
}

export function decideTickClaim(
  current: TickClaimState | null,
  claimId: string,
  leaseSeconds: number,
  now: Date,
): { claimed: false } | { claimed: true; state: TickClaimState } {
  if (current) {
    const leaseUntil = Date.parse(current.leaseUntil);
    if (!Number.isFinite(leaseUntil)) throw new Error("tick claim lease is invalid");
    if (current.claimId === claimId || leaseUntil > now.getTime()) return { claimed: false };
  }
  return {
    claimed: true,
    state: {
      claimId,
      claimedAt: now.toISOString(),
      leaseUntil: new Date(now.getTime() + leaseSeconds * 1000).toISOString(),
    },
  };
}
