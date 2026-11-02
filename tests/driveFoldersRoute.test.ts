import { expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ tenantHandler: (handler: unknown) => handler }));
vi.mock("@/lib/firestore", () => ({ getConnection: async () => ({ accessToken: "expired" }) }));
vi.mock("@/lib/validConnection", () => ({ validPlatformConnection: async () => ({ accessToken: "refreshed" }) }));

import { GET } from "@/app/api/settings/libraries/google-drive/folders/route";

it("lists folders with refreshed credentials instead of the expired stored token", async () => {
  const request = vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, options) => {
    return options?.headers && new Headers(options.headers).get("authorization") === "Bearer refreshed"
      ? Response.json({ files: [{ id: "selected-folder", name: "Demo" }] })
      : new Response("Expired token", { status: 401 });
  });
  try {
    const result = await GET(new Request("https://harmonia.test/api/settings/libraries/google-drive/folders"));
    expect(await result.json()).toEqual({ folders: [{ id: "selected-folder", name: "Demo" }] });
  } finally { request.mockRestore(); }
});
