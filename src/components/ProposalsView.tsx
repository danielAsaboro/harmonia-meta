"use client";

import AskAiButton from "@/components/AskAiButton";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/dashboard/Button";
import { StatusBadge } from "@/components/dashboard/StatusBadge";
import { Surface } from "@/components/dashboard/Surface";
import { AlertBanner, EmptyState, ErrorState, LoadingState } from "@/components/dashboard/SystemState";
import type { Tone } from "@/components/dashboard/types";

interface Proposal {
  id: string;
  source: "trend_scan" | "engagement_watch" | "calendar_gap" | "recycle";
  topic: string;
  angle: string;
  reason: string;
  sources: string[];
  suggestedPost: string;
  status: "proposed" | "approved" | "rejected";
  jobId?: string;
  createdAt: string;
}

const SOURCE_LABEL: Record<Proposal["source"], string> = {
  trend_scan: "Trend scan",
  engagement_watch: "Engagement watch",
  calendar_gap: "Calendar gap",
  recycle: "Recycle winner",
};

const STATUS_TONE: Record<Proposal["status"], Tone> = { proposed: "warning", approved: "success", rejected: "neutral" };

export default function ProposalsView() {
  const [proposals, setProposals] = useState<Proposal[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    fetch("/api/proposals", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("failed to load"))))
      .then((d) => setProposals(d.proposals ?? []))
      .catch((e) => setError(e.message));
  }, []);

  useEffect(load, [load]);

  async function decide(id: string, decision: "approved" | "rejected") {
    setBusy(id);
    setError(null);
    try {
      const res = await fetch("/api/proposals/decide", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ id, decision }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error ?? `decision failed (${res.status})`);
      }
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  if (error) {
    return <ErrorState title="Proposals could not be loaded" message={error} action={<Button onClick={load}>Retry proposals</Button>} />;
  }
  if (!proposals) {
    return <LoadingState title="Loading proposals" message="Reading persisted resident-agent suggestions and their approval state." />;
  }
  if (proposals.length === 0) {
    return <EmptyState title="No proposals yet" message="When bounded resident cycles identify a useful opportunity, the proposed idea appears here for an operator decision." />;
  }

  return (
    <div className="ops-stack">
      <AlertBanner tone="generated" title="Suggestions are not external actions">Approving a proposal creates a real Harmonia job. It does not publish content or bypass later strategy and final-review gates.</AlertBanner>
      {proposals.map((p) => (
        <Surface
          as="article"
          variant="raised"
          key={p.id}
          className="proposal-card"
        >
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge tone="generated">{SOURCE_LABEL[p.source]}</StatusBadge>
            <StatusBadge tone={STATUS_TONE[p.status]}>{p.status}</StatusBadge>
            <AskAiButton kind="proposal" id={p.id} label={p.topic.slice(0, 60)} />
            <time className="ml-auto text-[11px] text-zinc-400">
              {new Date(p.createdAt).toLocaleString()}
            </time>
          </div>
          <h3 className="text-sm font-semibold leading-snug">{p.topic}</h3>
          {p.angle && <p className="text-sm text-zinc-700 dark:text-zinc-300">{p.angle}</p>}
          {p.reason && (
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              <span className="font-medium">Why now:</span> {p.reason}
            </p>
          )}
          {p.suggestedPost && (
            <blockquote className="rounded-lg border-l-2 border-violet-400 bg-zinc-50 px-3 py-2 text-xs italic text-zinc-600 dark:bg-zinc-800/60 dark:text-zinc-300">
              {p.suggestedPost}
            </blockquote>
          )}
          {p.sources.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {p.sources.map((u) => (
                <a
                  key={u}
                  href={u}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="max-w-xs truncate text-xs text-blue-600 underline underline-offset-2 dark:text-blue-400"
                >
                  {u.replace(/^https?:\/\//, "")}
                </a>
              ))}
            </div>
          )}
          {p.status === "proposed" ? (
            <div className="mt-1 flex gap-2">
              <Button
                variant="primary"
                onClick={() => decide(p.id, "approved")}
                disabled={busy === p.id}
              >
                {busy === p.id ? "Starting…" : "Approve & create job"}
              </Button>
              <Button
                onClick={() => decide(p.id, "rejected")}
                disabled={busy === p.id}
              >
                Dismiss
              </Button>
            </div>
          ) : (
            p.jobId && (
              <a href={`/dashboard/monitoring`} className="text-xs text-blue-600 underline underline-offset-2 dark:text-blue-400">
                Job {p.jobId.slice(0, 8)}…
              </a>
            )
          )}
        </Surface>
      ))}
    </div>
  );
}
