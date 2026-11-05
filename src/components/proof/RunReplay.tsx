"use client";

import { useEffect, useMemo, useRef, useState } from "react";

export interface ReplayStepView { offsetMs: number; kind: string; payload: Record<string, unknown> }

const SPEEDS = [30, 60, 240] as const;

function clock(ms: number) {
  const total = Math.floor(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

function text(value: unknown) {
  return typeof value === "string" ? value : String(value ?? "");
}

export function describeStep(step: ReplayStepView): { label: string; body?: string; tone: "stage" | "agent" | "model" | "human" | "effect" | "other" } {
  const p = step.payload;
  switch (step.kind) {
    case "stage_transition": return { label: `Stage: ${text(p.stage).replaceAll("_", " ")} (${text(p.status)})`, tone: "stage" };
    case "specialist_handoff": return { label: `${text(p.from)} → ${text(p.to)}`, body: text(p.summary), tone: "agent" };
    case "activity_summary": return { label: text(p.specialist).replaceAll("_", " "), body: text(p.summary), tone: "agent" };
    case "usage": {
      const tokens = Number(p.inputTokens) + Number(p.outputTokens);
      return { label: `${text(p.model)} call`, body: `${tokens ? `${tokens.toLocaleString()} tokens, ` : ""}$${Number(p.estimatedCostUsd).toFixed(4)}`, tone: "model" };
    }
    case "moment": return { label: `Moment found: ${text(p.title)}`, body: `${Number(p.startSec).toFixed(1)}–${Number(p.endSec).toFixed(1)} s in the source`, tone: "agent" };
    case "draft": return { label: `Draft for ${text(p.platform)}${p.valid ? "" : " (failed validation)"}`, body: text(p.text), tone: "agent" };
    case "action": return { label: `Action ${text(p.actionType).replaceAll("_", " ")}: ${text(p.state)}`, tone: "effect" };
    case "approval": return { label: `Operator ${text(p.decision)} ${text(p.actionId)}`, tone: "human" };
    case "receipt": return { label: `Receipt: ${text(p.outcome)}${p.verified ? ", verified" : ""}`, tone: "effect" };
    case "verification": return { label: `Independent check ${p.verified ? "passed" : "failed"}`, body: text(p.method), tone: "effect" };
    case "failure": return { label: `Failure: ${text(p.code)}`, body: text(p.message), tone: "other" };
    default: return { label: step.kind.replaceAll("_", " "), tone: "other" };
  }
}

const TONE: Record<string, string> = {
  stage: "border-slate-400 bg-slate-50", agent: "border-indigo-300 bg-white", model: "border-slate-200 bg-white",
  human: "border-emerald-400 bg-emerald-50", effect: "border-amber-400 bg-amber-50", other: "border-slate-200 bg-white",
};

export function RunReplay({ steps, durationMs }: { steps: ReplayStepView[]; durationMs: number }) {
  const [elapsed, setElapsed] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(60);
  const last = useRef<number | null>(null);

  useEffect(() => {
    if (!playing) { last.current = null; return; }
    let frame = 0;
    const tick = (now: number) => {
      const delta = last.current === null ? 0 : now - last.current;
      last.current = now;
      setElapsed((value) => {
        const next = Math.min(durationMs, value + delta * speed);
        if (next >= durationMs) setPlaying(false);
        return next;
      });
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, speed, durationMs]);

  const shown = useMemo(() => steps.filter((step) => step.offsetMs <= elapsed), [steps, elapsed]);
  const spent = shown.filter((step) => step.kind === "usage").reduce((total, step) => total + Number(step.payload.estimatedCostUsd), 0);
  const calls = shown.filter((step) => step.kind === "usage").length;
  const stage = [...shown].reverse().find((step) => step.kind === "stage_transition");

  return (
    <section className="mt-8">
      <div className="sticky top-0 z-10 flex flex-wrap items-center gap-3 border-b border-slate-200 bg-[#f5f4ef]/95 py-3 text-sm backdrop-blur">
        <button type="button" onClick={() => { if (elapsed >= durationMs) setElapsed(0); setPlaying(!playing); }}
          className="rounded-md bg-slate-950 px-4 py-1.5 font-semibold text-white">{playing ? "Pause" : elapsed >= durationMs ? "Replay" : elapsed > 0 ? "Resume" : "Play"}</button>
        <button type="button" onClick={() => { setPlaying(false); setElapsed(durationMs); }} className="rounded-md border border-slate-300 px-3 py-1.5">Show all</button>
        <label className="flex items-center gap-1 text-slate-600">Speed
          <select value={speed} onChange={(event) => setSpeed(Number(event.target.value) as (typeof SPEEDS)[number])} className="rounded border border-slate-300 bg-white px-1 py-0.5">
            {SPEEDS.map((value) => <option key={value} value={value}>{value}×</option>)}
          </select>
        </label>
        <span className="font-mono text-slate-700" aria-live="off">{clock(elapsed)} / {clock(durationMs)}</span>
        <span className="text-slate-600">{stage ? text(stage.payload.stage).replaceAll("_", " ") : "not started"}</span>
        <span className="ml-auto text-slate-700">{calls} Meta calls · ${spent.toFixed(3)}</span>
      </div>
      <div className="mt-1 h-1 w-full bg-slate-200"><div className="h-1 bg-slate-900" style={{ width: `${durationMs ? (elapsed / durationMs) * 100 : 0}%` }} /></div>
      {shown.length === 0 && <p className="mt-6 text-sm text-slate-500">Press Play to watch the run unfold at {speed}× real time, or Show all to read it at once.</p>}
      <ol className="mt-4 space-y-2">
        {shown.map((step, index) => {
          const view = describeStep(step);
          return (
            <li key={index} className={`rounded-md border-l-4 px-3 py-2 text-sm ${TONE[view.tone]}`}>
              <div className="flex gap-3"><span className="w-12 shrink-0 font-mono text-xs text-slate-500">{clock(step.offsetMs)}</span><span className="font-medium text-slate-900">{view.label}</span></div>
              {view.body && <p className="mt-1 whitespace-pre-wrap pl-15 text-slate-700" style={{ paddingLeft: "3.75rem" }}>{view.body}</p>}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
