import { beforeEach, describe, expect, it, vi } from "vitest";

const getOrCreateEditorialPlanningSnapshot = vi.fn();
const withInternalTenant = vi.fn((_request: Request, work: () => unknown) => work());

vi.mock("@/lib/firestore", () => ({ getOrCreateEditorialPlanningSnapshot }));
vi.mock("@/lib/internalAuth", () => ({
  isInternalAuthorized: () => true,
  unauthorized: () => Response.json({ error: "unauthorized" }, { status: 401 }),
  withInternalTenant,
}));

describe("editorial planning snapshot route", () => {
  beforeEach(() => {
    getOrCreateEditorialPlanningSnapshot.mockReset().mockResolvedValue({
      snapshot: { snapshotId: "planning-job-1-v1" },
      digest: "a".repeat(64),
    });
    withInternalTenant.mockClear();
  });

  it("runs the snapshot read and write inside the authenticated tenant scope", async () => {
    const { GET } = await import("@/app/api/internal/editorial-planning-snapshot/route");
    const request = new Request("http://localhost/api/internal/editorial-planning-snapshot?jobId=job-1", {
      headers: {
        authorization: "Bearer local-dev-token",
        "x-workspace-id": "workspace-1",
        "x-brand-id": "brand-1",
      },
    });

    const response = await GET(request);

    expect(response.status).toBe(200);
    expect(withInternalTenant).toHaveBeenCalledWith(request, expect.any(Function));
    expect(getOrCreateEditorialPlanningSnapshot).toHaveBeenCalledWith("job-1");
  });
});
