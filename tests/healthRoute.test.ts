import { afterEach, describe, expect, it } from "vitest";

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
});

describe("GET /api/health", () => {
  it("reports web health without requiring an agent runtime", async () => {
    delete process.env.AGENT_SERVICE_URL;
    delete process.env.MODEL_API_KEY;
    process.env.GOOGLE_CLOUD_PROJECT = "harmonia-preview";
    process.env.GOOGLE_CLOUD_LOCATION = "us-central1";

    const { GET } = await import("@/app/api/health/route");
    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      service: "harmonia-web",
      project: "harmonia-preview",
      region: "us-central1",
      durableRuntime: {
        protocolVersion: 1,
        stateStore: "firestore",
        wakeTransport: "pubsub",
        contextCompiler: "harmonia-context/v1",
      },
    });
  });
});
