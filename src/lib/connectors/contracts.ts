import { z } from "zod";

export const connectorCapabilitySchema = z.enum([
  "publish",
  "verify",
  "delete",
  "read_metrics",
  "export",
  "schedule",
  "ingest",
]);
export type ConnectorCapability = z.infer<typeof connectorCapabilitySchema>;

export const connectorDescriptorSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]{1,100}$/),
  label: z.string().min(1).max(100),
  availability: z.enum(["active", "groundwork"]),
  capabilities: z.array(connectorCapabilitySchema).max(20),
  effectTypes: z.array(z.string().regex(/^[a-z0-9_]{1,100}$/)).max(50),
  requiredScopes: z.array(z.string().min(1).max(300)).max(50),
  providerIdempotency: z.boolean(),
  independentVerification: z.boolean(),
  regionalConstraint: z.enum(["selected_google_cloud_region", "provider_global", "none"]),
}).strict().superRefine((descriptor, context) => {
  if (descriptor.independentVerification && !descriptor.capabilities.includes("verify")) {
    context.addIssue({ code: "custom", path: ["capabilities"], message: "independent verification requires the verification capability" });
  }
  if (new Set(descriptor.capabilities).size !== descriptor.capabilities.length) {
    context.addIssue({ code: "custom", path: ["capabilities"], message: "connector capabilities must be unique" });
  }
  if (new Set(descriptor.effectTypes).size !== descriptor.effectTypes.length) {
    context.addIssue({ code: "custom", path: ["effectTypes"], message: "connector effect types must be unique" });
  }
});
export type ConnectorDescriptor = z.infer<typeof connectorDescriptorSchema>;

export interface ConnectorContext {
  workspaceId: string;
  brandId: string;
  jobId: string;
  operationId: string;
  traceId: string;
}

export interface PreparedConnectorCommand {
  connectorId: string;
  effectType: string;
  payload: Record<string, unknown>;
  payloadDigest: string;
}

export interface ConnectorExecutionObservation {
  outcome: "applied" | "rejected" | "failed" | "unknown";
  providerReference?: string;
  artifact?: unknown;
  detail: Record<string, unknown>;
}

export interface BusinessConnector {
  readonly descriptor: ConnectorDescriptor;
  validateConnection(context: ConnectorContext): Promise<{ valid: boolean; missingScopes: string[] }>;
  prepareCommand(context: ConnectorContext, payload: unknown): Promise<PreparedConnectorCommand>;
  executeCommand(context: ConnectorContext, command: PreparedConnectorCommand): Promise<ConnectorExecutionObservation>;
  verifyOutcome(context: ConnectorContext, observation: ConnectorExecutionObservation): Promise<{ verified: boolean; evidence: unknown }>;
  reconcileUnknownOutcome(context: ConnectorContext, command: PreparedConnectorCommand): Promise<ConnectorExecutionObservation>;
}
