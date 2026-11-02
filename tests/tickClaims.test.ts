import { describe, expect, it } from "vitest";
import { decideTickClaim } from "@/lib/tickClaims";

const now = new Date("2026-08-26T00:00:00Z");

describe("durable tick claims", () => {
  it("allows one owner and rejects duplicate or concurrent live claims", () => {
    const owner = decideTickClaim(null, "minute-1", 55, now);
    expect(owner.claimed).toBe(true);
    if (!owner.claimed) throw new Error("expected claim");
    expect(decideTickClaim(owner.state, "minute-1", 55, now)).toEqual({ claimed: false });
    expect(decideTickClaim(owner.state, "other", 55, now)).toEqual({ claimed: false });
  });

  it("permits a later claim only after lease expiry", () => {
    const prior = {
      claimId: "minute-1", claimedAt: "2026-08-25T23:59:00Z", leaseUntil: "2026-08-25T23:59:55Z",
    };
    expect(decideTickClaim(prior, "minute-2", 55, now)).toMatchObject({ claimed: true });
  });
});
