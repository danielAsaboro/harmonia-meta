import { describe, expect, it, vi } from "vitest";
import { disconnectConnection } from "@/lib/connectionDisconnect";

const connection = {
  platform: "x",
  mode: "oauth" as const,
  accessToken: "access-token",
  refreshToken: "refresh-token",
  connectedAt: "2026-08-28T00:00:00.000Z",
};

describe("connection disconnect", () => {
  it("revokes the provider grant before deleting local credentials", async () => {
    const order: string[] = [];
    await disconnectConnection("x", {
      get: async () => connection,
      revoke: async () => { order.push("revoke"); },
      remove: async () => { order.push("remove"); },
    });
    expect(order).toEqual(["revoke", "remove"]);
  });

  it("retains local credentials when provider revocation fails", async () => {
    const remove = vi.fn();
    await expect(disconnectConnection("x", {
      get: async () => connection,
      revoke: async () => { throw new Error("provider unavailable"); },
      remove,
    })).rejects.toThrow("provider unavailable");
    expect(remove).not.toHaveBeenCalled();
  });

  it("treats an already absent connection as idempotently disconnected", async () => {
    const revoke = vi.fn();
    const remove = vi.fn();
    await disconnectConnection("x", { get: async () => null, revoke, remove });
    expect(revoke).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });
});
