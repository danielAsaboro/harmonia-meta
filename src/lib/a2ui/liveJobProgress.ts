import type { Stage } from "../types";
import { parseHarmoniaA2uiOperation } from "@/components/a2ui/HarmoniaCatalog";
import { jobProgressState } from "./jobProgress";

// Generated layout is reusable; a historical status snapshot is not live truth.
export function currentJobProgressOperations(operations: unknown[], job: { id: string; stage: Stage; status: string }): unknown[] {
  return operations.map((input) => {
    const operation = parseHarmoniaA2uiOperation(input) as unknown as {
      updateComponents?: { surfaceId: string; components: Array<Record<string, unknown>> };
    };
    if (!operation.updateComponents) return input;
    return { ...operation, updateComponents: { ...operation.updateComponents, components: operation.updateComponents.components.map((component) => {
      if (component.component !== "JobProgress") return component;
      if (component.jobId !== job.id) throw new Error("Generated progress belongs to a different job");
      return { ...component, ...jobProgressState(job) };
    }) } };
  });
}
