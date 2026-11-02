import { describe, expect, it } from "vitest";
import { trace } from "@opentelemetry/api";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { buildStageMessage } from "@/lib/pubsub";

describe("trace propagation", () => {
  it("adds W3C trace context without placing content in attributes", async () => {
    const provider = new NodeTracerProvider();
    provider.register();
    const tracer = trace.getTracer("harmonia.test");

    await tracer.startActiveSpan("root", async (span) => {
      const message = buildStageMessage(
        { workspaceId: "workspace-a", brandId: "brand-a" },
        {
          id: "outbox-1", workspaceId: "workspace-a", brandId: "brand-a", jobId: "j1",
          stage: "understand", attempt: 0, schemaVersion: 1,
          sourceEventId: "stage-outbox:outbox-1", operationId: "job:j1:stage:understand",
          correlationId: "job:j1", publishAttempt: 1, state: "claimed",
          createdAt: "2026-08-28T12:00:00.000Z",
        },
      );
      expect(message.attributes.traceparent).toMatch(/^00-/);
      expect(message.attributes).toMatchObject({ jobId: "j1", stage: "understand" });
      expect(JSON.stringify(message.attributes)).not.toContain("prompt");
      span.end();
    });
  });
});
