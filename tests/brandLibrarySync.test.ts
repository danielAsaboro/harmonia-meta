import { describe, expect, it } from "vitest";
import { classifyLibrarySyncFailure, isSyncDue, nextSyncAt } from "@/lib/brandLibraries/sync";
const connection = { cadence: "six_hours" as const, updatedAt: "2026-08-30T00:00:00Z" };
describe("brand library cadence", () => {
  it.each([
    ["Google Drive file version changed; retry synchronization", "transient"],
    ["connection refresh is already in progress", "transient"],
    ["connection refresh outcome is uncertain; reconnect before use", "reconnection_required"],
    ["connection refresh failed and was quarantined", "reconnection_required"],
    ["google-drive connection not found", "reconnection_required"],
  ])("classifies %s without destroying retry/reconnection recovery", (message, category) => {
    expect(classifyLibrarySyncFailure(new Error(message), 1).category).toBe(category);
  });
  it("defaults the next six-hour checkpoint exactly", () => expect(nextSyncAt(connection)).toBe("2026-08-30T06:00:00.000Z"));
  it("becomes due at the checkpoint", () => expect(isSyncDue(connection, "2026-08-30T06:00:00Z")).toBe(true));
  it("never schedules paused libraries", () => expect(nextSyncAt({ ...connection, cadence: "paused" })).toBeNull());
  it("backs off transient failures exponentially", () => expect(classifyLibrarySyncFailure(new Error("503 unavailable"), 3, new Date("2026-08-30T00:00:00Z"))).toMatchObject({ category: "transient", retryCount: 3, nextEligibleRetryAt: "2026-08-30T00:08:00.000Z" }));
  it("suppresses reconnection and permanent failures", () => {
    expect(isSyncDue({ ...connection, lastSyncStatus: "reconnection_required" }, "2026-08-31T00:00:00Z")).toBe(false);
    expect(isSyncDue({ ...connection, lastSyncStatus: "permanent_failure" }, "2026-08-31T00:00:00Z")).toBe(false);
    expect(classifyLibrarySyncFailure(new Error("credential 401"), 1).category).toBe("reconnection_required");
    expect(classifyLibrarySyncFailure(new Error("unsupported archive"), 1).category).toBe("permanent");
  });
});
