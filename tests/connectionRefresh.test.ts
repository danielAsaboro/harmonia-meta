import { describe, expect, it } from "vitest";
import { decideConnectionRefresh, getValidConnection, type ConnectionRefreshState } from "@/lib/connectionRefresh";

describe("connection refresh leases", () => {
  it("keeps a token fresh outside the refresh skew", () => {
    expect(decideConnectionRefresh({
      expiresAt: "2026-08-26T00:10:00.000Z",
      now: "2026-08-26T00:00:00.000Z",
      refreshSkewMs: 60_000,
    })).toEqual({ outcome: "fresh" });
  });

  it("grants one refresh owner for an expiring token", () => {
    expect(decideConnectionRefresh({
      expiresAt: "2026-08-26T00:00:30.000Z",
      now: "2026-08-26T00:00:00.000Z",
      refreshSkewMs: 60_000,
      claimId: "claim-a",
    })).toMatchObject({
      outcome: "refresh",
      state: { status: "claimed", claimId: "claim-a" },
    });
  });

  it("does not rotate while another live owner holds the lease", () => {
    const state: ConnectionRefreshState = {
      status: "claimed", claimId: "claim-a",
      claimedAt: "2026-08-26T00:00:00.000Z",
      expiresAt: "2026-08-26T00:02:00.000Z",
    };
    expect(decideConnectionRefresh({
      expiresAt: "2026-08-26T00:00:30.000Z",
      now: "2026-08-26T00:01:00.000Z",
      refreshSkewMs: 60_000,
      state,
      claimId: "claim-b",
    })).toEqual({ outcome: "in_progress", state });
  });

  it("quarantines an expired refresh lease instead of rotating again", () => {
    const state: ConnectionRefreshState = {
      status: "claimed", claimId: "claim-a",
      claimedAt: "2026-08-26T00:00:00.000Z",
      expiresAt: "2026-08-26T00:02:00.000Z",
    };
    expect(decideConnectionRefresh({
      expiresAt: "2026-08-26T00:00:30.000Z",
      now: "2026-08-26T00:03:00.000Z",
      refreshSkewMs: 60_000,
      state,
      claimId: "claim-b",
    })).toMatchObject({ outcome: "uncertain", state: { status: "uncertain", claimId: "claim-a" } });
  });
});

describe("valid connection orchestration", () => {
  it("persists a rotated refresh token before returning it", async () => {
    const completed: unknown[] = [];
    const connection = { platform: "x", mode: "oauth" as const, accessToken: "old-access", refreshToken: "old-refresh", expiresAt: "2026-08-26T00:00:00.000Z", connectedAt: "2026-08-25T00:00:00.000Z" };
    const result = await getValidConnection("x", {
      claim: async () => ({ outcome: "refresh" as const, claimId: "claim-1", connection }),
      refresh: async () => ({ accessToken: "new-access", refreshToken: "new-refresh", expiresInSeconds: 3600 }),
      complete: async (...args) => { completed.push(args); },
      markUncertain: async () => { throw new Error("should not quarantine"); },
      now: () => new Date("2026-08-26T00:00:00.000Z"),
    });
    expect(result).toMatchObject({ accessToken: "new-access", refreshToken: "new-refresh", expiresAt: "2026-08-26T01:00:00.000Z" });
    expect(completed).toHaveLength(1);
  });

  it("quarantines an ambiguous refresh failure", async () => {
    const uncertain: unknown[] = [];
    const connection = { platform: "x", mode: "oauth" as const, accessToken: "old-access", refreshToken: "old-refresh", expiresAt: "2026-08-26T00:00:00.000Z", connectedAt: "2026-08-25T00:00:00.000Z" };
    await expect(getValidConnection("x", {
      claim: async () => ({ outcome: "refresh" as const, claimId: "claim-1", connection }),
      refresh: async () => { throw new DOMException("timeout", "TimeoutError"); },
      complete: async () => { throw new Error("should not complete"); },
      markUncertain: async (...args) => { uncertain.push(args); },
      now: () => new Date("2026-08-26T00:00:00.000Z"),
    })).rejects.toThrow("connection refresh failed");
    expect(uncertain).toHaveLength(1);
  });
});
