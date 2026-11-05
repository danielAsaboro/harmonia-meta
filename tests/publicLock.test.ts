import { NextRequest } from "next/server";
import { afterEach, describe, expect, it } from "vitest";
import { proxy, publicPathAllowed } from "@/proxy";

afterEach(() => { delete process.env.HARMONIA_PUBLIC_LOCK; });

describe("public lock", () => {
  it("serves only read-only pages", () => {
    for (const path of ["/", "/proof", "/api/proof", "/docs/architecture", "/api/health"]) expect(publicPathAllowed("GET", path), path).toBe(true);
    for (const [method, path] of [["POST", "/api/chat"], ["GET", "/dashboard"], ["GET", "/login"], ["GET", "/api/jobs"], ["POST", "/api/proof"], ["POST", "/api/settings/agent-tokens"]]) {
      expect(publicPathAllowed(method, path), `${method} ${path}`).toBe(false);
    }
  });

  it("blocks everything else only when the lock is on", async () => {
    process.env.HARMONIA_PUBLIC_LOCK = "1";
    const api = proxy(new NextRequest("https://h.test/api/chat", { method: "POST" }));
    expect(api.status).toBe(403);
    expect(await api.json()).toMatchObject({ error: expect.stringContaining("read-only") });
    expect(proxy(new NextRequest("https://h.test/api/jobs")).status).toBe(403);
    const studio = proxy(new NextRequest("https://h.test/dashboard"));
    expect(studio.status).toBe(307);
    expect(studio.headers.get("location")).toBe("https://h.test/proof");
    expect(proxy(new NextRequest("https://h.test/login")).headers.get("location")).toBe("https://h.test/proof");
    expect(proxy(new NextRequest("https://h.test/settings")).status).toBe(404);
    expect(proxy(new NextRequest("https://h.test/proof")).status).toBe(200);
    expect(proxy(new NextRequest("https://h.test/media/harmonia-narrated-demo.mp4")).status).toBe(200);
    expect(proxy(new NextRequest("https://h.test/proof/runs/51e3a9c4-4043-4390-bab6-6fa5b7761140-1793808392949")).status).toBe(200);
    expect(proxy(new NextRequest("https://h.test/proof/runs/../../api/jobs")).status).not.toBe(200);
    delete process.env.HARMONIA_PUBLIC_LOCK;
    expect(proxy(new NextRequest("https://h.test/dashboard")).status).toBe(307);
    expect(proxy(new NextRequest("https://h.test/api/chat", { method: "POST" })).status).toBe(200);
  });
});
