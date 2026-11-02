import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

const { assertDurableOperationFence } = vi.hoisted(() => ({
  assertDurableOperationFence: vi.fn(),
}));
vi.mock("@/lib/firestore", () => ({ assertDurableOperationFence }));

import { internalRoute, readOperationFenceHeaders } from "@/lib/internalHandler";

function request(headers: Record<string, string> = {}) {
  return new Request("http://localhost/api/internal/protected", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-workspace-id": "workspace-1",
      "x-brand-id": "brand-1",
      ...headers,
    },
    body: JSON.stringify({ value: "ok" }),
  });
}

describe("internal operation fences", () => {
  beforeEach(() => {
    assertDurableOperationFence.mockReset();
    assertDurableOperationFence.mockResolvedValue({ id: "job:job-1:stage:draft", epoch: 3 });
  });

  it("parses an explicit operation id and positive integer epoch", () => {
    expect(readOperationFenceHeaders(request({
      "x-harmonia-operation-id": "job:job-1:stage:draft",
      "x-harmonia-operation-epoch": "3",
    }))).toEqual({ operationId: "job:job-1:stage:draft", epoch: 3 });
    expect(() => readOperationFenceHeaders(request())).toThrow("operation fence headers required");
    expect(() => readOperationFenceHeaders(request({
      "x-harmonia-operation-id": "job:job-1:stage:draft",
      "x-harmonia-operation-epoch": "1.5",
    }))).toThrow("operation epoch header is invalid");
  });

  it("rejects missing fences before invoking a protected mutation", async () => {
    const handler = vi.fn();
    const response = await internalRoute(
      request(),
      z.object({ value: z.string() }),
      handler,
      { requireFence: true },
    );
    expect(response.status).toBe(400);
    expect(handler).not.toHaveBeenCalled();
  });

  it("returns safe field-level diagnostics for invalid internal payloads", async () => {
    const invalid = new Request("http://localhost/api/internal/strategy-context", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ value: Array.from({ length: 3 }, () => "private-source-content") }),
    });
    const response = await internalRoute(
      invalid,
      z.object({ value: z.array(z.string()).max(2) }),
      vi.fn(),
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.contractRevision).toMatch(/^internal-contract-/);
    expect(body.issues).toEqual([
      expect.objectContaining({ path: "value", code: "too_big", maximum: 2 }),
    ]);
    expect(JSON.stringify(body)).not.toContain("private-source-content");
  });

  it.each([
    "operation epoch mismatch",
    "operation tenant mismatch",
    "operation lease expired",
    "operation is succeeded",
  ])("maps an invalid durable fence to conflict: %s", async (message) => {
    assertDurableOperationFence.mockRejectedValueOnce(new Error(message));
    const handler = vi.fn();
    const response = await internalRoute(
      request({
        "x-harmonia-operation-id": "job:job-1:stage:draft",
        "x-harmonia-operation-epoch": "3",
      }),
      z.object({ value: z.string() }),
      handler,
      { requireFence: true },
    );
    expect(response.status).toBe(409);
    expect(handler).not.toHaveBeenCalled();
  });

  it("keeps persistence outages retryable instead of misclassifying them as fence conflicts", async () => {
    assertDurableOperationFence.mockRejectedValueOnce(new Error("14 UNAVAILABLE: Firestore offline"));
    const response = await internalRoute(
      request({
        "x-harmonia-operation-id": "job:job-1:stage:draft",
        "x-harmonia-operation-epoch": "3",
      }),
      z.object({ value: z.string() }),
      vi.fn(),
      { requireFence: true },
    );
    expect(response.status).toBe(500);
  });

  it("checks the current tenant and epoch before invoking the handler", async () => {
    const handler = vi.fn(async () => Response.json({ written: true }));
    const response = await internalRoute(
      request({
        "x-harmonia-operation-id": "job:job-1:stage:draft",
        "x-harmonia-operation-epoch": "3",
      }),
      z.object({ value: z.string() }),
      handler,
      { requireFence: true },
    );
    expect(response.status).toBe(200);
    expect(assertDurableOperationFence).toHaveBeenCalledWith(expect.objectContaining({
      operationId: "job:job-1:stage:draft",
      workspaceId: "workspace-1",
      brandId: "brand-1",
      epoch: 3,
    }));
    expect(handler).toHaveBeenCalledWith({ value: "ok" });
  });

  it("binds a protected mutation to the operation named by its body", async () => {
    const handler = vi.fn();
    const response = await internalRoute(
      request({
        "x-harmonia-operation-id": "job:job-1:stage:draft",
        "x-harmonia-operation-epoch": "3",
      }),
      z.object({ value: z.string() }),
      handler,
      { requireFence: true, expectedOperationId: () => "job:job-2:stage:draft" },
    );
    expect(response.status).toBe(409);
    expect(assertDurableOperationFence).not.toHaveBeenCalled();
    expect(handler).not.toHaveBeenCalled();
  });
});
