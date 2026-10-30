"use client";

const FLOW = [
  { key: "collect_sources", label: "Collect" },
  { key: "extract_sources", label: "Extract" },
  { key: "awaiting_source_resolution", label: "Resolve sources" },
  { key: "understand", label: "Understand" },
  { key: "strategize", label: "Strategy" },
  { key: "awaiting_strategy_approval", label: "Strategy approval" },
  { key: "plan", label: "Plan" },
  { key: "draft", label: "Draft" },
  { key: "awaiting_approval", label: "Approval" },
  { key: "publish", label: "Publish" },
  { key: "verify", label: "Verify" },
  { key: "learn", label: "Learn" },
] as const;

export default function PipelineStepper({
  stage,
  status,
}: {
  stage: string;
  status: string;
}) {
  const activeIdx = FLOW.findIndex((s) => s.key === stage);
  const done = status === "complete";

  return (
    <div className="flex items-center gap-0 overflow-x-auto pb-1">
      {FLOW.map((s, i) => {
        const isDone = done || (activeIdx > i && activeIdx !== -1);
        const isActive = !done && i === activeIdx && status !== "failed";
        const isFailedHere = status === "failed" && i === activeIdx;
        return (
          <div key={s.key} className="flex shrink-0 items-center">
            <div className="flex flex-col items-center gap-1">
              <div
                className={`flex h-6 w-6 items-center justify-center rounded-full border text-[10px] font-bold transition-all ${
                  isFailedHere
                    ? "border-red-500 bg-red-500 text-white"
                    : isDone
                      ? "border-emerald-500 bg-emerald-500 text-white"
                      : isActive
                        ? "border-blue-500 bg-blue-500 text-white shadow-[0_0_0_3px_rgba(59,130,246,0.25)]"
                        : (s.key === "awaiting_approval" || s.key === "awaiting_strategy_approval") && status === "waiting_for_approval"
                          ? "border-amber-500 bg-amber-500 text-white"
                          : "border-zinc-300 bg-zinc-100 text-zinc-400 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-500"
                }`}
              >
                {isFailedHere ? "!" : isDone ? "✓" : i + 1}
              </div>
              <span
                className={`text-[10px] font-medium uppercase tracking-wide ${
                  isActive
                    ? "text-blue-600 dark:text-blue-400"
                    : isFailedHere
                      ? "text-red-600 dark:text-red-400"
                      : isDone
                        ? "text-zinc-700 dark:text-zinc-300"
                        : "text-zinc-400 dark:text-zinc-600"
                }`}
              >
                {s.label}
              </span>
            </div>
            {i < FLOW.length - 1 && (
              <div
                className={`mx-1 mb-4 h-0.5 w-6 sm:w-9 ${
                  isDone || (isActive && false)
                    ? "bg-emerald-400"
                    : "bg-zinc-200 dark:bg-zinc-700"
                }`}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
