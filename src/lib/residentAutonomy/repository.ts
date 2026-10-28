import { db } from "../firestore";
import { assertResourceWorkspace, currentTenant, tenantCollectionPath, validateTenantScope, type TenantScope } from "../tenancy";
import { agendaItemSchema, agendaSchema, attentionRequestSchema, autonomyCycleSchema, configurationRevisionSchema, experimentSchema, hypothesisSchema, observationSchema, reflectionSchema, type AutonomyCycle } from "./contracts";
import { claimCycle, transitionCycle, type CycleClaim, type CycleClaimResult } from "./cycles";

const collectionNames = {
  cycles: "autonomy_cycles", observations: "autonomy_observations", reflections: "autonomy_reflections",
  hypotheses: "autonomy_hypotheses", experiments: "autonomy_experiments", revisions: "autonomy_configuration_revisions",
  agendas: "autonomy_agendas", agenda_items: "autonomy_agenda_items", attention: "autonomy_attention_requests",
} as const;
export type ResidentCollection = keyof typeof collectionNames;
export function residentCollectionPath(scope: TenantScope, collection: ResidentCollection): string {
  validateTenantScope(scope); return tenantCollectionPath(scope, collectionNames[collection]);
}
function canonical(value: unknown): unknown { if (Array.isArray(value)) return value.map(canonical); if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => [key, canonical(entry)])); return value; }
export function assertImmutableRecord<T>(existing: T, candidate: T): T { if (JSON.stringify(canonical(existing)) !== JSON.stringify(canonical(candidate))) throw new Error("resident autonomy record is immutable"); return existing; }
function collection(name: ResidentCollection) { return db().collection(residentCollectionPath(currentTenant(), name)); }

export async function createResidentCycle(input: AutonomyCycle): Promise<{ created: boolean }> {
  const cycle = autonomyCycleSchema.parse(input); assertResourceWorkspace(currentTenant(), cycle); const ref = collection("cycles").doc(cycle.id);
  return db().runTransaction(async (tx) => { const existing = await tx.get(ref); if (existing.exists) return { created: false }; tx.create(ref, cycle); return { created: true }; });
}
export async function getResidentCycle(id: string): Promise<AutonomyCycle | null> { const snapshot = await collection("cycles").doc(id).get(); if (!snapshot.exists) return null; const cycle = autonomyCycleSchema.parse(snapshot.data()); assertResourceWorkspace(currentTenant(), cycle); return cycle; }
export async function listResidentCycles(limit = 100): Promise<AutonomyCycle[]> { const snapshots = await collection("cycles").orderBy("scheduledAt", "desc").limit(limit).get(); return snapshots.docs.map((doc) => autonomyCycleSchema.parse(doc.data())); }
export async function claimPersistedCycle(id: string, claim: CycleClaim): Promise<CycleClaimResult> {
  const ref = collection("cycles").doc(id); return db().runTransaction(async (tx) => { const snapshot = await tx.get(ref); if (!snapshot.exists) throw new Error("resident cycle not found"); const result = claimCycle(autonomyCycleSchema.parse(snapshot.data()), claim); if (result.outcome === "execute") tx.update(ref, result.cycle); else if (result.outcome === "uncertain" && result.cycle.state === "uncertain") tx.update(ref, result.cycle); return result; });
}
export async function transitionPersistedCycle(id: string, input: Parameters<typeof transitionCycle>[1]): Promise<AutonomyCycle> { const ref = collection("cycles").doc(id); return db().runTransaction(async (tx) => { const snapshot = await tx.get(ref); if (!snapshot.exists) throw new Error("resident cycle not found"); const next = transitionCycle(autonomyCycleSchema.parse(snapshot.data()), input); tx.update(ref, next); return next; }); }

const immutableSchemas = { observations: observationSchema, reflections: reflectionSchema, hypotheses: hypothesisSchema, experiments: experimentSchema, revisions: configurationRevisionSchema, agendas: agendaSchema, agenda_items: agendaItemSchema, attention: attentionRequestSchema } as const;
export async function createImmutableResidentRecord<K extends keyof typeof immutableSchemas>(kind: K, input: unknown): Promise<{ created: boolean }> {
  const record = immutableSchemas[kind].parse(input) as { id: string; workspaceId: string; brandId: string }; assertResourceWorkspace(currentTenant(), record); const ref = collection(kind).doc(record.id);
  return db().runTransaction(async (tx) => { const existing = await tx.get(ref); if (existing.exists) { assertImmutableRecord(existing.data(), record); return { created: false }; } tx.create(ref, record); return { created: true }; });
}
export async function listResidentRecords<K extends keyof typeof immutableSchemas>(kind: K, limit = 100): Promise<unknown[]> { const snapshots = await collection(kind).limit(limit).get(); return snapshots.docs.map((doc) => immutableSchemas[kind].parse(doc.data())); }
