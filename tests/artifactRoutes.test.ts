import { beforeEach, describe, expect, it, vi } from "vitest";

const { create, read, assertDurableOperationFence } = vi.hoisted(() => ({
  create: vi.fn(),
  read: vi.fn(),
  assertDurableOperationFence: vi.fn(),
}));
vi.mock("@/lib/artifactStore", () => ({
  createArtifactStore: () => ({ create, read }),
}));
vi.mock("@/lib/firestore", () => ({
  db: vi.fn(),
  assertDurableOperationFence,
}));

import { POST } from "@/app/api/internal/artifacts/route";
import { GET } from "@/app/api/internal/artifacts/[id]/route";

const baseHeaders = {
  authorization: "Bearer test-internal-token",
  "content-type": "application/json",
  "x-workspace-id": "workspace-1",
  "x-brand-id": "brand-1",
  "x-harmonia-operation-id": "job:job-1:stage:draft",
  "x-harmonia-operation-epoch": "2",
};

describe("artifact routes", () => {
  beforeEach(() => {
    process.env.INTERNAL_API_TOKEN = "test-internal-token";
    process.env.AGENT_SERVICE_URL = "http://127.0.0.1:8080";
    create.mockReset();
    read.mockReset();
    assertDurableOperationFence.mockReset();
    assertDurableOperationFence.mockResolvedValue({});
    create.mockResolvedValue({ id: "018f47a2-4f40-7b1f-b19f-8f6b916b7d11", state: "ready" });
    read.mockResolvedValue({
      kind: "lines",
      record: {
        id: "018f47a2-4f40-7b1f-b19f-8f6b916b7d11",
        operationId: "job:job-1:stage:draft",
      },
      text: "tail",
      lineStart: 4,
      nextLine: 5,
      complete: true,
    });
  });

  it("requires the body operation to match the live fence before writing bytes", async () => {
    const response = await POST(new Request("http://localhost/api/internal/artifacts", {
      method: "POST",
      headers: baseHeaders,
      body: JSON.stringify({
        jobId: "job-1",
        operationId: "job:job-1:stage:draft",
        dataBase64: Buffer.from("tool output").toString("base64"),
        contentType: "text/plain",
        trust: "external_untrusted",
        producer: { kind: "tool", id: "search", version: "1" },
        retentionClass: "source",
      }),
    }));
    expect(response.status).toBe(201);
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      operationId: "job:job-1:stage:draft",
      bytes: Buffer.from("tool output"),
    }));
  });

  it("returns only bounded, digest-verified reads under a live fence", async () => {
    const response = await GET(
      new Request("http://localhost/api/internal/artifacts/id?lineStart=4&lineCount=1", {
        headers: baseHeaders,
      }),
      { params: Promise.resolve({ id: "018f47a2-4f40-7b1f-b19f-8f6b916b7d11" }) },
    );
    expect(response.status).toBe(200);
    expect(read).toHaveBeenCalledWith("018f47a2-4f40-7b1f-b19f-8f6b916b7d11", {
      lineStart: 4, lineCount: 1,
    });
    expect(await response.json()).toMatchObject({ text: "tail", complete: true });
  });

  it("rejects unbounded or mixed read windows", async () => {
    const response = await GET(
      new Request("http://localhost/api/internal/artifacts/id?offset=0&lineStart=0", {
        headers: baseHeaders,
      }),
      { params: Promise.resolve({ id: "018f47a2-4f40-7b1f-b19f-8f6b916b7d11" }) },
    );
    expect(response.status).toBe(400);
    expect(read).not.toHaveBeenCalled();
  });

  it("keeps a fence-store outage retryable on reads", async () => {
    assertDurableOperationFence.mockRejectedValueOnce(new Error("14 UNAVAILABLE: Firestore offline"));
    const response = await GET(
      new Request("http://localhost/api/internal/artifacts/id?offset=0&length=10", {
        headers: baseHeaders,
      }),
      { params: Promise.resolve({ id: "018f47a2-4f40-7b1f-b19f-8f6b916b7d11" }) },
    );
    expect(response.status).toBe(500);
  });
});
