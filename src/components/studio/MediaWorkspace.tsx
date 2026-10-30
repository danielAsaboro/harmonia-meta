/* eslint-disable @next/next/no-img-element */
import type { StudioAsset, StudioMediaKind } from "@/lib/studio/workspaceModel";
import { StudioEmpty } from "./StudioStates";

export function MediaWorkspace({ kind, jobId, assets, selectedArtifactId, onSelect }: { kind: StudioMediaKind; jobId: string; assets: StudioAsset[]; selectedArtifactId: string | null; onSelect: (artifactId: string) => void }) {
  if (assets.length === 0) return <StudioEmpty title={`No ${kind} asset exists for this working set`}>Generated and rendered media appears here only after a real artifact is persisted.</StudioEmpty>;
  return (
    <div className={`grid gap-4 ${kind === "visual" ? "md:grid-cols-2" : "grid-cols-1"}`}>
      {assets.map((asset) => {
        const artifactId = `${kind}:${asset.actionId}`;
        const src = `/api/jobs/${jobId}/assets/${asset.actionId}`;
        return (
          <article key={asset.actionId} tabIndex={-1} data-canvas-artifact={artifactId} onClick={() => onSelect(artifactId)} className={`overflow-hidden border-2 bg-[#fffdf7] transition ${selectedArtifactId === artifactId ? "border-[#3157ff] shadow-[7px_7px_0_#3157ff]" : "border-black/15 hover:border-black/45"}`}>
            <div className="relative bg-[#161512]">
              {asset.mime.startsWith("image/") ? <img src={src} alt={asset.title} className="aspect-[4/3] w-full object-cover" /> : null}
              {asset.mime.startsWith("video/") ? <><video src={src} controls aria-label={asset.title} className="aspect-video w-full bg-black object-contain" />{asset.captionSafeRegion ? <div className="pointer-events-none absolute inset-x-[12%] bottom-[18%] top-[9%] border border-dashed border-[#d9ff43]/90"><span className="absolute -top-6 left-0 bg-[#d9ff43] px-2 py-1 text-[8px] font-black uppercase tracking-wider text-black">Caption safe · {asset.captionSafeRegion}</span></div> : null}</> : null}
              {asset.mime.startsWith("audio/") ? <div className="grid min-h-44 place-items-center bg-[radial-gradient(circle_at_20%_20%,#8d5cff_0,transparent_34%),radial-gradient(circle_at_80%_70%,#3157ff_0,transparent_32%),#17151e] p-6"><div className="w-full"><div className="mb-5 flex h-12 items-end gap-1" aria-hidden>{Array.from({ length: 24 }, (_, index) => <span key={index} className="flex-1 bg-[#d9ff43]" style={{ height: `${18 + ((index * 17) % 78)}%` }} />)}</div><audio src={src} controls aria-label={asset.title} className="w-full" /></div></div> : null}
              {asset.provider ? <span className="absolute left-3 top-3 bg-[#d9ff43] px-2 py-1 text-[9px] font-black uppercase tracking-[0.16em] text-black">{asset.provider === "lyria" ? "Lyria" : "Veo"}</span> : null}
            </div>
            <div className="flex items-center gap-3 p-4"><div className="min-w-0 flex-1"><h3 className="truncate font-serif text-lg">{asset.title}</h3><p className="mt-1 font-mono text-[10px] uppercase text-black/40">{asset.mime} · {(asset.sizeBytes / 1_048_576).toFixed(2)} MB</p>{asset.momentTitle ? <p className="mt-2 text-xs text-black/55">↳ {asset.momentTitle}{asset.startSec !== undefined && asset.endSec !== undefined ? ` · ${asset.startSec}s–${asset.endSec}s` : ""}{asset.cropSuitability ? ` · ${asset.cropSuitability} crop` : ""}</p> : null}</div><span className="text-xl">↗</span></div>
          </article>
        );
      })}
    </div>
  );
}
