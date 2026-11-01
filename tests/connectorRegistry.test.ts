import { describe, expect, it } from "vitest";

import {
  ConnectorRegistry,
  createDefaultConnectorRegistry,
} from "@/lib/connectors/registry";
import type { ConnectorDescriptor } from "@/lib/connectors/contracts";

const descriptor: ConnectorDescriptor = {
  id: "example",
  label: "Example",
  availability: "active",
  capabilities: ["publish", "verify"],
  effectTypes: ["publish_example"],
  requiredScopes: ["write.example"],
  providerIdempotency: false,
  independentVerification: true,
  regionalConstraint: "provider_global",
};

describe("business connector registry", () => {
  it("finds connectors only for declared capabilities", () => {
    const registry = new ConnectorRegistry([descriptor]);
    expect(registry.require("example", "publish")).toEqual(descriptor);
    expect(() => registry.require("example", "read_metrics")).toThrow("does not support");
    expect(() => registry.require("missing", "publish")).toThrow("not registered");
  });

  it("rejects duplicate identities and inconsistent verification claims", () => {
    expect(() => new ConnectorRegistry([descriptor, descriptor])).toThrow("duplicate connector");
    expect(() => new ConnectorRegistry([{
      ...descriptor,
      independentVerification: true,
      capabilities: ["publish"],
    }])).toThrow("verification capability");
  });

  it("registers only Harmonia connectors with implemented effect paths", () => {
    const registry = createDefaultConnectorRegistry();
    expect(registry.require("x", "publish")).toMatchObject({
      effectTypes: ["publish_x_post"],
      requiredScopes: ["tweet.read", "tweet.write", "users.read", "offline.access"],
      providerIdempotency: false,
      independentVerification: true,
    });
    expect(registry.require("google-calendar", "schedule")).toMatchObject({ availability: "active" });
    expect(registry.require("content-pack", "export")).toMatchObject({ requiredScopes: [] });
    expect(registry.list()).toHaveLength(3);
  });

  it("returns defensive copies so callers cannot mutate registry authority", () => {
    const registry = new ConnectorRegistry([descriptor]);
    const first = registry.require("example", "publish");
    first.capabilities.push("delete");
    expect(() => registry.require("example", "delete")).toThrow("does not support");
  });
});
