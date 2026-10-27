import { z } from "zod";

import { attentionItemSchema, type AttentionItem } from "./attention";
import { jobShellSchema, type JobShell } from "./jobShell";

const base = {
  sequence: z.number().int().nonnegative(),
  occurredAt: z.string().datetime({ offset: true }),
} as const;

export const operationalUpdateSchema = z.discriminatedUnion("type", [
  z.object({ ...base, type: z.literal("job_shell_upserted"), shell: jobShellSchema }).strict(),
  z.object({ ...base, type: z.literal("job_shell_removed"), jobId: z.string().min(1).max(300) }).strict(),
  z.object({ ...base, type: z.literal("attention_upserted"), item: attentionItemSchema }).strict(),
  z.object({ ...base, type: z.literal("attention_removed"), attentionId: z.string().min(1).max(700) }).strict(),
]);
export type OperationalUpdate = z.infer<typeof operationalUpdateSchema>;
export type UnsequencedOperationalUpdate = OperationalUpdate extends infer Event
  ? Event extends { sequence: number }
    ? Omit<Event, "sequence">
    : never
  : never;

export interface OperationalFeedState {
  snapshotSequence: number;
  jobs: Record<string, JobShell>;
  attention: Record<string, AttentionItem>;
}

export function parseOperationalUpdate(value: unknown): OperationalUpdate {
  return operationalUpdateSchema.parse(value);
}

export function initialOperationalFeedState(): OperationalFeedState {
  return { snapshotSequence: -1, jobs: {}, attention: {} };
}

export function reduceOperationalUpdate(
  state: OperationalFeedState,
  input: OperationalUpdate,
): OperationalFeedState {
  const event = parseOperationalUpdate(input);
  if (event.sequence <= state.snapshotSequence) return state;
  if (event.sequence !== state.snapshotSequence + 1) {
    throw new Error(`operational update sequence gap after ${state.snapshotSequence}: received ${event.sequence}`);
  }
  switch (event.type) {
    case "job_shell_upserted":
      return { ...state, snapshotSequence: event.sequence, jobs: { ...state.jobs, [event.shell.jobId]: event.shell } };
    case "job_shell_removed": {
      const jobs = { ...state.jobs };
      delete jobs[event.jobId];
      return { ...state, snapshotSequence: event.sequence, jobs };
    }
    case "attention_upserted":
      return { ...state, snapshotSequence: event.sequence, attention: { ...state.attention, [event.item.id]: event.item } };
    case "attention_removed": {
      const attention = { ...state.attention };
      delete attention[event.attentionId];
      return { ...state, snapshotSequence: event.sequence, attention };
    }
  }
}
