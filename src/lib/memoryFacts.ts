import { createHash } from "node:crypto";
import { z } from "zod";
import { db } from "./firestore";
import { currentTenant, tenantCollectionPath } from "./tenancy";

const MEMORY_FACTS = "memory_facts";
const scopedId = z.string().min(1).max(128).regex(/^[A-Za-z0-9._-]+$/);

export const memoryFactSchema = z.object({
  kind: z.enum(["operator_decision", "verified_outcome", "learning", "preference"]),
  fact: z.string().min(1).max(1000),
  evidence_ref: z.object({
    workspace_id: scopedId,
    brand_id: scopedId,
    job_id: scopedId,
    kind: z.enum(["decision", "receipt", "verification", "learning"]),
    record_id: z.string().min(1).max(240).regex(/^[A-Za-z0-9._:-]+$/),
  }).strict(),
}).strict();

export type MemoryFact = z.infer<typeof memoryFactSchema>;

export const memoryWriteSchema = z.object({
  brandId: scopedId,
  facts: z.array(memoryFactSchema).min(1).max(5),
}).strict();

export const memorySearchSchema = z.object({
  brandId: scopedId,
  query: z.string().min(1).max(1000),
  topK: z.number().int().min(1).max(5),
}).strict();

interface StoredMemoryFact extends MemoryFact {
  createdAt: string;
}

function tokens(text: string): Set<string> {
  return new Set(text.toLowerCase().match(/[a-z0-9]{3,}/g) ?? []);
}

/** Rank by shared words with the query, newest first on ties; facts with no overlap are dropped. */
export function rankMemoryFacts(facts: StoredMemoryFact[], query: string, topK: number): MemoryFact[] {
  const wanted = tokens(query);
  return facts
    .map((fact) => ({ fact, score: [...tokens(fact.fact)].filter((token) => wanted.has(token)).length }))
    .filter(({ score }) => score > 0)
    .sort((left, right) => right.score - left.score || right.fact.createdAt.localeCompare(left.fact.createdAt))
    .slice(0, topK)
    .map(({ fact: { createdAt: _createdAt, ...fact } }) => fact);
}

function memoryCollection() {
  return db().collection(tenantCollectionPath(currentTenant(), MEMORY_FACTS));
}

function assertScope(brandId: string, facts: MemoryFact[]): void {
  const { workspaceId } = currentTenant();
  if (facts.some((fact) => fact.evidence_ref.workspace_id !== workspaceId || fact.evidence_ref.brand_id !== brandId)) {
    throw new Error("memory fact evidence does not match the tenant scope");
  }
}

export async function saveMemoryFacts(brandId: string, facts: MemoryFact[]): Promise<number> {
  assertScope(brandId, facts);
  const batch = db().batch();
  const createdAt = new Date().toISOString();
  for (const fact of facts) {
    const id = createHash("sha256").update(JSON.stringify(fact)).digest("hex").slice(0, 40);
    batch.set(memoryCollection().doc(id), { ...fact, createdAt } satisfies StoredMemoryFact, { merge: false });
  }
  await batch.commit();
  return facts.length;
}

export async function searchMemoryFacts(brandId: string, query: string, topK: number): Promise<MemoryFact[]> {
  const snapshot = await memoryCollection()
    .where("evidence_ref.brand_id", "==", brandId)
    .orderBy("createdAt", "desc")
    .limit(200)
    .get();
  const facts = snapshot.docs.map((doc) => doc.data() as StoredMemoryFact);
  assertScope(brandId, facts);
  return rankMemoryFacts(facts, query, topK);
}
