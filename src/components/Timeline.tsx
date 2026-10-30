"use client";

export interface TimelineEvent {
  at: string | null;
  stage: string;
  message: string;
  actor: string;
  operationId?: string;
  traceId?: string;
}

const ACTOR_STYLES: Record<string, string> = {
  operator: "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200",
  agent: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  system: "bg-zinc-200 text-zinc-700 dark:bg-zinc-700 dark:text-zinc-300",
};

export default function Timeline({ events }: { events: TimelineEvent[] }) {
  const rows = [...events].reverse();
  return (
    <ol className="flex max-h-72 flex-col gap-0 overflow-y-auto">
      {rows.length === 0 && (
        <li className="py-6 text-center text-sm text-zinc-400">waiting for worker…</li>
      )}
      {rows.map((e, i) => (
        <li key={i} className="relative flex gap-3 pb-3 pl-1 last:pb-0">
          {i < rows.length - 1 && (
            <span className="absolute left-[7px] top-4 h-full w-px bg-zinc-200 dark:bg-zinc-700" />
          )}
          <span
            className={`z-10 mt-1.5 h-[9px] w-[9px] shrink-0 rounded-full ring-2 ring-white dark:ring-zinc-900 ${
              e.actor === "operator"
                ? "bg-amber-500"
                : e.actor === "agent"
                  ? "bg-blue-500"
                  : "bg-zinc-400"
            }`}
          />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-zinc-400 dark:text-zinc-500">
              <span className="font-mono">{e.at ? new Date(e.at).toLocaleTimeString() : "…"}</span>
              <span className={`rounded px-1.5 py-px font-sans font-semibold uppercase tracking-wide ${ACTOR_STYLES[e.actor] ?? ACTOR_STYLES.system}`}>
                {e.actor}
              </span>
              <span className="rounded bg-zinc-100 px-1.5 py-px font-mono uppercase dark:bg-zinc-800">{e.stage}</span>
            </div>
            <p className="mt-0.5 break-words text-sm leading-5 text-zinc-700 dark:text-zinc-300">{e.message}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}
