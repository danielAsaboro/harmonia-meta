import type { Metadata } from "next";
import Link from "next/link";
import {
  loadMetaStatus, loadProbeReport, loadPublicRuns, loadRoster, loadScreenEval,
  type Loaded, type RunSummary,
} from "@/lib/proof";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Proof — Harmonia",
  description: "Live Meta Model API status, recorded calls, the running agent team, and integrity-checked recorded runs.",
};

function Missing({ reason }: { reason: string }) {
  return <p className="mt-3 rounded-md border border-dashed border-slate-300 px-4 py-3 text-sm text-slate-500">{reason}</p>;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-slate-200 py-8">
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

function Run({ run }: { run: RunSummary }) {
  return (
    <article className="mt-4 rounded-lg border border-slate-200 bg-white p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-semibold text-slate-950">{run.scenario.replaceAll("_", " ")}</h3>
        <span className="text-xs text-slate-500">
          {run.environment === "local_emulator" ? "Local run (Firestore and Pub/Sub emulators)" : "Cloud run"} · {new Date(run.capturedAt).toUTCString()} · {(run.durationMs / 1000).toFixed(0)} s · {run.eventCount} events
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
  const [status, probe, roster, publicRuns, screen] = await Promise.all([loadMetaStatus(), loadProbeReport(), loadRoster(), loadPublicRuns(), loadScreenEval()]);
  return (
    <main className="mx-auto min-h-screen w-full max-w-4xl px-4 py-12 text-slate-800 sm:px-10">
      <Link href="/" className="text-sm font-semibold text-slate-600 hover:text-slate-950">← Harmonia</Link>
      <h1 className="mt-8 text-3xl font-semibold tracking-tight text-slate-950">Proof</h1>
      <p className="mt-2 text-sm text-slate-500">Read-only. <a className="underline" href="/api/proof">JSON</a></p>

      <Section title="Meta Model API">
        {render(status, (value) => (
          <p className="mt-3 text-sm">
            {value.serviceStatus}{value.degraded.length ? ` · degraded: ${value.degraded.join(", ")}` : ""}
            <span className="text-slate-500"> · checked {new Date(value.checkedAt).toUTCString()}</span>
          </p>
        ))}
      </Section>

      <Section title="Injection screen">
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

      <Section title="Live calls">
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

      <Section title="Agent team">
        {render(roster, (value) => (
          <>
            <p className="mt-2 text-sm text-slate-600">{value.authority} Roster {short(value.rosterDigest)}</p>
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

      <Section title="Recorded runs">
        {publicRuns.runs.length === 0 && <Missing reason="No recorded run has been approved for public release yet." />}
        {publicRuns.runs.map((run) => <Run key={run.bundleId} run={run} />)}
        {publicRuns.rejected.map((item) => (
          <p key={item.file} className="mt-3 text-sm text-red-700">{item.file} was not shown: {item.reason}</p>
        ))}
      </Section>
    </main>
  );
}
