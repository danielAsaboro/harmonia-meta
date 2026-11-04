"use client";

import { useState, type FormEvent } from "react";
import { BriefSummary, type StoredBrief } from "@/components/onboarding/BriefSummary";
import { OnboardingStepper } from "@/components/onboarding/OnboardingStepper";
import type { OnboardingRun } from "@/lib/onboardingSteps";

interface WelcomeOnboardingProps {
  run: OnboardingRun | null;
  brief: StoredBrief | null;
  error: string | null;
  onStart: (url: string) => Promise<void>;
  onContinue: () => void;
}

/** First run: a website in, a cited brand brief out, then straight into the first job. */
export function WelcomeOnboarding({ run, brief, error, onStart, onContinue }: WelcomeOnboardingProps) {
  const [url, setUrl] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const phase = run?.status === "running" ? "running" : run?.status === "failed" ? "failed" : run?.status === "done" && brief ? "done" : "idle";

  async function submit(event?: FormEvent, target = url) {
    event?.preventDefault();
    if (!target.trim()) return;
    setSubmitting(true);
    try { await onStart(target.trim()); } finally { setSubmitting(false); }
  }

  return (
    <section className="flex min-h-dvh w-full items-start justify-center bg-[#c9c5bc] px-4 py-10 text-[#11110f] sm:py-16" data-onboarding={phase}>
      <div className="w-full max-w-[680px] rounded-[18px] border border-[#11110f] bg-[#f4f1ea] p-6 shadow-[4px_4px_0_#11110f] sm:p-8">
        {phase === "done" && brief ? (
          <>
            <h1 className="text-2xl font-semibold tracking-tight">Here&apos;s who you&apos;re writing for</h1>
            <div className="mt-5 max-h-[52vh] overflow-y-auto rounded-[12px] border border-black/10 bg-white p-4"><BriefSummary brief={brief} /></div>
            <button type="button" onClick={onContinue} className="mt-6 w-full rounded-full bg-[#11110f] px-5 py-3 text-sm font-semibold text-white transition hover:bg-black">
              Now send a YouTube link, a post or an idea
            </button>
          </>
        ) : phase === "running" || phase === "failed" ? (
          <>
            <h1 className="text-2xl font-semibold tracking-tight">{phase === "running" ? `Reading ${run?.url}` : `Couldn't finish ${run?.url}`}</h1>
            <div className="mt-6"><OnboardingStepper run={run!} /></div>
            {phase === "failed" ? (
              <div className="mt-6 rounded-[12px] border border-red-300 bg-red-50 p-4" role="alert">
                <p className="text-sm text-red-800">{run?.error ?? "Something went wrong."}</p>
                <button type="button" disabled={submitting} onClick={() => void submit(undefined, run?.url ?? url)} className="mt-3 rounded-full bg-[#11110f] px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">Try again</button>
              </div>
            ) : null}
          </>
        ) : (
          <>
            <h1 className="text-2xl font-semibold tracking-tight">Start with your website</h1>
            <form onSubmit={(event) => void submit(event)} className="mt-6 flex gap-2 rounded-[14px] border border-[#11110f] bg-white p-1.5 shadow-[3px_3px_0_#11110f]">
              <input autoFocus aria-label="Company website" value={url} onChange={(event) => setUrl(event.target.value)} placeholder="yourcompany.com" className="min-w-0 flex-1 bg-transparent px-2 text-base outline-none placeholder:text-black/35" />
              <button type="submit" disabled={!url.trim() || submitting} className="rounded-full bg-[#11110f] px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-30">{submitting ? "Starting…" : "Read my site"}</button>
            </form>
            {error ? <p className="mt-3 text-sm text-red-700" role="alert">{error}</p> : null}
            <button type="button" onClick={onContinue} className="mt-6 text-xs text-black/45 underline-offset-2 hover:underline">Skip for now</button>
          </>
        )}
      </div>
    </section>
  );
}
