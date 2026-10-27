/** Poll persisted job state serially; cancellation also aborts the active read. */
export function startJobRefresh(
  refresh: (signal: AbortSignal) => Promise<void>,
  onError: (error: unknown) => void,
  intervalMs = 5000,
): () => void {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout>;
  const tick = async () => {
    try { await refresh(controller.signal); }
    catch (error) { if (!controller.signal.aborted) onError(error); }
    finally { if (!controller.signal.aborted) timer = setTimeout(tick, intervalMs); }
  };
  timer = setTimeout(tick, intervalMs);
  return () => { controller.abort(); clearTimeout(timer); };
}
