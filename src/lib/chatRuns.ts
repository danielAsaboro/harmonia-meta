import { db } from "./firestore";
import { newId } from "./idempotency";
import { parseChatStreamEvent, type ChatStreamEvent } from "./a2ui/contracts";
import { assertResourceWorkspace, currentTenant, tenantCollectionPath, tenantSubjectId } from "./tenancy";

export type UnsequencedChatStreamEvent = ChatStreamEvent extends infer Event
  ? Event extends { runId: string; sequence: number }
    ? Omit<Event, "runId" | "sequence">
    : never
  : never;

export interface ChatRunDoc {
  id: string;
  workspaceId: string;
  brandId: string;
  createdByUserId: string;
  message: string;
  attachmentIds: string[];
  status: "running" | "complete" | "failed" | "cancelled";
  lastSequence: number;
  createdAt: string;
  updatedAt: string;
}

function collection() {
  return db().collection(tenantCollectionPath(currentTenant(), "chat_runs"));
}

export async function createChatRun(message: string, attachmentIds: string[]): Promise<ChatRunDoc> {
  const tenant = currentTenant();
  const now = new Date().toISOString();
  const run: ChatRunDoc = {
    id: newId(),
    workspaceId: tenant.workspaceId,
    brandId: tenant.brandId,
    createdByUserId: tenantSubjectId(tenant),
    message,
    attachmentIds: [...new Set(attachmentIds)],
    status: "running",
    lastSequence: -1,
    createdAt: now,
    updatedAt: now,
  };
  await collection().doc(run.id).set(run);
  return run;
}

export async function getChatRun(id: string): Promise<ChatRunDoc | null> {
  const snap = await collection().doc(id).get();
  if (!snap.exists) return null;
  const run = snap.data() as ChatRunDoc;
  assertResourceWorkspace(currentTenant(), run);
  return run;
}

export async function appendChatRunEvent(runId: string, input: UnsequencedChatStreamEvent): Promise<ChatStreamEvent> {
  const runRef = collection().doc(runId);
  return db().runTransaction(async (transaction) => {
    const runSnap = await transaction.get(runRef);
    if (!runSnap.exists) throw new Error("chat run not found");
    const run = runSnap.data() as ChatRunDoc;
    assertResourceWorkspace(currentTenant(), run);
    if (run.status !== "running" && input.type !== "run_failed") throw new Error("chat run is terminal");
    const sequence = run.lastSequence + 1;
    const event = parseChatStreamEvent({ ...input, runId, sequence });
    const terminal = event.type === "run_completed" ? "complete" : event.type === "run_failed" ? "failed" : run.status;
    const updatedAt = new Date().toISOString();
    transaction.set(runRef.collection("events").doc(String(sequence).padStart(12, "0")), event);
    transaction.update(runRef, { lastSequence: sequence, status: terminal, updatedAt });
    return event;
  });
}

export async function listChatRunEvents(runId: string, afterSequence = -1): Promise<ChatStreamEvent[]> {
  const run = await getChatRun(runId);
  if (!run) throw new Error("chat run not found");
  const snaps = await collection().doc(runId).collection("events")
    .where("sequence", ">", afterSequence)
    .orderBy("sequence", "asc")
    .limit(500)
    .get();
  return snaps.docs.map((doc) => parseChatStreamEvent(doc.data()));
}
