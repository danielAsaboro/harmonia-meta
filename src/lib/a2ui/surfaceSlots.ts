import { parseHarmoniaA2uiOperation } from "@/components/a2ui/HarmoniaCatalog";
import type { SurfaceSlot } from "./presentationContracts";

interface SurfaceIdentity {
  runId: string;
  slot: SurfaceSlot;
  revision: number;
}

interface SurfaceRevision extends SurfaceIdentity {
  operations: unknown[];
  hasRoot: boolean;
}

const SURFACE_ID = /^studio-([A-Za-z0-9][A-Za-z0-9_-]{0,199})-(canvas|conversation|approval)-r([1-9]\d{0,8})$/;

function parseSurfaceId(surfaceId: string): SurfaceIdentity {
  const match = SURFACE_ID.exec(surfaceId);
  if (!match) throw new Error(`invalid Harmonia studio surface id: ${surfaceId}`);
  const revision = Number(match[3]);
  if (!Number.isSafeInteger(revision)) throw new Error(`invalid Harmonia studio surface revision: ${surfaceId}`);
  return {
    runId: match[1],
    slot: match[2] as SurfaceSlot,
    revision,
  };
}

export function latestSurfaceOperations(operations: unknown[], slot: SurfaceSlot): unknown[] {
  const revisions = new Map<string, SurfaceRevision>();

  for (const input of operations) {
    const parsed = parseHarmoniaA2uiOperation(input) as unknown as {
      createSurface?: { surfaceId: string };
      updateComponents?: { surfaceId: string; components: Array<{ id: string }> };
    };
    if (parsed.createSurface) {
      const { surfaceId } = parsed.createSurface;
      if (revisions.has(surfaceId)) throw new Error(`duplicate createSurface for ${surfaceId}`);
      revisions.set(surfaceId, {
        ...parseSurfaceId(surfaceId),
        operations: [input],
        hasRoot: false,
      });
      continue;
    }
    if (parsed.updateComponents) {
      const { surfaceId, components } = parsed.updateComponents;
      parseSurfaceId(surfaceId);
      const revision = revisions.get(surfaceId);
      if (!revision) throw new Error(`updateComponents arrived before createSurface for ${surfaceId}`);
      revision.operations.push(input);
      revision.hasRoot ||= components.some((component) => component.id === "root");
      continue;
    }
    throw new Error("unsupported operation in Harmonia studio surface stream");
  }

  const complete = [...revisions.values()]
    .filter((revision) => revision.slot === slot && revision.hasRoot)
    .sort((left, right) => right.revision - left.revision);
  return complete[0]?.operations ?? [];
}
