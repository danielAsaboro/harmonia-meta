import { describe, expect, it, vi } from "vitest";
import type { UiContext } from "../src/lib/a2ui/presentationContracts";
import { requestSurfacePlan } from "../src/lib/a2ui/agentPresentationClient";

const context: UiContext = {
  runId: "run-1",
  operatorRequest: "Show the strongest moments.",
  intent: "status",
  job: {
    id: "job-1",
    stage: "understand",
    status: "running",
    title: "Launch interview",
    sourceKind: "video",
  },
  drafts: [],

  moments: [{ id: "moment-1", title: "Outcome proof", startSec: 12, endSec: 24 }],
  sources: [{ id: "source-video", kind: "video", label: "Source video" }],
  assets: [],
  actions: [],
  receipts: [],
};

const validPlan = {
  version: "harmonia.ui/v1",
  surfaces: [{
    slot: "canvas",
    revision: 1,
    rootId: "root",
    nodes: [{
      id: "root",
      component: "MomentExplorer",
      refs: { jobId: "job-1", momentIds: ["moment-1"] },
      children: [],
    }],
  }],
};

const tenant = { workspaceId: "workspace-1", brandId: "brand-1", userId: "operator-1" };

describe("ADK presentation client", () => {
  it("sends bounded context with tenant and internal authentication", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(validPlan), { status: 200, headers: { "content-type": "application/json" } }),
    );

    const result = await requestSurfacePlan(context, {
      baseUrl: "http://localhost:8080",
      token: "internal-token",
      tenant,
      fetchImpl,
    });

    expect(result.surfaces[0].slot).toBe("canvas");
    expect(fetchImpl).toHaveBeenCalledWith(
      "http://localhost:8080/internal/a2ui/plan",
      expect.objectContaining({ method: "POST" }),
    );
    const request = fetchImpl.mock.calls[0][1] as RequestInit;
    const headers = new Headers(request.headers);
    expect(headers.get("x-harmonia-internal-token")).toBe("internal-token");
    expect(headers.get("x-workspace-id")).toBe("workspace-1");
    expect(headers.get("x-brand-id")).toBe("brand-1");
    expect(headers.get("x-user-id")).toBe("operator-1");
    expect(JSON.parse(String(request.body))).toEqual(context);
  });

  it("rejects an invalid plan returned by the agent service", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ version: "bad" }), { status: 200 }),
    );

    await expect(requestSurfacePlan(context, {
      baseUrl: "http://localhost:8080",
      token: "internal-token",
      tenant,
      fetchImpl,
    })).rejects.toThrow("invalid A2UI surface plan");
  });

  it("surfaces a real agent-service failure without a fallback", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ detail: "Agent Engine unavailable" }), { status: 502 }),
    );

    await expect(requestSurfacePlan(context, {
      baseUrl: "http://localhost:8080",
      token: "internal-token",
      tenant,
      fetchImpl,
    })).rejects.toThrow("Agent Engine unavailable");
  });
});
