import { beforeEach, expect, it, vi } from "vitest";

const store = vi.hoisted(() => ({ getAsset: vi.fn(), getArtifact: vi.fn() }));
vi.mock("@/lib/firestore", () => ({ getAsset: store.getAsset }));
vi.mock("@/lib/storage", () => ({ getArtifact: store.getArtifact }));
vi.mock("@/lib/internalAuth", () => ({ internalTenantHandler: (handler: unknown) => handler }));
import { GET } from "@/app/api/internal/job/[id]/assets/[actionId]/route";

beforeEach(() => {
  store.getAsset.mockResolvedValue({ jobId: "j1", actionId: "a1", mime: "video/mp4", digest: "a".repeat(64), sizeBytes: 3 });
});

it("recomputes the digest from stored bytes instead of trusting saved metadata", async () => {
  store.getArtifact.mockResolvedValue(Buffer.from("abc"));
  const response = await GET(new Request("http://localhost/asset"), { params: Promise.resolve({ id: "j1", actionId: "a1" }) });
  expect(response.status).toBe(200);
  expect((await response.json()).digest).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
});

it("never verifies metadata when stored bytes are missing", async () => {
  store.getArtifact.mockResolvedValue(null);
  const response = await GET(new Request("http://localhost/asset"), { params: Promise.resolve({ id: "j1", actionId: "a1" }) });
  expect(response.status).toBe(410);
});
