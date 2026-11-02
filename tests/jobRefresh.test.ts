import { afterEach, expect, it, vi } from "vitest";
import { startJobRefresh } from "@/lib/jobRefresh";

afterEach(() => vi.useRealTimers());

it("refreshes persisted state repeatedly without overlapping requests", async () => {
  vi.useFakeTimers();
  let finish!: () => void;
  const refresh = vi.fn((_signal: AbortSignal) => new Promise<void>((resolve) => { finish = resolve; }));
  const stop = startJobRefresh(refresh, vi.fn(), 50);
  await vi.advanceTimersByTimeAsync(200);
  expect(refresh).toHaveBeenCalledTimes(1);
  finish();
  await vi.advanceTimersByTimeAsync(50);
  expect(refresh).toHaveBeenCalledTimes(2);
  stop();
  expect(refresh.mock.calls[0][0].aborted).toBe(true);
  finish();
  await vi.advanceTimersByTimeAsync(200);
  expect(refresh).toHaveBeenCalledTimes(2);
});

it("reports read failures without losing subsequent refreshes", async () => {
  vi.useFakeTimers();
  const refresh = vi.fn().mockRejectedValueOnce(new Error("unavailable")).mockResolvedValue(undefined);
  const onError = vi.fn();
  const stop = startJobRefresh(refresh, onError, 50);
  await vi.advanceTimersByTimeAsync(100);
  expect(onError).toHaveBeenCalledTimes(1);
  expect(refresh).toHaveBeenCalledTimes(2);
  stop();
});

it("cancels before the first refresh on conversation change", async () => {
  vi.useFakeTimers();
  const refresh = vi.fn();
  startJobRefresh(refresh, vi.fn(), 50)();
  await vi.advanceTimersByTimeAsync(100);
  expect(refresh).not.toHaveBeenCalled();
});
