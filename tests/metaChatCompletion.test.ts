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
      reasoning_effort: "low",
      prompt_cache_key: "harmonia-web-contextual-answer",
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

  it("sends a strict json_schema response_format without temperature", async () => {
    const fetchMock = vi.fn().mockResolvedValue(completion(JSON.stringify({ goal: "Show the workflow", tags: ["clear"] })));
    vi.stubGlobal("fetch", fetchMock);
    const { createChatCompletion } = await import("@/lib/metaChatCompletion");

    const text = await createChatCompletion({
      purpose: "test",
      messages: [{ role: "user", content: "Return JSON" }],
      timeoutMs: 1_000,
      responseFormat: { type: "json_schema", json_schema: { name: "Draft", strict: true, schema: {
        type: "object", additionalProperties: false,
        properties: { goal: { type: "string" }, tags: { type: "array", items: { type: "string" } } },
        required: ["goal", "tags"],
      } } },
    });

    expect(JSON.parse(text)).toEqual({ goal: "Show the workflow", tags: ["clear"] });
    const body = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body));
    expect(body.model).toBe("muse-spark-1.3");
    expect(body).not.toHaveProperty("temperature");
    expect(body.response_format).toMatchObject({
      type: "json_schema",
      json_schema: { name: "Draft", strict: true },
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

  it("retries 429/500/503 honouring Retry-After, then returns the answer", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response("busy", { status: 429, headers: { "retry-after": "2" } }))
      .mockResolvedValueOnce(new Response("down", { status: 503 }))
      .mockResolvedValueOnce(completion("ok"));
    vi.stubGlobal("fetch", fetchMock);
    const sleeps: number[] = [];
    const { createChatCompletion } = await import("@/lib/metaChatCompletion");

    await expect(createChatCompletion({
      purpose: "test", messages: [{ role: "user", content: "q" }], timeoutMs: 1000,
      sleep: async (ms) => { sleeps.push(ms); },
    })).resolves.toBe("ok");
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(sleeps).toEqual([2000, 1000]);
  });

  it("does not retry a 400", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("bad schema", { status: 400 }));
    vi.stubGlobal("fetch", fetchMock);
    const { createChatCompletion } = await import("@/lib/metaChatCompletion");
    await expect(createChatCompletion({ purpose: "test", messages: [], timeoutMs: 1000, sleep: async () => {} })).rejects.toThrow("(400)");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
