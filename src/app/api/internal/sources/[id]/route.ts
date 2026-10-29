import { normalizedSourceSchema } from "@/lib/contracts";
import { db } from "@/lib/firestore";
import { isInternalAuthorized, unauthorized, withInternalTenant } from "@/lib/internalAuth";
import { putArtifact } from "@/lib/storage";
import { currentTenant } from "@/lib/tenancy";
import { z } from "zod";

const updateSchema = z.discriminatedUnion("outcome", [
  z.object({ outcome: z.literal("transition"), expectedState: z.enum(["discovered", "validating", "queued"]), nextState: z.enum(["validating", "queued", "extracting"]) }).strict(),
  z.object({ outcome: z.literal("ready"), expectedState: z.literal("extracting"), normalizedSource: normalizedSourceSchema }).strict(),
  z.object({ outcome: z.literal("failed"), expectedState: z.enum(["validating", "queued", "extracting"]), failure: z.object({ code: z.string().min(1), category: z.string().min(1), publicMessage: z.string().min(1).max(240), retryable: z.boolean(), occurredAt: z.string().datetime({ offset: true }) }).strict() }).strict(),
]);
const refs = (id: string) => { const tenant = currentTenant(); return { source: db().doc(`workspaces/${tenant.workspaceId}/brands/${tenant.brandId}/sources/${id}`), payload: db().doc(`workspaces/${tenant.workspaceId}/brands/${tenant.brandId}/source_payloads/${id}`) }; };

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) { if (!isInternalAuthorized(request)) return unauthorized(); return withInternalTenant(request, async () => { const pair = refs((await params).id); const [source, payload] = await Promise.all([pair.source.get(), pair.payload.get()]); if (!source.exists) return Response.json({ error: "source not found" }, { status: 404 }); return Response.json({ source: source.data(), payload: payload.data() }); }); }

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isInternalAuthorized(request)) return unauthorized();
  return withInternalTenant(request, async () => {
    const { id } = await params; const parsed = updateSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return Response.json({ error: "invalid extraction result", detail: parsed.error.flatten() }, { status: 400 });
    const pair = refs(id); let artifactId: string | undefined;
    if (parsed.data.outcome === "ready") { artifactId = `normalized_source_${id}_${parsed.data.normalizedSource.contentDigest}`; await putArtifact(artifactId, Buffer.from(JSON.stringify(parsed.data.normalizedSource)), "application/json"); }
    await db().runTransaction(async (transaction) => { const current = await transaction.get(pair.source); if (!current.exists || current.get("state") !== parsed.data.expectedState) throw new Error("source state conflict"); const patch = parsed.data.outcome === "transition" ? { state: parsed.data.nextState } : parsed.data.outcome === "ready" ? { state: "ready", contentDigest: parsed.data.normalizedSource.contentDigest, normalizedArtifactId: artifactId, extractionReceiptId: parsed.data.normalizedSource.extractionReceiptId } : { state: "failed", failure: parsed.data.failure }; transaction.update(pair.source, { ...patch, updatedAt: new Date().toISOString() }); });
    return Response.json({ ok: true, sourceId: id, outcome: parsed.data.outcome, artifactId });
  });
}
