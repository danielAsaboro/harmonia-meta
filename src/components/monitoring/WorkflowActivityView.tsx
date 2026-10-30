"use client";

import { useCallback, useEffect, useState } from "react";
import type { AgentActivity } from "@/lib/contracts";
import type { DurableRuntimeSnapshot } from "@/lib/observability/schema";
import { Button } from "@/components/dashboard/Button";
import { Select, TextInput } from "@/components/dashboard/Controls";
import { FormField } from "@/components/dashboard/FormField";
import { SectionHeader } from "@/components/dashboard/DashboardPage";
import { StatusBadge } from "@/components/dashboard/StatusBadge";
import { Surface } from "@/components/dashboard/Surface";
import { EmptyState, ErrorState, LoadingState } from "@/components/dashboard/SystemState";

interface ActivityEvent {
  id: string;
  jobId: string;
  at: string | null;
  stage: string;
  operationId: string;
  traceId: string;
  activity?: AgentActivity;
}

const ROLES = ["nimi_analyst", "ryan_strategist", "temi_editorial_planner", "noni_copywriter", "dara_editor", "maya_trend_researcher", "nova_liaison"];
const STATUS_TONE = { succeeded: "success", retrying: "warning", failed: "danger" } as const;

export default function WorkflowActivityView() {
  const [events, setEvents] = useState<ActivityEvent[] | null>(null);
  const [error, setError] = useState("");
  const [role, setRole] = useState("");
  const [status, setStatus] = useState("");
  const [selected, setSelected] = useState<ActivityEvent | null>(null);
  const [runtime, setRuntime] = useState<DurableRuntimeSnapshot | null>(null);
  const [resolution, setResolution] = useState({ reason: "", artifactId: "", digest: "" });
  const [resolutionStatus, setResolutionStatus] = useState("");

  const load = useCallback(async () => {
    const params = new URLSearchParams({ limit: "200" });
    if (role) params.set("role", role);
    if (status) params.set("status", status);
    try {
      const response = await fetch(`/api/events?${params}`, { cache: "no-store" });
      if (!response.ok) throw new Error("activity request failed");
      const body = await response.json();
      setEvents((body.events as ActivityEvent[]).filter((event) => event.activity));
      setRuntime(body.runtime as DurableRuntimeSnapshot);
      setError("");
    } catch {
      setError("Agent activity could not be loaded. Retry when the service is available.");
      setEvents([]);
    }
  }, [role, status]);

  const resolveEffect = async (
    effect: DurableRuntimeSnapshot["unknownEffects"][number],
    choice: "confirm_applied" | "confirm_not_applied" | "compensate" | "cancel",
  ) => {
    setResolutionStatus("Submitting resolution…");
    try {
      const response = await fetch(`/api/jobs/${encodeURIComponent(effect.jobId)}/operations/${encodeURIComponent(effect.operationId)}/resolve`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({
          choice, reason: resolution.reason, expectedEpoch: effect.epoch,
          evidence: [{ artifactId: resolution.artifactId, digest: resolution.digest }],
        }),
      });
      if (!response.ok) throw new Error("resolution rejected");
      setResolutionStatus("Resolution recorded.");
      await load();
    } catch {
      setResolutionStatus("Resolution could not be recorded. Check the epoch and audit evidence.");
    }
  };
  const resolutionReady = resolution.reason.trim().length >= 10
    && /^[0-9a-f-]{36}$/i.test(resolution.artifactId)
    && /^[a-f0-9]{64}$/.test(resolution.digest);

  useEffect(() => {
    // Fetching is the external synchronization performed by this effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  return (
    <section className="workflow-activity" aria-label="Agent activity">
      <div className="ops-stack">
        {runtime && <Surface className="workflow-runtime" aria-label="Durable runtime health">
          <SectionHeader title="Durable runtime" description="Lease, queue, recovery, and effect-integrity signals from the current tenant." />
          <div className="workflow-metrics">
            <RuntimeMetric label="Stale leases" value={String(runtime.staleLeases.operations + runtime.staleLeases.inbox + runtime.staleLeases.outbox)} />
            <RuntimeMetric label="Unknown effects" value={String(runtime.unknownEffects.length)} />
            <RuntimeMetric label="Inbox lag" value={`${runtime.inboxLagSeconds}s`} />
            <RuntimeMetric label="Outbox lag" value={`${runtime.outboxLagSeconds}s`} />
            <RuntimeMetric label="Projection compiler" value={runtime.projection.compilerVersion ?? "none"} />
            <RuntimeMetric label="Artifact integrity" value={`${runtime.artifacts.ready} ready · ${runtime.artifacts.failed} failed · ${runtime.artifacts.writing} writing`} />
            <RuntimeMetric label="Recovery work" value={`${runtime.recovery.pending} pending`} />
            <RuntimeMetric label="Observed effects" value={String(runtime.observedEffects)} />
          </div>
          {runtime.unknownEffects.length > 0 && <div className="unknown-effects">
            <SectionHeader title="Resolve unknown effects" description="A resolution requires an operator reason and immutable evidence coordinates." />
            <div className="unknown-effects__fields">
              <FormField id="effect-reason" label="Reason"><TextInput value={resolution.reason} onChange={(event) => setResolution((current) => ({ ...current, reason: event.target.value }))} /></FormField>
              <FormField id="effect-artifact" label="Evidence artifact ID"><TextInput value={resolution.artifactId} onChange={(event) => setResolution((current) => ({ ...current, artifactId: event.target.value }))} /></FormField>
              <FormField id="effect-digest" label="Evidence digest"><TextInput value={resolution.digest} onChange={(event) => setResolution((current) => ({ ...current, digest: event.target.value }))} /></FormField>
            </div>
            {runtime.unknownEffects.map((effect) => <Surface as="article" variant="danger" className="unknown-effect" key={effect.operationId}>
              <strong>{effect.commandId}</strong>
              <p className="font-mono">{effect.operationId}@{effect.epoch}</p>
              <p>{effect.reason}</p>
              <div className="unknown-effect__actions">
                {([
                  ["confirm_applied", "Confirm applied"], ["confirm_not_applied", "Confirm not applied"],
                  ["compensate", "Compensate"], ["cancel", "Cancel"],
                ] as const).map(([choice, label]) => <Button key={choice} disabled={!resolutionReady} onClick={() => void resolveEffect(effect, choice)}>{label}</Button>)}
              </div>
            </Surface>)}
            {resolutionStatus && <p role="status" className="monitor-status-copy">{resolutionStatus}</p>}
          </div>}
        </Surface>}
        <Surface className="monitor-filter-bar">
          <Select aria-label="Filter by agent" value={role} onChange={(event) => setRole(event.target.value)}>
            <option value="">all agents</option>
            {ROLES.map((item) => <option key={item} value={item}>{item.replaceAll("_", " ")}</option>)}
          </Select>
          <Select aria-label="Filter by status" value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="">all states</option><option value="succeeded">succeeded</option><option value="retrying">retrying</option><option value="failed">failed</option>
          </Select>
          <Button onClick={() => void load()}>Refresh</Button>
        </Surface>
        {error ? <ErrorState title="Agent activity could not be loaded" message={error} action={<Button onClick={() => void load()}>Retry</Button>} /> : events === null ? (
          <LoadingState title="Loading agent activity" />
        ) : events.length === 0 ? (
          <EmptyState title="No structured agent activity matches these filters." />
        ) : (
          <ol className="workflow-events">
            {events.map((event) => {
              const item = event.activity!;
              return <li key={event.id}><button onClick={() => setSelected(event)}>
                <time>{event.at ? new Date(event.at).toLocaleString() : "pending"}</time>
                <span><strong>{item.kind === "handoff" ? `${item.fromRole} → ${item.toRole}` : `${item.role} · ${item.toolName ?? item.kind}`}</strong><span>{item.publicMessage}</span></span>
                <StatusBadge tone={STATUS_TONE[item.status]}>{item.status}</StatusBadge>
              </button></li>;
            })}
          </ol>
        )}
      </div>
      <Surface as="aside" className="workflow-details">
        <SectionHeader title="Activity details" description="Safe structured metadata only." />
        {!selected?.activity ? <p>Select an event to inspect its metadata.</p> : (
          <dl>
            <dt>Role</dt><dd>{selected.activity.role}</dd>
            <dt>Kind</dt><dd>{selected.activity.kind}</dd>
            <dt>Code</dt><dd>{selected.activity.code ?? "—"}</dd>
            <dt>Category</dt><dd>{selected.activity.category ?? "—"}</dd>
            <dt>Path</dt><dd>{selected.activity.path ?? "—"}</dd>
            <dt>Attempt</dt><dd>{selected.activity.attempt === undefined ? "—" : `${selected.activity.attempt}/${selected.activity.maxAttempts ?? "—"}`}</dd>
            <dt>Operation</dt><dd className="font-mono">{selected.operationId}</dd>
            <dt>Trace</dt><dd className="font-mono">{selected.traceId}</dd>
          </dl>
        )}
      </Surface>
    </section>
  );
}

function RuntimeMetric({ label, value }: { label: string; value: string }) {
  return <Surface variant="inset" className="workflow-metric"><span>{label}</span><strong title={value}>{value}</strong></Surface>;
}
