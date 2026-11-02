import { afterEach, describe, expect, it, vi } from "vitest";

const NativeDate = globalThis.Date;
const originalOrigin = process.env.HARMONIA_TIME_ORIGIN;
const originalSpeed = process.env.HARMONIA_TIME_SPEED;

afterEach(() => {
  globalThis.Date = NativeDate;
  if (originalOrigin === undefined) delete process.env.HARMONIA_TIME_ORIGIN;
  else process.env.HARMONIA_TIME_ORIGIN = originalOrigin;
  if (originalSpeed === undefined) delete process.env.HARMONIA_TIME_SPEED;
  else process.env.HARMONIA_TIME_SPEED = originalSpeed;
  vi.resetModules();
});

describe("server clock", () => {
  it("advances Date.now and new Date from the pinned origin without recursion", async () => {
    process.env.HARMONIA_TIME_ORIGIN = "2026-08-27T12:00:00.000Z";
    process.env.HARMONIA_TIME_SPEED = "1";
    const { installServerClock } = await import("@/lib/serverClock");

    installServerClock();

    const now = Date.now();
    expect(now).toBeGreaterThanOrEqual(1_787_832_000_000);
    expect(now).toBeLessThan(1_787_832_005_000);
    expect(new Date().getTime()).toBeGreaterThanOrEqual(now);
    expect(Date()).toContain("Thu Aug 27 2026");
  });
});
