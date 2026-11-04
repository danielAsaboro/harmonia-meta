import { ONBOARDING_STEP_LABELS, type OnboardingRun, type OnboardingStep } from "@/lib/onboardingSteps";

function seconds(step: OnboardingStep): string | null {
  if (!step.startedAt || !step.finishedAt) return null;
  const elapsed = (Date.parse(step.finishedAt) - Date.parse(step.startedAt)) / 1000;
  return Number.isFinite(elapsed) && elapsed >= 0 ? `${elapsed.toFixed(elapsed < 10 ? 1 : 0)}s` : null;
}

function Marker({ status }: { status: OnboardingStep["status"] }) {
  if (status === "running") return <span aria-hidden className="block h-4 w-4 animate-spin rounded-full border-2 border-[#11110f]/20 border-t-[#ff5c35] motion-reduce:animate-none" />;
  if (status === "done") return <span aria-hidden className="grid h-4 w-4 place-items-center rounded-full bg-[#11110f] text-[9px] font-bold text-[#d8ff3e]">✓</span>;
  if (status === "failed") return <span aria-hidden className="grid h-4 w-4 place-items-center rounded-full bg-red-600 text-[9px] font-bold text-white">!</span>;
  return <span aria-hidden className="block h-4 w-4 rounded-full border-2 border-[#11110f]/20" />;
}

/** One row per onboarding step; each detail appears as soon as the agent reports it. */
export function OnboardingStepper({ run }: { run: OnboardingRun }) {
  return (
    <ol className="space-y-3" aria-live="polite">
      {run.steps.map((step) => (
        <li key={step.id} className="flex gap-3" data-step={step.id} data-status={step.status}>
          <span className="mt-0.5 shrink-0"><Marker status={step.status} /></span>
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-2">
              <span className={`text-sm ${step.status === "pending" ? "text-black/40" : "font-medium text-[#11110f]"}`}>{ONBOARDING_STEP_LABELS[step.id]}</span>
              {seconds(step) ? <span className="ml-auto font-mono text-[11px] text-black/45">{seconds(step)}</span> : null}
            </div>
            {step.detail ? <p className="mt-0.5 text-[13px] leading-5 text-black/60">{step.detail}</p> : null}
          </div>
        </li>
      ))}
    </ol>
  );
}
