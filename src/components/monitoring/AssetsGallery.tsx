"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/dashboard/Button";
import { StatusBadge } from "@/components/dashboard/StatusBadge";
import { Surface } from "@/components/dashboard/Surface";
import { EmptyState, ErrorState, LoadingState } from "@/components/dashboard/SystemState";

interface AssetInfo { actionId: string; jobId: string; mime: string; digest: string; sizeBytes: number; createdAt: string; }
const FILTERS = [{ value: "", label: "All assets" }, { value: "video/mp4", label: "Clips & reels" }, { value: "image/png", label: "Images" }] as const;

export default function AssetsGallery() {
  const [assets, setAssets] = useState<AssetInfo[] | null>(null);
  const [mimeFilter, setMimeFilter] = useState("");
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);

  useEffect(() => {
    const timer = setTimeout(() => {
      fetch("/api/assets", { cache: "no-store" })
        .then((response) => response.ok ? response.json() : Promise.reject(new Error(`HTTP ${response.status}`)))
        .then((body) => { setAssets(body.assets); setError(""); })
        .catch((cause) => setError(cause instanceof Error ? cause.message : "Assets request failed"));
    }, 0);
    return () => clearTimeout(timer);
  }, [reload]);

  const rows = (assets ?? []).filter((asset) => !mimeFilter || asset.mime === mimeFilter);
  return <div className="ops-stack">
    <Surface className="monitor-filter-bar"><div className="ops-chip-row" aria-label="Asset type filters">
      {FILTERS.map((filter) => <Button key={filter.value || "all"} variant={mimeFilter === filter.value ? "primary" : "quiet"} onClick={() => setMimeFilter(filter.value)}>{filter.label}</Button>)}
    </div><span className="monitor-result-count">{rows.length} asset{rows.length === 1 ? "" : "s"}</span></Surface>
    {error ? <ErrorState title="Assets could not be loaded" message={error} action={<Button onClick={() => setReload((value) => value + 1)}>Retry</Button>} />
      : assets === null ? <LoadingState title="Loading assets" />
      : rows.length === 0 ? <EmptyState title="No assets match" message={mimeFilter ? "Choose another asset type or clear the filter." : "Approve image or clip actions on a job and verified assets will appear here."} />
      : <div className="asset-grid">{rows.map((asset) => <Surface as="article" variant="raised" className="asset-card" key={`${asset.jobId}_${asset.actionId}`}>
        <figure>{asset.mime.startsWith("video/") ? <video src={`/api/jobs/${asset.jobId}/assets/${asset.actionId}`} controls /> : (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={`/api/jobs/${asset.jobId}/assets/${asset.actionId}`} alt={`Asset ${asset.actionId}`} />
        )}<figcaption><div className="asset-card__heading"><StatusBadge tone="generated">{asset.mime}</StatusBadge><strong>{(asset.sizeBytes / 1024).toFixed(0)} KB</strong></div><dl><dt>Job</dt><dd>{asset.jobId.slice(0, 14)}</dd><dt>Digest</dt><dd title={asset.digest}>sha256 {asset.digest.slice(0, 14)}…</dd><dt>Created</dt><dd>{new Date(asset.createdAt).toLocaleString()}</dd></dl></figcaption></figure>
      </Surface>)}</div>}
  </div>;
}
