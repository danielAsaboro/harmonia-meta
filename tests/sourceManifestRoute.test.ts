import { beforeEach, describe, expect, it, vi } from "vitest";

const advance = vi.fn();

vi.mock("@/lib/advance", () => ({ advance }));
vi.mock("@/lib/internalAuth", () => ({
  isInternalAuthorized: () => true,
  unauthorized: () => Response.json({ error: "unauthorized" }, { status: 401 }),
  withInternalTenant: (_request: Request, work: () => unknown) => work(),
}));
vi.mock("@/lib/firestore", () => ({ db: vi.fn(), getJob: vi.fn(), setStage: vi.fn() }));
vi.mock("@/lib/storage", () => ({ getArtifact: vi.fn() }));
vi.mock("@/lib/tenancy", () => ({ currentTenant: vi.fn() }));

describe("source manifest completion route", () => {
  beforeEach(() => advance.mockReset().mockResolvedValue(undefined));

  it("returns success after advancing a completed source stage", async () => {
    const { POST } = await import("@/app/api/internal/source-manifest/route");
    const response = await POST(new Request("http://localhost/api/internal/source-manifest", {
      method: "POST",
      body: JSON.stringify({ jobId: "job-1", stage: "collect_sources", outcome: "all_ready" }),
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, nextStage: "extract_sources" });
  });
});
