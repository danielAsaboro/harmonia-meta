import { describe, expect, it } from "vitest";
import { initialNotificationState, notificationLoadFailed, notificationLoadSucceeded } from "@/lib/dashboard/notificationState";

describe("notification state", () => {
  it("distinguishes loading, ready, and failed requests", () => {
    expect(initialNotificationState()).toEqual({ status: "loading" });
    expect(notificationLoadSucceeded([])).toEqual({ status: "ready", items: [] });
    expect(notificationLoadFailed(new Error("offline"))).toEqual({ status: "error", message: "offline" });
  });
});
