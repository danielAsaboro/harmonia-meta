"use client";

import { useEffect, useMemo, useState } from "react";
import type { Receipt } from "@/lib/types";
import { Button } from "@/components/dashboard/Button";
import { TextInput } from "@/components/dashboard/Controls";
import { DataShell } from "@/components/dashboard/DataShell";
import { StatusBadge } from "@/components/dashboard/StatusBadge";
import { Surface } from "@/components/dashboard/Surface";
import { EmptyState, ErrorState, LoadingState } from "@/components/dashboard/SystemState";
import type { Tone } from "@/components/dashboard/types";

const OUTCOMES = ["applied", "already_applied", "failed", "rejected"] as const;
const outcomeTone = (outcome: string): Tone => outcome === "applied" ? "success" : outcome === "already_applied" ? "info" : outcome === "failed" ? "danger" : "neutral";

export default function ReceiptsLedger() {
  const [receipts, setReceipts] = useState<Array<Receipt & { jobTitle?: string }> | null>(null);
  const [outcomeFilter, setOutcomeFilter] = useState("");
  const [q, setQ] = useState("");
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);

  useEffect(() => {
    const timer = setTimeout(() => {
      fetch("/api/receipts", { cache: "no-store" })
        .then((response) => response.ok ? response.json() : Promise.reject(new Error(`HTTP ${response.status}`)))
        .then((body) => { setReceipts(body.receipts); setError(""); })
        .catch((cause) => setError(cause instanceof Error ? cause.message : "Receipts request failed"));
    }, 0);
    return () => clearTimeout(timer);
  }, [reload]);

  const rows = useMemo(() => (receipts ?? []).filter((receipt) => {
    if (outcomeFilter && receipt.outcome !== outcomeFilter) return false;
    if (!q) return true;
    const needle = q.toLowerCase();
    return receipt.actionType.toLowerCase().includes(needle)
      || receipt.idempotencyKey.toLowerCase().includes(needle)
      || (receipt.jobTitle ?? "").toLowerCase().includes(needle);
  }), [outcomeFilter, q, receipts]);

  return <div className="ops-stack">
    <Surface className="monitor-filter-bar">
      <div className="ops-chip-row" aria-label="Receipt outcome filters">
        <Button variant={!outcomeFilter ? "primary" : "quiet"} onClick={() => setOutcomeFilter("")}>All outcomes</Button>
        {OUTCOMES.map((outcome) => <Button key={outcome} variant={outcomeFilter === outcome ? "primary" : "quiet"} onClick={() => setOutcomeFilter(outcomeFilter === outcome ? "" : outcome)}>{outcome.replaceAll("_", " ")}</Button>)}
      </div>
      <TextInput aria-label="Search receipts" value={q} onChange={(event) => setQ(event.target.value)} placeholder="Search type, key, or job…" />
    </Surface>

    {error ? <ErrorState title="Receipts could not be loaded" message={error} action={<Button onClick={() => setReload((value) => value + 1)}>Retry</Button>} />
      : receipts === null ? <LoadingState title="Loading receipts" />
      : rows.length === 0 ? <EmptyState title="No receipts match" message="Change the outcome or search filter to widen the ledger query." />
      : <DataShell title="External action ledger" description={`${rows.length} verified receipt${rows.length === 1 ? "" : "s"}`}>
        <table className="ops-table"><thead><tr>{["When", "Action", "Outcome", "Job", "Idempotency key", "Artifact"].map((heading) => <th key={heading}>{heading}</th>)}</tr></thead>
          <tbody>{rows.map((receipt) => <tr key={receipt.id}>
            <td>{new Date(receipt.performedAt).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</td>
            <td className="font-mono">{receipt.actionType}</td>
            <td><StatusBadge tone={outcomeTone(receipt.outcome)}>{receipt.outcome.replaceAll("_", " ")}</StatusBadge></td>
            <td title={receipt.jobTitle}>{receipt.jobTitle ?? "—"}</td>
            <td className="font-mono">{receipt.idempotencyKey.slice(0, 16)}…</td>
            <td>{receipt.artifact?.url ? <a className="monitor-link" href={receipt.artifact.url} target="_blank" rel="noopener noreferrer">{receipt.artifact.kind}</a> : "—"}</td>
          </tr>)}</tbody>
        </table>
      </DataShell>}
  </div>;
}
