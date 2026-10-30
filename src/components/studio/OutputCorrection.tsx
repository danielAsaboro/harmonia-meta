"use client";
import { useState } from "react";
import { apiFetch } from "@/lib/clientApi";
import type { JobFull } from "@/components/jobTypes";
import { OUTPUT_CAPABILITIES } from "@/lib/outputCapabilities";
import type { OutputKind } from "@/lib/types";

export function OutputCorrection({ job }: { job: JobFull }) {
  const [selected, setSelected] = useState<OutputKind[]>(job.config.desiredOutputs ?? []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (job.status !== "failed" || !["collect_sources", "extract_sources", "understand"].includes(job.stage) || job.actions.length) return null;
  async function save() {
    setBusy(true); setError("");
    try {
      const response = await apiFetch(`/api/jobs/${job.id}/outputs`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ expectedControlEpoch: job.controlEpoch ?? 0, desiredOutputs: selected }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Output correction failed");
      window.location.reload();
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  }
  return <details className="mb-5 border border-black/20 bg-white p-4"><summary className="cursor-pointer font-bold">Correct requested outputs</summary>
    <p className="my-3 text-sm">Review the exact outputs before retrying. A content pack needs at least one written child output. This records your change without restarting the job or granting publishing approval.</p>
    <div className="grid grid-cols-2 gap-2">{(Object.keys(OUTPUT_CAPABILITIES) as OutputKind[]).filter((kind) => OUTPUT_CAPABILITIES[kind].state !== "unavailable").map((kind) => <label key={kind} className="text-sm"><input type="checkbox" checked={selected.includes(kind)} onChange={(event) => setSelected(event.target.checked ? [...selected, kind] : selected.filter((value) => value !== kind))} /> {kind.replaceAll("_", " ")}</label>)}</div>
    {error ? <p role="alert" className="mt-2 text-red-700">{error}</p> : null}
    <button disabled={busy || !selected.length} onClick={() => void save()} className="mt-4 bg-black px-4 py-2 text-sm text-white">Save output correction</button>
  </details>;
}
