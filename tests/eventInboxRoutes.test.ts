import { beforeEach, describe, expect, it, vi } from "vitest";

const { claimDurableEvent, completeDurableEvent, claimDurableOperation, finalizeDurableOperation } = vi.hoisted(() => ({
  claimDurableEvent: vi.fn(),
  completeDurableEvent: vi.fn(),
  claimDurableOperation: vi.fn(),
  finalizeDurableOperation: vi.fn(),
}));
vi.mock("@/lib/firestore", () => ({
  claimDurableEvent,
  completeDurableEvent,
  claimDurableOperation,
  finalizeDurableOperation,
  assertDurableOperationFence: vi.fn().mockResolvedValue({}),
}));

import { POST as claimEvent } from "@/app/api/internal/event-inbox/claim/route";
import { POST as finalizeEvent } from "@/app/api/internal/event-inbox/finalize/route";
import { POST as claimOperation } from "@/app/api/internal/operation/claim/route";
import { POST as finalizeOperation } from "@/app/api/internal/operation/finalize/route";
import { eventPayloadDigest } from "@/lib/eventInbox";

const headers = {
  authorization: "Bearer test-internal-token",
  "content-type": "application/json",
  "x-workspace-id": "workspace-1",
  "x-brand-id": "brand-1",
};
const envelope = {
  schemaVersion: 1,
  source: "stage_outbox",
  sourceEventId: "stage-outbox:outbox-1",
  workspaceId: "workspace-1",
  brandId: "brand-1",
  jobId: "job-1",
  eventType: "stage.requested",
  operationId: "job:job-1:stage:draft",
  correlationId: "job:job-1",
  attempt: 0,
  trust: "system",
  occurredAt: "2026-08-28T12:00:00.000Z",
  payload: { stage: "draft" },
  payloadDigest: eventPayloadDigest({ stage: "draft" }),
};

function post(path: string, body: unknown, extraHeaders: Record<string, string> = {}) {
  return new Request(`http://localhost${path}`, {
    method: "POST",
    headers: { ...headers, ...extraHeaders },
    body: JSON.stringify(body),
  });
}

describe("durable event and operation routes", () => {
  beforeEach(() => {
    process.env.INTERNAL_API_TOKEN = "test-internal-token";
    process.env.AGENT_SERVICE_URL = "http://127.0.0.1:8080";
    claimDurableEvent.mockReset();
    completeDurableEvent.mockReset();
    claimDurableOperation.mockReset();
    finalizeDurableOperation.mockReset();
    claimDurableEvent.mockResolvedValue({ outcome: "execute", record: { id: "event-1" } });
    claimDurableOperation.mockResolvedValue({ outcome: "execute", operation: { epoch: 1 } });
    completeDurableEvent.mockResolvedValue({ state: "completed" });
    finalizeDurableOperation.mockResolvedValue({ state: "succeeded" });
  });

  it("derives event claim digests and operation intent server-side", async () => {
    const response = await claimEvent(post("/api/internal/event-inbox/claim", {
      envelope, pubsubMessageId: "delivery-1", claimToken: "s".repeat(32),
    }));
    expect(response.status).toBe(200);
    expect(claimDurableEvent).toHaveBeenCalledWith(expect.objectContaining({
      envelope,
      ownerTokenDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
      operation: expect.objectContaining({
        id: envelope.operationId,
        goal: expect.objectContaining({ digest: expect.stringMatching(/^[a-f0-9]{64}$/) }),
      }),
    }));
  });

  it("grants the verify stage an explicit verification operation authority", async () => {
    const verifyEnvelope = {
      ...envelope,
      operationId: "job:job-1:stage:verify:generation:1",
      payload: { stage: "verify" },
      payloadDigest: eventPayloadDigest({ stage: "verify" }),
    };
    const response = await claimEvent(post("/api/internal/event-inbox/claim", {
      envelope: verifyEnvelope, pubsubMessageId: "delivery-verify", claimToken: "v".repeat(32),
    }));

    expect(response.status).toBe(200);
    expect(claimDurableEvent).toHaveBeenCalledWith(expect.objectContaining({
      operation: expect.objectContaining({ kind: "verification" }),
    }));
  });

  it("claims operations without trusting a caller-supplied digest", async () => {
    const response = await claimOperation(post("/api/internal/operation/claim", {
      operationId: envelope.operationId,
      ownerId: "worker-1",
      claimToken: "t".repeat(32),
    }));
    expect(response.status).toBe(200);
    expect(claimDurableOperation).toHaveBeenCalledWith(envelope.operationId, expect.objectContaining({
      ownerTokenDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
    }));
  });

  it("requires fences on event and operation finalization", async () => {
    const eventResponse = await finalizeEvent(post("/api/internal/event-inbox/finalize", {
      source: envelope.source,
      sourceEventId: envelope.sourceEventId,
      claimToken: "s".repeat(32),
      outcome: "completed",
      operationEpoch: 1,
      operationState: "succeeded",
    }));
    const operationResponse = await finalizeOperation(post("/api/internal/operation/finalize", {
      operationId: envelope.operationId,
      epoch: 1,
      state: "succeeded",
    }));
    expect(eventResponse.status).toBe(400);
    expect(operationResponse.status).toBe(400);
    expect(completeDurableEvent).not.toHaveBeenCalled();
    expect(finalizeDurableOperation).not.toHaveBeenCalled();
  });
});
