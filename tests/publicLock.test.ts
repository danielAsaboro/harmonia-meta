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

  it("returns 404 for everything else only when the lock is on", () => {
    process.env.HARMONIA_PUBLIC_LOCK = "1";
    expect(proxy(new NextRequest("https://h.test/api/chat", { method: "POST" })).status).toBe(404);
    expect(proxy(new NextRequest("https://h.test/proof")).status).toBe(200);
    delete process.env.HARMONIA_PUBLIC_LOCK;
    expect(proxy(new NextRequest("https://h.test/dashboard")).status).toBe(307);
    expect(proxy(new NextRequest("https://h.test/api/chat", { method: "POST" })).status).toBe(200);
  });
});
