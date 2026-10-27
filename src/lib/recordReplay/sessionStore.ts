import { randomUUID } from "node:crypto";
import { ReplayDispatcher } from "./dispatcher";
import { importReplayBundle } from "./importer";
import type { ReplayEvent } from "./schema";

export interface ReplaySession { id: string; dispatcher: ReplayDispatcher; metadata: { executionMode: "recorded_replay"; evidenceClassification: "historical_replay"; bundleId: string; capturedAt: string; scenario: string }; eventsAfter(sequence: number): readonly ReplayEvent[]; start(options?: { immediate?: boolean }): Promise<void> }
const sessions = new Map<string, ReplaySession>();
const LIMIT = 20;
export function createReplaySession(raw: string): ReplaySession {
  const bundle = importReplayBundle(raw, { destination: "private" });
  const delivered: ReplayEvent[] = [];
  const dispatcher = new ReplayDispatcher(bundle, (event) => delivered.push(event));
  const session: ReplaySession = { id: randomUUID(), dispatcher, metadata: { executionMode: "recorded_replay", evidenceClassification: "historical_replay", bundleId: bundle.bundleId, capturedAt: bundle.capturedAt, scenario: bundle.scenario }, eventsAfter: (sequence) => delivered.filter((event) => event.sequence > sequence), start: (options) => dispatcher.start(options) };
  if (sessions.size >= LIMIT) sessions.delete(sessions.keys().next().value as string);
  sessions.set(session.id, session); return session;
}
export function getReplaySession(id: string): ReplaySession | undefined { return sessions.get(id); }
