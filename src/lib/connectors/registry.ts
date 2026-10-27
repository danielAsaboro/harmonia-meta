import { connectorDescriptorSchema, type ConnectorCapability, type ConnectorDescriptor } from "./contracts";

function clone(descriptor: ConnectorDescriptor): ConnectorDescriptor {
  return {
    ...descriptor,
    capabilities: [...descriptor.capabilities],
    effectTypes: [...descriptor.effectTypes],
    requiredScopes: [...descriptor.requiredScopes],
  };
}

export class ConnectorRegistry {
  private readonly descriptors = new Map<string, ConnectorDescriptor>();

  constructor(input: ConnectorDescriptor[]) {
    for (const candidate of input) {
      const descriptor = connectorDescriptorSchema.parse(candidate);
      if (this.descriptors.has(descriptor.id)) throw new Error(`duplicate connector: ${descriptor.id}`);
      this.descriptors.set(descriptor.id, clone(descriptor));
    }
  }

  require(id: string, capability: ConnectorCapability): ConnectorDescriptor {
    const descriptor = this.descriptors.get(id);
    if (!descriptor) throw new Error(`connector '${id}' is not registered`);
    if (!descriptor.capabilities.includes(capability)) throw new Error(`connector '${id}' does not support '${capability}'`);
    return clone(descriptor);
  }

  list(): ConnectorDescriptor[] {
    return [...this.descriptors.values()].map(clone).sort((left, right) => left.id.localeCompare(right.id));
  }
}

const DEFAULT_CONNECTORS: ConnectorDescriptor[] = [
  {
    id: "x",
    label: "X",
    availability: "active",
    capabilities: ["publish", "verify", "read_metrics"],
    effectTypes: ["publish_x_post"],
    requiredScopes: ["tweet.read", "tweet.write", "users.read", "offline.access"],
    providerIdempotency: false,
    independentVerification: true,
    regionalConstraint: "provider_global",
  },
  {
    id: "google-calendar",
    label: "Google Calendar",
    availability: "active",
    capabilities: ["schedule", "verify", "delete"],
    effectTypes: ["sync_google_calendar", "remove_google_calendar"],
    requiredScopes: ["https://www.googleapis.com/auth/calendar.app.created"],
    providerIdempotency: true,
    independentVerification: true,
    regionalConstraint: "provider_global",
  },
  {
    id: "content-pack",
    label: "Content pack export",
    availability: "active",
    capabilities: ["export", "verify"],
    effectTypes: ["export_content_pack"],
    requiredScopes: [],
    providerIdempotency: true,
    independentVerification: true,
    regionalConstraint: "selected_google_cloud_region",
  },
];

export function createDefaultConnectorRegistry(): ConnectorRegistry {
  return new ConnectorRegistry(DEFAULT_CONNECTORS);
}
