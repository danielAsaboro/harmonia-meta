import { expect, it, vi } from "vitest";

vi.mock("@/lib/firestore", () => ({
  getConnection: async () => ({ accessToken: "expired" }),
  db: () => ({ doc: () => ({ collection: () => ({ doc: () => ({ update: async () => undefined }) }) }), collection: () => ({}) }),
}));
vi.mock("@/lib/validConnection", () => ({ validPlatformConnection: async () => ({ accessToken: "refreshed" }) }));
vi.mock("@/lib/tenancy", () => ({ currentTenant: () => ({ workspaceId: "ws", brandId: "brand" }) }));
vi.mock("@/lib/brandLibraries/repository", () => ({
  beginLibrarySync: async () => ({ id: "operation", connection: { selector: { provider: "google_drive", folderId: "selected" }, policy: { maximumFiles: 10 } } }),
  finalizeLibrarySyncOperation: async () => undefined,
  failLibrarySync: async () => undefined,
}));

import { runLibrarySync } from "@/lib/brandLibraries/sync";

it("refreshes the Drive token before enumerating a library", async () => {
  const request = vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, options) =>
    new Headers(options?.headers).get("authorization") === "Bearer refreshed"
      ? Response.json({ files: [] }) : new Response("Expired", { status: 401 }));
  try {
    await expect(runLibrarySync("library", 1)).rejects.toThrow("brand library contains no supported source files");
  } finally { request.mockRestore(); }
});
