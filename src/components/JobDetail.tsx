"use client";

import { useState } from "react";
import PipelineStepper from "@/components/PipelineStepper";
import AskAiButton from "@/components/AskAiButton";
import Timeline from "@/components/Timeline";
import type { JobFull } from "@/components/jobTypes";
import type { TimelineEvent } from "@/components/Timeline";
import type { PlannedAction, Receipt } from "@/lib/types";
import { isReplayableAction } from "@/lib/replayEligibility";
import { SteeringControls } from "@/components/studio/SteeringControls";
import { contentArtifactPreview } from "@/lib/contentArtifacts/presentation";

type Tab = "overview" | "drafts" | "actions" | "receipts" | "packet";

const TABS: Array<{ key: Tab; label: string }> = [
  { key: "overview", label: "Analysis" },
  { key: "drafts", label: "Artifacts" },
  { key: "actions", label: "Actions" },
  { key: "receipts", label: "Receipts" },
  { key: "packet", label: "Packet" },
];

function Chip({ children, tone = "zinc" }: { children: React.ReactNode; tone?: string }) {
  const tones: Record<string, string> = {
    zinc: "bg-zinc-200 text-zinc-700 dark:bg-zinc-700 dark:text-zinc-300",
    green: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200",
    red: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
    amber: "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200",
    blue: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  };
  return (
    <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${tones[tone]}`}>
      {children}
    </span>
  );
}

function ActionPreview({ action }: { action: PlannedAction }) {
  const p = action.payload as Record<string, unknown>;
  if (action.type === "generate_image") {
    return (
      <p className="mt-2 line-clamp-3 font-mono text-[11px] leading-4 text-zinc-500 dark:text-zinc-400">
        <span className="text-zinc-400">prompt:</span> {String(p.prompt)}
      </p>
    );
  }
  if (action.type === "publish_x_post") {
    return (
      <div className="mt-2 whitespace-pre-wrap rounded-md border border-zinc-200 bg-white p-2.5 text-xs leading-5 text-zinc-600 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-300">
        {String(p.text)}
      </div>
    );
  }
  return (
    <p className="mt-2 font-mono text-[11px] text-zinc-500 dark:text-zinc-400">
      bundles moments, angles and drafts into a markdown pack.
    </p>
  );
}

function download(filename: string, content: string, mime = "text/plain") {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function JobDetail({
  job,
  events,
  receipts,
  assets,
  onDecide,
  onRetry,
}: {
  job: JobFull;
  events: TimelineEvent[];
  receipts: Receipt[];
  assets: NonNullable<JobFull["assets"]>;
  onDecide: (actionId: string, decision: "approved" | "rejected") => Promise<void>;
  onRetry: () => Promise<void>;
}) {
  const [tab, setTab] = useState<Tab>("overview");
  const [busy, setBusy] = useState(false);
  const [replayStatus, setReplayStatus] = useState<Record<string, string>>({});

  const verificationByItem = new Map<string, NonNullable<JobFull["verifications"]>[number]>();
  for (const v of job.verifications ?? []) {
    const existing = verificationByItem.get(v.rubricItemId);
    if (!existing || (v.verified && !existing.verified)) {
      verificationByItem.set(v.rubricItemId, v);
    }
  }

  const pendingActions = job.actions.filter((a) => a.approvalState === "pending");
  const verifiedCount = (job.verifications ?? []).filter((v) => v.verified).length;
  const assetMime = new Map(assets.map((a) => [a.actionId, a.mime]));

  async function decide(actionId: string, decision: "approved" | "rejected") {
    setBusy(true);
    try {
      await onDecide(actionId, decision);
    } finally {
      setBusy(false);
    }
  }

  async function proveReplay(actionId: string) {
    setBusy(true);
    try {
      const response = await fetch(`/api/jobs/${job.id}/actions/${actionId}/replay`, { method: "POST" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Replay proof failed");
      setReplayStatus((current) => ({ ...current, [actionId]: `Duplicate suppressed; original receipt ${body.receiptId}` }));
    } catch (error) {
      setReplayStatus((current) => ({ ...current, [actionId]: error instanceof Error ? error.message : "Replay proof failed" }));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <section className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="max-w-md truncate font-mono text-sm font-semibold" title={job.config.sourceManifestId}>
            {job.sourceAnalysis?.summary ?? `Source bundle ${job.config.sourceManifestId.slice(0, 12)}`}
          </h2>
          <div className="flex items-center gap-2">
            {job.status === "complete" && <Chip tone="green">complete</Chip>}
            {job.status === "failed" && <Chip tone="red">failed</Chip>}
            {job.status === "waiting_for_approval" && <Chip tone="amber">awaiting approval</Chip>}
            {job.status === "running" && <Chip tone="blue">running</Chip>}
            <span className="font-mono text-xs text-zinc-400">{job.id.slice(0, 8)}</span>
            <AskAiButton kind="job" id={job.id} label={(job.sourceAnalysis?.summary ?? `Source bundle ${job.config.sourceManifestId}`).slice(0, 60)} />
          </div>
        </div>

        <div className="mt-4">
          <PipelineStepper stage={job.stage} status={job.status} />
        </div>
        <SteeringControls job={job} />

        {job.failure && (
          <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 dark:border-red-900 dark:bg-red-950/50">
            <p className="text-sm text-red-700 dark:text-red-300">
              {job.failure.retryable ? "Transient failure — retry is available" : "Permanent failure"} at{" "}
              <span className="font-mono">{job.failure.stage}</span>: {job.failure.publicMessage}
            </p>
            {job.failure.retryable && (
              <button
                onClick={() => void onRetry()}
                disabled={busy}
                className="mt-2 rounded-full bg-red-600 px-4 py-1.5 text-xs font-medium text-white transition-colors hover:bg-red-500 disabled:opacity-50"
              >
                Retry from failure point
              </button>
            )}
          </div>
        )}

        <div className="mt-4 border-t border-zinc-100 pt-3 dark:border-zinc-800">
          {job.learnings && (
            <div className="mb-3 rounded-lg border border-sky-200 bg-sky-50 p-3 text-xs dark:border-sky-900 dark:bg-sky-950/50">
              <p className="font-semibold text-sky-800 dark:text-sky-300">Learned from reactions</p>
              <p className="mt-0.5 leading-5 text-sky-700 dark:text-sky-400">{job.learnings.summary}</p>
              {job.engagement && job.engagement.length > 0 && (
                <ul className="mt-2 space-y-1">
                  {job.engagement.map((e) => (
                    <li key={e.postId} className="flex gap-3 font-mono text-[11px] text-sky-700 dark:text-sky-400">
                      <a href={e.url ?? `https://x.com/i/web/status/${e.postId}`} target="_blank" rel="noopener noreferrer" className="underline">
                        post
                      </a>
                      <span>{e.likes} likes</span>
                      <span>{e.reposts} reposts</span>
                      <span>{e.replies} replies</span>
                      {typeof e.impressions === "number" && <span>{e.impressions} impressions</span>}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          <Timeline events={events} />
        </div>
      </section>

      {pendingActions.length > 0 && (
        <section className="rounded-xl border border-amber-300 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-950/60" aria-label="Approval boundary" aria-busy={busy}>
          <p className="sr-only" role="status" aria-live="polite">{busy ? "Recording operator decision" : `${pendingActions.length} approval decisions pending`}</p>
          <h2 className="font-semibold text-amber-900 dark:text-amber-200">
            Approval required — review before allowing repository writes ({pendingActions.length})
          </h2>
          <div className="mt-3 flex flex-col gap-3">
            {pendingActions.map((a) => (
              <div
                key={a.id}
                className={`rounded-lg border bg-white p-3 dark:bg-zinc-900 ${
                  a.risk === "high"
                    ? "border-amber-400 dark:border-amber-600"
                    : "border-amber-200 dark:border-amber-800"
                }`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm font-medium">{a.title}</span>
                  <div className="flex gap-1.5">
                    <Chip tone={a.risk === "high" ? "red" : a.risk === "medium" ? "amber" : "green"}>
                      {a.risk} risk
                    </Chip>
                    <Chip tone="blue">{a.type}</Chip>
                  </div>
                </div>
                <p className="mt-1 text-xs leading-5 text-zinc-600 dark:text-zinc-400">{a.description}</p>
                <ActionPreview action={a} />
                <div className="mt-3 flex gap-2">
                    <button
                      aria-label={`Approve ${a.title}`}
                      onClick={() => void decide(a.id, "approved")}
                      disabled={busy}
                      className="rounded-full bg-emerald-600 px-4 py-1.5 text-xs font-medium text-white transition-colors hover:bg-emerald-500 disabled:opacity-50"
                    >
                      Approve
                    </button>
                  <button
                    aria-label={`Reject ${a.title}`}
                    onClick={() => void decide(a.id, "rejected")}
                    disabled={busy}
                    className="rounded-full border border-zinc-300 px-4 py-1.5 text-xs font-medium transition-colors hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-600 dark:hover:bg-zinc-800"
                  >
                    Reject
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="rounded-xl border border-zinc-200 dark:border-zinc-800">
        <div className="flex gap-1 overflow-x-auto border-b border-zinc-200 px-2 pt-2 dark:border-zinc-800">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`shrink-0 rounded-t-lg px-3 py-2 text-xs font-medium transition-colors ${
                tab === t.key
                  ? "border-b-2 border-zinc-900 text-zinc-900 dark:border-white dark:text-white"
                  : "border-b-2 border-transparent text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-300"
              }`}
            >
              {t.label}
              {t.key === "actions" && job.actions.length > 0 && ` (${job.actions.length})`}
              {t.key === "receipts" && receipts.length > 0 && ` (${receipts.length})`}
              {t.key === "packet" && job.packet?.unresolved.length ? ` (${job.packet.unresolved.length}!)` : ""}
            </button>
          ))}
        </div>

        <div className="p-4">
          {tab === "overview" && (
            <>
              {(job.normalizedSources?.length ?? 0) > 0 && (
                <details open>
                  <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wide text-zinc-500">Normalized sources ({job.normalizedSources?.length ?? 0})</summary>
                  <ol className="mt-2 max-h-56 space-y-1 overflow-y-auto text-xs leading-5">
                    {(job.normalizedSources ?? []).flatMap((source) => source.segments.map((segment) => (
                      <li key={`${source.sourceId}:${segment.id}`}>
                        <span className="mr-2 font-mono text-[10px] text-zinc-400">{source.title} · {segment.locator.kind}</span>
                        {segment.text}
                      </li>
                    )))}
                  </ol>
                </details>
              )}
              {(job.sourceAnalysis?.moments.length ?? 0) > 0 && (
                <div className="mt-4">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Clip moments</h3>
                  <ul className="mt-2 space-y-2">
                    {job.sourceAnalysis!.moments.map((m) => (
                      <li key={m.id} className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-sm font-medium">{m.title}</span>
                          <span className="font-mono text-[10px] text-zinc-400">{Math.floor(m.startSec / 60)}:{String(Math.round(m.startSec % 60)).padStart(2, "0")}–{Math.floor(m.endSec / 60)}:{String(Math.round(m.endSec % 60)).padStart(2, "0")}</span>
                        </div>
                        <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">{m.hook}</p>
                        <p className="mt-1 border-l-2 border-zinc-300 pl-2 text-xs italic text-zinc-500 dark:border-zinc-600">“{m.quote}”</p>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {(job.sourceAnalysis?.angles.length ?? 0) > 0 && (
                <div className="mt-4">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Grounded analytical angles</h3>
                  <ul className="mt-2 space-y-1.5">
                    {job.sourceAnalysis!.angles.map((a) => (
                      <li key={a.id} className="text-xs leading-5">
                        <span className="mr-2 rounded bg-blue-100 px-1.5 py-px text-[10px] font-semibold uppercase text-blue-800 dark:bg-blue-900 dark:text-blue-200">{a.angleType} · {a.evidenceKind}</span>
                        <span className="font-medium">{a.title}</span> — <span className="text-zinc-600 dark:text-zinc-400">{a.rationale}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {!job.sourceAnalysis && !(job.normalizedSources?.length) && (
                <Empty text="Normalized evidence and analysis appear after source extraction and understanding." />
              )}
            </>
          )}

          {tab === "drafts" && (
            <>
              {(job.contentArtifacts?.length ?? 0) === 0 ? (
                <Empty text="Reviewed content artifacts appear after production." />
              ) : (
                <ul className="flex flex-col gap-2">
                  {job.contentArtifacts!.map((artifact) => (
                    <li key={artifact.id} className="rounded-lg border border-emerald-200 p-3 dark:border-emerald-900">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <Chip tone="green">{artifact.outputType.toUpperCase()}</Chip>
                        <span className="font-mono text-[10px] text-zinc-400">revision {artifact.revision} · {artifact.contentDigest.slice(0, 12)}…</span>
                      </div>
                      <p className="mt-2 whitespace-pre-wrap text-sm leading-6">{contentArtifactPreview(artifact)}</p>
                      <p className="mt-1 font-mono text-[10px] text-zinc-400">Sources: {artifact.sourceSegmentRefs.join(" · ")}</p>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}

          {tab === "actions" && (
            <>
              {job.actions.length === 0 ? (
                <Empty text="Proposed actions appear after the draft stage." />
              ) : (
                <ul className="flex flex-col gap-2">
                  {job.actions.map((a) => (
                    <li key={a.id} className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-sm font-medium">{a.title}</span>
                        <div className="flex gap-1.5">
                          <Chip tone={a.state === "executed" ? "green" : a.state === "skipped" ? "amber" : a.state === "failed" ? "red" : "zinc"}>
                            {a.state}
                          </Chip>
                          <Chip>{a.approvalState.replace("_", " ")}</Chip>
                        </div>
                      </div>
                      <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">{a.description}</p>
                      {isReplayableAction(a, receipts, job.claims ?? []) && (
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          <button type="button" aria-label={`Replay proof for ${a.title}`} disabled={busy} onClick={() => void proveReplay(a.id)} className="rounded-full border border-blue-300 px-3 py-1 text-xs font-medium text-blue-700 disabled:opacity-50 dark:border-blue-700 dark:text-blue-300">Prove duplicate suppression</button>
                          <span role="status" aria-live="polite" className="text-xs text-zinc-500">{replayStatus[a.id]}</span>
                        </div>
                      )}
                      {a.state === "executed" && assetMime.get(a.id) === "video/mp4" && (
                        <video
                          src={`/api/jobs/${job.id}/assets/${a.id}`}
                          controls
                          className="mt-2 max-h-72 rounded-lg border border-zinc-200 dark:border-zinc-800"
                        />
                      )}
                      {a.state === "executed" && assetMime.get(a.id)?.startsWith("image/") && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={`/api/jobs/${job.id}/assets/${a.id}`}
                          alt={a.title}
                          className="mt-2 max-h-64 rounded-lg border border-zinc-200 dark:border-zinc-800"
                        />
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}

          {tab === "receipts" && (
            <>
              {receipts.length === 0 ? (
                <Empty text="Audit receipts appear when approved actions execute." />
              ) : (
                <ul className="flex flex-col gap-2">
                  {receipts.map((r) => (
                    <li key={r.id} className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
                      <div className="flex flex-wrap items-center gap-2">
                        <Chip tone={r.outcome === "applied" ? "green" : r.outcome === "already_applied" ? "blue" : "red"}>
                          {r.outcome}
                        </Chip>
                        <span className="font-mono text-xs">{r.actionType}</span>
                        <span className="ml-auto font-mono text-[10px] text-zinc-400">
                          {new Date(r.performedAt).toLocaleTimeString()} · key {r.idempotencyKey.slice(0, 12)}…
                        </span>
                      </div>
                      {r.artifact && (
                        <a
                          href={r.artifact.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="mt-1 block break-all font-mono text-[11px] text-blue-600 underline dark:text-blue-400"
                        >
                          {r.artifact.url.replace("https://", "")}
                        </a>
                      )}
                      <details className="mt-1">
                        <summary className="cursor-pointer select-none text-[11px] text-zinc-500">detail</summary>
                        <pre className="mt-1 max-h-32 overflow-auto rounded-md bg-zinc-50 p-2 text-[10px] dark:bg-zinc-950">
                          {JSON.stringify(r.detail, null, 2)}
                        </pre>
                      </details>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}

          {tab === "packet" && (
            <>
              {!job.packet ? (
                <Empty text="The evidence packet is assembled after independent verification completes." />
              ) : (
                <div className="flex flex-col gap-4">
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <Stat label="clip moments" value={String(job.sourceAnalysis?.moments.length ?? 0)} />
                    <Stat label="verifications passed" value={`${verifiedCount}/${(job.verifications ?? []).length}`} tone="green" />
                    <Stat label="audit receipts" value={String(receipts.length)} tone="blue" />
                    <Stat
                      label="unresolved gaps"
                      value={String(job.packet.unresolved.length)}
                      tone={job.packet.unresolved.length > 0 ? "red" : "green"}
                    />
                  </div>
                  {job.packet.unresolved.length > 0 && (
                    <ul className="list-disc space-y-1 pl-5 text-sm text-red-700 dark:text-red-300">
                      {job.packet.unresolved.map((u, i) => (
                        <li key={i}>{u}</li>
                      ))}
                    </ul>
                  )}
                  <div className="flex gap-2">
                    <button
                      onClick={() => download(`harmonia-evidence-${job.id.slice(0, 8)}.json`, JSON.stringify(job.packet, null, 2), "application/json")}
                      className="rounded-full bg-zinc-900 px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-zinc-700 dark:bg-white dark:text-black dark:hover:bg-zinc-300"
                    >
                      Download evidence (.json)
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </section>
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <div className="py-8 text-center text-sm text-zinc-400 dark:text-zinc-500">{text}</div>
  );
}

function Stat({ label, value, tone = "zinc" }: { label: string; value: string; tone?: string }) {
  const colors: Record<string, string> = {
    zinc: "text-zinc-900 dark:text-zinc-100",
    green: "text-emerald-600 dark:text-emerald-400",
    blue: "text-blue-600 dark:text-blue-400",
    red: "text-red-600 dark:text-red-400",
  };
  return (
    <div className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
      <div className={`text-xl font-bold ${colors[tone]}`}>{value}</div>
      <div className="text-[10px] uppercase tracking-wide text-zinc-400">{label}</div>
    </div>
  );
}
