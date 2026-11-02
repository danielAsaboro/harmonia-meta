import { describe, expect, test, vi } from "vitest";
import {
  establishPersistedIdentity,
  restorePersistedSession,
  signOutPersistedSession,
  shouldRestorePersistedSession,
} from "../src/lib/sessionPersistence";

describe("browser session persistence", () => {
  test("enables durable Firebase storage before opening interactive Google sign-in", async () => {
    const effects: string[] = [];
    const user = { getIdToken: async () => "token" };

    await expect(establishPersistedIdentity(
      async () => { effects.push("persist"); },
      async () => { effects.push("popup"); return user; },
    )).resolves.toBe(user);
    expect(effects).toEqual(["persist", "popup"]);
  });

  test("silently restores a Firebase identity whose last real sign-in is less than 30 days old", () => {
    expect(shouldRestorePersistedSession("2026-08-01T12:00:00.000Z", new Date("2026-08-30T11:59:59.000Z"))).toBe(true);
  });

  test("requires Google sign-in again once the last real sign-in is 30 days old", () => {
    expect(shouldRestorePersistedSession("2026-08-01T12:00:00.000Z", new Date("2026-08-31T12:00:00.000Z"))).toBe(false);
    expect(shouldRestorePersistedSession(undefined, new Date("2026-08-02T12:00:00.000Z"))).toBe(false);
  });

  test("renews the secure server session without opening another Google popup", async () => {
    const createServerSession = vi.fn().mockResolvedValue(true);
    const getIdToken = vi.fn().mockResolvedValue("fresh-id-token");

    await expect(restorePersistedSession({ getIdToken }, createServerSession)).resolves.toBe(true);
    expect(getIdToken).toHaveBeenCalledOnce();
    expect(createServerSession).toHaveBeenCalledWith("fresh-id-token");
  });

  test("explicit logout clears Firebase identity before clearing the server cookie", async () => {
    const effects: string[] = [];
    await signOutPersistedSession(
      async () => { effects.push("firebase"); },
      async () => { effects.push("server"); },
    );

    expect(effects).toEqual(["firebase", "server"]);
  });
});
