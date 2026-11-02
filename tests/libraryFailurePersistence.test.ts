import { expect, it, vi } from "vitest";
import { brandLibraryConnectionSchema } from "@/lib/brandLibraries/contracts";
const state = vi.hoisted(() => ({ update: {} as Record<string, unknown> }));
vi.mock("@/lib/tenancy", () => ({ currentTenant: () => ({ workspaceId: "ws", brandId: "brand" }) }));
vi.mock("@/lib/firestore", () => ({ db: () => ({ collection: () => ({ doc: () => ({
  get: async () => ({ exists: true, get: () => 1 }),
  update: async (value: Record<string, unknown>) => { state.update = value; },
}) }) }) }));
import { failLibrarySync } from "@/lib/brandLibraries/repository";

it("persists permanent failures using the readable connection status contract", async () => {
  await failLibrarySync("library", 1, { category: "permanent", retryCount: 1 });
  expect(brandLibraryConnectionSchema.shape.lastSyncStatus.parse(state.update.lastSyncStatus)).toBe("permanent_failure");
});
