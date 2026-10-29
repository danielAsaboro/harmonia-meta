import { createArtifactStore } from "@/lib/artifactStore";
import { assertDurableOperationFence, db } from "@/lib/firestore";
import { internalTenantHandler } from "@/lib/internalAuth";
import { isOperationFenceConflict, readOperationFenceHeaders } from "@/lib/internalHandler";
import { currentTenant } from "@/lib/tenancy";

function integer(value: string | null): number | null {
  if (value === null || !/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

async function get(req: Request, { params }: { params: Promise<{ id: string }> }) {
  let fence: { operationId: string; epoch: number };
  try {
    fence = readOperationFenceHeaders(req);
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
  const tenant = currentTenant();
  let operation;
  try {
    operation = await assertDurableOperationFence({
      ...fence,
      workspaceId: tenant.workspaceId,
      brandId: tenant.brandId,
      now: new Date().toISOString(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ error: message }, { status: isOperationFenceConflict(error) ? 409 : 500 });
  }

  const url = new URL(req.url);
  const offset = integer(url.searchParams.get("offset"));
  const length = integer(url.searchParams.get("length"));
  const lineStart = integer(url.searchParams.get("lineStart"));
  const lineCount = integer(url.searchParams.get("lineCount"));
  const byteMode = offset !== null || length !== null;
  const lineMode = lineStart !== null || lineCount !== null;
  if (byteMode === lineMode || (byteMode && (offset === null || length === null))
    || (lineMode && (lineStart === null || lineCount === null))) {
    return Response.json({ error: "provide exactly one complete bounded byte or line window" }, { status: 400 });
  }

  try {
    const { id } = await params;
    const result = await createArtifactStore(db()).read(
      id,
      byteMode ? { offset: offset!, length: length! } : { lineStart: lineStart!, lineCount: lineCount! },
    );
    const sameJobIndependentRead = (operation.kind === "verification" || operation.kind === "effect")
      && operation.jobId === result.record.jobId;
    if (result.record.operationId !== fence.operationId && !sameJobIndependentRead) {
      return Response.json({ error: "operation fence does not authorize this artifact" }, { status: 409 });
    }
    if (result.kind === "lines") {
      return Response.json({
        artifact: result.record,
        text: result.text,
        lineStart: result.lineStart,
        nextLine: result.nextLine,
        complete: result.complete,
      });
    }
    return Response.json({
      artifact: result.record,
      dataBase64: result.bytes.toString("base64"),
      offset: result.offset,
      nextOffset: result.nextOffset,
      complete: result.complete,
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}

export const GET = internalTenantHandler(get);
