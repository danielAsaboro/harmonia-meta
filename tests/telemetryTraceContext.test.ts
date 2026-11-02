import { describe, expect, it } from "vitest";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";

import { currentTraceId, withTraceContext } from "@/lib/telemetry";

describe("trace context extraction", () => {
  it("activates a valid inbound W3C traceparent", () => {
    new NodeTracerProvider().register();
    const traceId = "0123456789abcdef0123456789abcdef";
    const headers = new Headers({ traceparent: `00-${traceId}-0123456789abcdef-01` });

    expect(withTraceContext(headers, () => currentTraceId())).toBe(traceId);
  });

  it("creates a host-owned trace ID when an inbound request has no trace context", () => {
    const first = withTraceContext(new Headers(), () => currentTraceId());
    const second = withTraceContext(new Headers(), () => currentTraceId());

    expect(first).toMatch(/^[a-f0-9]{32}$/);
    expect(first).not.toBe("0".repeat(32));
    expect(second).toMatch(/^[a-f0-9]{32}$/);
    expect(second).not.toBe(first);
  });

  it("replaces an invalid all-zero inbound trace with a host-owned trace ID", () => {
    const headers = new Headers({ traceparent: `00-${"0".repeat(32)}-0123456789abcdef-01` });
    const traceId = withTraceContext(headers, () => currentTraceId());

    expect(traceId).toMatch(/^[a-f0-9]{32}$/);
    expect(traceId).not.toBe("0".repeat(32));
  });

  it("retains the request trace across asynchronous work without relying on an active span", async () => {
    const traceId = await withTraceContext(new Headers(), async () => {
      await Promise.resolve();
      return currentTraceId();
    });

    expect(traceId).toMatch(/^[a-f0-9]{32}$/);
    expect(traceId).not.toBe("0".repeat(32));
  });
});
