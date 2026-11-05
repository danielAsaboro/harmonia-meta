import type { Metadata } from "next";
import Link from "next/link";
import {
  concurrentGroups, loadBrandBrief, loadMetaStatus, loadNarratedVideo, loadProbeReport, loadPublicRuns, loadRoster, loadScreenEval,
  type BrandBriefEvidence, type Loaded, type NarratedVideoEvidence, type RunSummary,
} from "@/lib/proof";

const REPO_URL = "https://github.com/danielAsaboro/harmonia-meta";
const DEMO_VIDEO_URL = "https://www.youtube.com/watch?v=Mfrmh9ZC62I";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Proof — Harmonia",
  description: "Live Meta Model API status, recorded calls, the running agent team, and integrity-checked recorded runs.",
};

function Missing({ reason }: { reason: string }) {
  return <p className="mt-3 rounded-md border border-dashed border-slate-300 px-4 py-3 text-sm text-slate-500">{reason}</p>;
}

function Section({ id, title, children }: { id?: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-6 border-t border-slate-200 py-8">
      <h2 className="text-lg font-semibold text-slate-950">{title}</h2>
      {children}
    </section>
  );
}

function short(digest: string) {
  return <code className="font-mono text-xs text-slate-500" title={digest}>{digest.slice(0, 12)}</code>;
}

function usd(value: number) {
  return `$${value.toFixed(value < 0.01 ? 4 : 2)}`;
}

function BrandBrief({ value }: { value: BrandBriefEvidence }) {
  const searches = value.modelCalls.reduce((total, call) => total + call.searchCalls, 0);
  const costByStep = new Map(value.receipt?.calls.map((call) => [call.step, call.costUsd]) ?? []);
  return (
    <>
      <p className="mt-2 text-sm text-slate-600">
        Harmonia read {value.pages.length} pages of <a className="underline" href={value.website}>{value.website}</a> ({value.pages.map((page) => page.role).join(", ")}),
        ran {searches} Meta web searches for competitors and customer complaints, and wrote this brief in {Math.round(value.elapsedSeconds)} s
        {value.receipt ? <> for {usd(value.receipt.totalUsd)} at Meta list price</> : null}. {value.unverifiedResearchDropped} research items that Meta&apos;s search did not return were dropped.
      </p>
      <p className="mt-4 text-sm text-slate-800"><span className="font-medium">{value.brief.company}:</span> {value.brief.positioning}</p>
      <h3 className="mt-5 text-sm font-semibold text-slate-950">Customer pain, in customers&apos; words</h3>
      <ul className="mt-2 space-y-2 text-sm text-slate-700">
        {value.research.painSignals.map((signal, index) => (
          <li key={index}>&ldquo;{signal.supportedText.replace(/^["“\s]+|["”\s]+$/g, "")}&rdquo; <a className="text-xs text-slate-500 underline" href={signal.url}>{signal.title}</a></li>
        ))}
      </ul>
      <h3 className="mt-5 text-sm font-semibold text-slate-950">Audiences</h3>
      <ul className="mt-2 space-y-1 text-sm text-slate-700">
        {value.brief.audiences.map((audience) => <li key={audience.name}>{audience.name}: <span className="text-slate-500">{audience.pains.join(" · ")}</span></li>)}
      </ul>
      <h3 className="mt-5 text-sm font-semibold text-slate-950">Competitors and pillars</h3>
      <p className="mt-2 text-sm text-slate-700">{value.brief.competitors.map((item) => item.name).join(", ")}. Pillars: {value.brief.pillars.map((item) => item.name).join("; ")}.</p>
      <div className="mt-4 overflow-x-auto"><table className="w-full min-w-[560px] text-left text-sm">
        <thead className="text-xs text-slate-500"><tr><th className="py-1">Step</th><th>Model</th><th>Tokens in / out</th><th>Searches</th><th>Meta response id</th><th className="text-right">Cost</th></tr></thead>
        <tbody>
          {value.modelCalls.map((call) => (
            <tr key={call.step} className="border-t border-slate-100">
              <td className="py-1">{call.step.replaceAll("_", " ")}</td><td className="font-mono text-xs">{call.model}</td>
              <td>{call.inputTokens.toLocaleString()} / {call.outputTokens.toLocaleString()}</td><td>{call.searchCalls}</td>
              <td className="font-mono text-xs text-slate-500">{call.responseId}</td>
              <td className="text-right">{costByStep.has(call.step) ? usd(costByStep.get(call.step) ?? 0) : ""}</td>
            </tr>
          ))}
        </tbody>
      </table></div>
      <p className="mt-2 text-xs text-slate-500">Full record: <a className="underline" href={`${REPO_URL}/blob/main/evidence/onboarding/cal.com-2026-11-04.json`}>evidence/onboarding/cal.com-2026-11-04.json</a>{value.receipt ? <> · cost is a list-price reconstruction (pricing {value.receipt.pricingVersion}), not an invoice</> : null}</p>
    </>
  );
}

function NarratedVideo({ value }: { value: NarratedVideoEvidence }) {
  return (
    <div className="mt-3 flex flex-col gap-6 sm:flex-row">
      <video className="w-full max-w-[240px] shrink-0 rounded-lg border border-slate-200 bg-black" src={value.videoUrl} controls preload="metadata" playsInline />
      <div className="text-sm text-slate-700">
        <p className="font-medium text-slate-950">{value.plan.title}</p>
        <p className="mt-2">
          {value.scenes} scenes, {value.durationSec.toFixed(0)} s, {value.width}×{value.height}. Muse Spark wrote the scenes, <span className="font-mono text-xs">{value.imageModel}</span> drew
          each frame, Meta&apos;s open-weight <span className="font-mono text-xs">{value.voiceModel}</span> spoke the narration, and ffmpeg cut the MP4.
        </p>
        <p className="mt-2">
          <span className="font-mono text-xs">{value.narrationCheck.model}</span> listened back: {Math.round(value.narrationCheck.score * 100)}% word match with the script, {value.narrationCheck.passed ? "passed" : "failed"} (under 60% fails the render).
        </p>
        <ol className="mt-3 list-decimal space-y-1 pl-5 text-slate-600">
          {value.plan.scenes.map((scene, index) => <li key={index}>{scene.caption}</li>)}
        </ol>
      </div>
    </div>
  );
}

function Run({ run, concurrent }: { run: RunSummary; concurrent?: number }) {
  return (
    <article className="mt-4 rounded-lg border border-slate-200 bg-white p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-semibold text-slate-950">{run.scenario.replaceAll("_", " ")}</h3>
        <span className="text-xs text-slate-500">
          {concurrent ? `One of ${concurrent} runs in parallel · ` : ""}{run.environment === "local_emulator" ? "Live Meta Model API calls, job state on a local machine" : "Cloud run"} · {new Date(run.capturedAt).toUTCString()} · {(run.durationMs / 1000).toFixed(0)} s · {run.eventCount} events
        </span>
      </div>
      <p className="mt-1 text-xs text-slate-500">
        Integrity {short(run.integrityDigest)} and terminal state {short(run.terminalStateDigest)} re-verified on this request.
      </p>
      {run.stages.length > 0 && <p className="mt-3 text-sm text-slate-700">{run.stages.join(" → ")}</p>}
      {run.handoffs.length > 0 && (
        <ol className="mt-4 space-y-1 text-sm text-slate-700">
          {run.handoffs.map((handoff, index) => (
            <li key={index}><span className="font-medium">{handoff.from} → {handoff.to}</span> {handoff.summary}</li>
          ))}
        </ol>
      )}
      {run.reviews.map((line, index) => <p key={`v${index}`} className="mt-3 text-sm font-medium text-slate-800">{line}</p>)}
      {run.moments.length > 0 && (
        <ul className="mt-4 space-y-1 text-sm text-slate-700">
          {run.moments.map((moment, index) => (
            <li key={index}>{moment.title} <span className="text-slate-500">{moment.startSec.toFixed(1)}–{moment.endSec.toFixed(1)} s</span></li>
          ))}
        </ul>
      )}
      {run.drafts.map((draft, index) => (
        <blockquote key={index} className="mt-4 whitespace-pre-wrap border-l-2 border-slate-300 pl-4 text-sm text-slate-800">
          <span className="block text-xs font-medium text-slate-500">{draft.platform}{draft.valid ? "" : " · failed validation"}</span>
          {draft.text}
        </blockquote>
      ))}
      {(run.approvals.length > 0 || run.receipts.length > 0) && (
        <ul className="mt-4 space-y-1 text-sm text-slate-700">
          {run.approvals.map((item, index) => <li key={`a${index}`}>Approval {item.actionId}: {item.decision}</li>)}
          {run.receipts.map((item, index) => (
            <li key={`r${index}`}>Receipt {item.actionId}: {item.outcome}{item.verified ? ", independently verified" : ", not verified"}</li>
          ))}
        </ul>
      )}
      {run.cost.length > 0 && (
        <div className="mt-4 overflow-x-auto"><table className="w-full min-w-[560px] text-left text-sm">
          <thead className="text-xs text-slate-500"><tr><th className="py-1">Model</th><th>Input tokens</th><th>Output tokens</th><th className="text-right">Cost</th></tr></thead>
          <tbody>
            {run.cost.map((row) => (
              <tr key={row.model} className="border-t border-slate-100">
                <td className="py-1 font-mono text-xs">{row.model}</td><td>{row.inputTokens.toLocaleString()}</td>
                <td>{row.outputTokens.toLocaleString()}</td><td className="text-right">{usd(row.usd)}</td>
              </tr>
            ))}
            <tr className="border-t border-slate-200 font-medium"><td className="py-1" colSpan={3}>Total</td><td className="text-right">{usd(run.totalUsd)}</td></tr>
          </tbody>
        </table></div>
      )}
    </article>
  );
}

function render<T>(loaded: Loaded<T>, body: (value: T) => React.ReactNode) {
  return loaded.state === "ok" ? body(loaded.value) : <Missing reason={loaded.reason} />;
}

export default async function ProofPage() {
  const [status, probe, roster, publicRuns, screen, brief, video] = await Promise.all([
    loadMetaStatus(), loadProbeReport(), loadRoster(), loadPublicRuns(), loadScreenEval(), loadBrandBrief(), loadNarratedVideo(),
  ]);
  const groupSize = new Map<string, number>();
  for (const group of concurrentGroups(publicRuns.runs)) for (const id of group) groupSize.set(id, group.length);
  const totals = publicRuns.runs.map((run) => run.totalUsd);
  return (
    <main className="mx-auto min-h-screen w-full max-w-4xl px-4 py-12 text-slate-800 sm:px-10">
      <Link href="/" className="text-sm font-semibold text-slate-600 hover:text-slate-950">← Harmonia</Link>
      <h1 className="mt-8 text-3xl font-semibold tracking-tight text-slate-950">Proof</h1>
      <p className="mt-2 text-sm text-slate-500">Read-only. Everything below is read from committed evidence or fetched live on this request. <a className="underline" href="/api/proof">JSON</a> · <a className="underline" href={REPO_URL}>Source</a> · <a className="underline" href={DEMO_VIDEO_URL}>3-minute demo video</a></p>
      {publicRuns.runs.length > 0 && (
        <ul className="mt-6 grid gap-3 text-sm sm:grid-cols-3">
          <li className="rounded-lg border border-slate-200 bg-white p-4"><span className="block text-2xl font-semibold text-slate-950">{publicRuns.runs.length}</span>end-to-end campaign runs on Meta Model API</li>
          <li className="rounded-lg border border-slate-200 bg-white p-4"><span className="block text-2xl font-semibold text-slate-950">{usd(Math.min(...totals))}–{usd(Math.max(...totals))}</span>model cost per campaign</li>
          <li className="rounded-lg border border-slate-200 bg-white p-4"><span className="block text-2xl font-semibold text-slate-950">{brief.state === "ok" ? `${Math.round(brief.value.elapsedSeconds)} s` : "–"}</span>website to cited brand brief</li>
        </ul>
      )}
      <nav className="mt-6 flex flex-wrap gap-x-4 gap-y-1 text-sm text-slate-600" aria-label="Sections">
        <a className="underline" href="#brief">Brand brief</a><a className="underline" href="#video">Narrated video</a><a className="underline" href="#runs">Recorded runs</a>
        <a className="underline" href="#screen">Injection screen</a><a className="underline" href="#calls">Live calls</a><a className="underline" href="#team">Agent team</a>
      </nav>

      <Section id="brief" title="Brand brief from a website">
        {render(brief, (value) => <BrandBrief value={value} />)}
      </Section>

      <Section id="video" title="Narrated video with no footage">
        {render(video, (value) => <NarratedVideo value={value} />)}
      </Section>

      <Section title="Meta Model API">
        {render(status, (value) => (
          <p className="mt-3 text-sm">
            {value.serviceStatus}{value.degraded.length ? ` · degraded: ${value.degraded.join(", ")}` : ""}
            <span className="text-slate-500"> · checked {new Date(value.checkedAt).toUTCString()}</span>
          </p>
        ))}
      </Section>

      <Section id="screen" title="Injection screen">
        {render(screen, (value) => (
          <>
            <p className="mt-2 text-xs text-slate-500">{new Date(value.ranAt).toUTCString()} · {value.cases} labelled cases</p>
            <div className="mt-3 overflow-x-auto"><table className="w-full min-w-[480px] text-left text-sm">
              <thead className="text-xs text-slate-500"><tr><th className="py-1">Layer</th><th>Injections caught</th><th>Clean text withheld</th><th>Time</th></tr></thead>
              <tbody>
                <tr className="border-t border-slate-100">
                  <td className="py-1">Rules</td><td>{value.rules.caught} of {value.rules.injections}</td>
                  <td>{value.rules.wronglyWithheld.length} of {value.rules.cleanCases}</td><td />
                </tr>
                {value.glimmer.state === "ran" && "combined" in value.glimmer && (
                  <tr className="border-t border-slate-100">
                    <td className="py-1">Rules + <span className="font-mono text-xs">{value.glimmer.model}</span> (open weights, local)</td>
                    <td>{value.glimmer.combined.caught} of {value.glimmer.combined.injections}</td>
                    <td>{value.glimmer.combined.wronglyWithheld.length} of {value.glimmer.combined.cleanCases}</td>
                    <td>{Math.round(value.glimmer.latencyMs / 1000)} s</td>
                  </tr>
                )}
              </tbody>
            </table></div>
          </>
        ))}
      </Section>

      <Section id="calls" title="Live calls">
        {render(probe, (report) => (
          <>
            <p className="mt-2 text-xs text-slate-500">{new Date(report.ranAt).toUTCString()} · {report.passed ? "all passed" : "some failed"}</p>
            <div className="mt-3 overflow-x-auto"><table className="w-full min-w-[560px] text-left text-sm">
              <thead className="text-xs text-slate-500"><tr><th className="py-1">Call</th><th>Model</th><th>Result</th><th>Latency</th><th>Request id</th></tr></thead>
              <tbody>
                {report.checks.map((check, index) => (
                  <tr key={index} className="border-t border-slate-100">
                    <td className="py-1">{check.check}</td>
                    <td className="font-mono text-xs">{check.model ?? ""}</td>
                    <td>{(check.ok ?? check.alive) ? "ok" : `failed${check.httpStatus ? ` (${check.httpStatus})` : ""}`}</td>
                    <td>{check.latencyMs !== undefined ? `${check.latencyMs} ms` : ""}</td>
                    <td className="font-mono text-xs text-slate-500">{check.requestId ?? check.responseId ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          </>
        ))}
      </Section>

      <Section id="team" title="Agent team">
        {render(roster, (value) => (
          <>
            <p className="mt-2 text-sm text-slate-600">{value.authority} Roster {short(value.rosterDigest)}{value.snapshotAt ? ` · snapshot ${new Date(value.snapshotAt).toUTCString()}` : ""}</p>
            <div className="mt-3 overflow-x-auto"><table className="w-full min-w-[560px] text-left text-sm">
              <thead className="text-xs text-slate-500"><tr><th className="py-1">Agent</th><th>Model</th><th>Effort</th><th>Tools</th><th>Definition</th></tr></thead>
              <tbody>
                {value.agents.map((agent) => (
                  <tr key={agent.name} className="border-t border-slate-100 align-top">
                    <td className="py-1"><span className="font-medium">{agent.name}</span><span className="block text-xs text-slate-500">{agent.description}</span></td>
                    <td className="font-mono text-xs">{agent.provider === "meta" ? agent.model : `${agent.model} (${agent.provider})`}</td>
                    <td>{agent.reasoningEffort ?? ""}</td>
                    <td className="text-xs">{[...agent.tools, ...agent.skills].join(", ")}</td>
                    <td>{short(agent.definitionDigest)}</td>
                  </tr>
                ))}
                {value.media.map((item) => (
                  <tr key={item.name} className="border-t border-slate-100 align-top">
                    <td className="py-1"><span className="font-medium">{item.name}</span><span className="block text-xs text-slate-500">{item.job}</span></td>
                    <td className="font-mono text-xs">{item.model}</td><td /><td /><td />
                  </tr>
                ))}
              </tbody>
            </table></div>
          </>
        ))}
      </Section>

      <Section id="runs" title="Recorded runs">
        <p className="mt-2 text-sm text-slate-600">Every model call in these runs went to Meta Model API; per-call request ids for live calls are in the probe table above and in the brand brief.</p>
        {publicRuns.runs.length === 0 && <Missing reason="No recorded run has been approved for public release yet." />}
        {publicRuns.runs.map((run) => <Run key={run.bundleId} run={run} concurrent={groupSize.get(run.bundleId)} />)}
        {publicRuns.rejected.map((item) => (
          <p key={item.file} className="mt-3 text-sm text-red-700">{item.file} was not shown: {item.reason}</p>
        ))}
      </Section>
    </main>
  );
}
