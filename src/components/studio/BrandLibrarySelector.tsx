"use client";
import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/clientApi";
interface LibraryOption { id: string; name: string; currentHealthySnapshotId?: string }
export function BrandLibrarySelector({ selected, onSelect, disabled }: { selected: string; onSelect: (name: string) => void; disabled?: boolean }) {
  const [libraries, setLibraries] = useState<LibraryOption[]>([]);
  useEffect(() => { void apiFetch("/api/settings/libraries").then((response) => response.json()).then((body) => setLibraries((body.libraries ?? []).filter((item: LibraryOption) => item.currentHealthySnapshotId))); }, []);
  return <label className="flex items-center gap-1.5 font-mono text-[8px] uppercase text-black/50">Brand library<select aria-label="Brand library" value={selected} disabled={disabled} onChange={(event) => onSelect(event.target.value)} className="max-w-44 rounded-full border border-black/15 bg-white px-2 py-1 text-[9px] normal-case text-black"><option value="">No library</option>{libraries.map((library) => <option key={library.id} value={library.name}>{library.name}</option>)}</select></label>;
}
