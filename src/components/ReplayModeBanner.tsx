export function ReplayModeBanner({ bundleId, capturedAt }: { bundleId: string; capturedAt: string }) {
  const date = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(capturedAt));
  return <aside role="status" aria-label="Replay mode disclosure" className="sticky top-0 z-[100] border-b border-amber-400 bg-amber-100 px-4 py-2 text-center text-xs font-semibold text-amber-950">
    Recorded authenticated run — replay mode · captured {date} · bundle <code>{bundleId}</code>. Historical replay is not fresh provider or deployment evidence.
  </aside>;
}
