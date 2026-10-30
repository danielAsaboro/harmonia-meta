import type { ChatRunState } from "@/lib/a2ui/chatReducer";
import { ActivityTrace, ToolActivity } from "@/components/a2ui/HarmoniaElements";
import { StudioFailure } from "./StudioStates";

export function AgentRunSummary({ run }: { run: ChatRunState }) {
  const label = run.status === "running" ? "Harmonia is working" : run.status === "failed" ? "Agent run failed" : "Agent run complete";
  const totalDuration = run.tools.reduce((sum, tool) => sum + (tool.durationMs ?? 0), 0);
  return (
    <details open={run.status !== "complete"} className="group w-full rounded-[14px] bg-[#171714] px-3 py-2.5 text-white">
      <summary className="flex cursor-pointer list-none items-center gap-2 text-[9px] font-bold">
        <span className={`h-2 w-2 rounded-full ${run.status === "running" ? "animate-pulse bg-[#ff5c35] motion-reduce:animate-none" : run.status === "failed" ? "bg-red-600" : "bg-[#3157ff]"}`} />
        {label}
        {totalDuration > 0 ? <span className="ml-auto font-mono text-[7px] font-medium tracking-normal text-[#d8ff3e]">{(totalDuration / 1000).toFixed(1)}s</span> : null}
      </summary>
      <div className="mt-3 space-y-2">
        {run.activities.length > 0 ? <ActivityTrace title="Activity summary" steps={run.activities} /> : null}
        {run.tools.map((tool, index) => <ToolActivity key={`${tool.traceId ?? tool.name}-${index}`} {...tool} />)}
        {run.error ? <StudioFailure message={run.error} permanent={run.permanent} /> : null}
      </div>
    </details>
  );
}
