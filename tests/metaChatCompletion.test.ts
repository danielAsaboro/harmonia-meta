import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const originalEnv = { ...process.env };

function completion(content: string) {
  return new Response(JSON.stringify({
    id: "chatcmpl-1", object: "chat.completion", model: "muse-spark-1.3",
    choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
  }), { status: 200, headers: { "content-type": "application/json" } });
}

beforeEach(() => {
  vi.resetModules();
  process.env = {
    ...originalEnv,
    INTERNAL_API_TOKEN: "test-token",
    AGENT_SERVICE_URL: "https://agent.example.test",
    MODEL_API_KEY: "LLM_1_test",
  };
  delete process.env.META_API_BASE_URL;
  delete process.env.MODEL_ID;
});

afterEach(() => {
  process.env = { ...originalEnv };
  vi.unstubAllGlobals();
});

describe("Meta chat completions", () => {
  it("answers contextual questions through /v1/chat/completions with the timeout on fetch", async () => {
    const fetchMock = vi.fn().mockResolvedValue(completion("  The job is complete.  "));
    vi.stubGlobal("fetch", fetchMock);
    const { answerFromContext } = await import("@/lib/contextAnswer");

    await expect(answerFromContext("Is it done?", { state: "complete" })).resolves.toBe("The job is complete.");

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.meta.ai/v1/chat/completions");
    expect(init.headers).toMatchObject({ authorization: "Bearer LLM_1_test" });
    expect(init.signal).toBeInstanceOf(AbortSignal);
    const body = JSON.parse(String(init.body));
    expect(body).toEqual({
      model: "muse-spark-1.3",
      messages: [
        { role: "system", content: expect.stringContaining("ONE Harmonia record") },
        { role: "user", content: expect.stringContaining("Question: Is it done?") },
      ],
    });
    expect(body).not.toHaveProperty("signal");
  });

  it("honours META_API_BASE_URL and MODEL_ID", async () => {
    process.env.META_API_BASE_URL = "https://proxy.example.test/v1/";
    process.env.MODEL_ID = "muse-spark-1.2";
    const fetchMock = vi.fn().mockResolvedValue(completion("ok"));
    vi.stubGlobal("fetch", fetchMock);
    const { answerFromContext } = await import("@/lib/contextAnswer");

    await answerFromContext("q", {});

    expect(fetchMock.mock.calls[0][0]).toBe("https://proxy.example.test/v1/chat/completions");
    expect(JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body)).model).toBe("muse-spark-1.2");
  });

  it("fails before dispatch without MODEL_API_KEY", async () => {
    delete process.env.MODEL_API_KEY;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { answerFromContext } = await import("@/lib/contextAnswer");

    await expect(answerFromContext("q", {})).rejects.toThrow("MODEL_API_KEY is not configured for contextual answer");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("surfaces provider errors and empty content", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(new Response('{"error":{"type":"invalid_request_error"}}', { status: 400 }))
      .mockResolvedValueOnce(completion("")));
    const { answerFromContext } = await import("@/lib/contextAnswer");

    await expect(answerFromContext("q", {})).rejects.toThrow("Meta contextual answer failed (400)");
    await expect(answerFromContext("q", {})).rejects.toThrow("Meta returned no contextual answer content");
  });

  it("authors production drafts with a strict json_schema response_format", async () => {
    const draft = {
      goal: "Show the workflow", audience: "founders", tone: ["clear"], platform: "x",
      aspectRatio: "16:9", resolution: "720p", frameRate: 24,
      scenes: [{ purpose: "Reveal", prompt: "A calm product reveal", durationSec: 4 }],
      soundtrack: { include: false, prompt: null },
    };
    const fetchMock = vi.fn().mockResolvedValue(completion(JSON.stringify(draft)));
    vi.stubGlobal("fetch", fetchMock);
    const { authorProductionPlan } = await import("@/lib/productionPlanAuthor");

    const plan = await authorProductionPlan({
      job: { id: "job-1" }, workspaceId: "w1", brandId: "b1", request: "Make a short film",
      pricing: { version: "v1", veo31FastUsdPerSecond: "0.080000", lyria3ClipFixedUsd: "0.040000" },
    });

    expect(plan.soundtrack).toBeUndefined();
    expect(plan.estimatedCostUsd).toBe("0.320000");
    const body = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body));
    expect(body.model).toBe("muse-spark-1.3");
    expect(body).not.toHaveProperty("temperature");
    expect(body.response_format).toMatchObject({
      type: "json_schema",
      json_schema: { name: "ProductionCreativeDraft", strict: true },
    });
    // Strict subset: every object is closed and requires every declared property.
    const visit = (node: unknown): void => {
      if (!node || typeof node !== "object") return;
      const schema = node as Record<string, unknown>;
      if (schema.type === "object") {
        expect(schema.additionalProperties).toBe(false);
        expect([...(schema.required as string[])].sort()).toEqual(Object.keys(schema.properties as object).sort());
      }
      Object.values(schema).forEach(visit);
    };
    visit(body.response_format.json_schema.schema);
  });
});
