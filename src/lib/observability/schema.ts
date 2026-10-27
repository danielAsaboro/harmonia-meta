import { z } from "zod";

const tenantId = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
const name = z.string().regex(/^[a-z][a-z0-9_]{1,79}$/);
const optionalName = name.nullish();

export const agentActivitySchema = z.object({
  schemaVersion: z.literal(1),
  workspaceId: tenantId,
  brandId: tenantId,
  jobId: tenantId,
  invocationId: z.string().min(1).max(384),
  operationId: z.string().min(1).max(384),
  occurredAt: z.iso.datetime({ offset: true }),
  signalType: z.enum(["log", "trace", "metric"]),
  eventName: z.string().regex(/^[a-z][a-z0-9_.-]{1,79}$/),
  severity: z.enum(["debug", "info", "warning", "error"]),
  outcome: z.enum(["success", "error"]),
  agent: name,
  stage: name,
  workflow: z.string().regex(/^[a-z][a-z0-9_.-]{1,79}$/).nullish(),
  model: z.string().min(1).max(160).nullish(),
  tool: optionalName,
  traceId: z.string().regex(/^[a-f0-9]{32}$/),
  spanId: z.string().regex(/^[a-f0-9]{16}$/),
  parentSpanId: z.string().regex(/^[a-f0-9]{16}$/).nullish(),
  durationMs: z.number().int().min(0).max(86_400_000),
  inputTokens: z.number().int().min(0).max(100_000_000).default(0),
  outputTokens: z.number().int().min(0).max(100_000_000).default(0),
  inferenceCalls: z.number().int().min(0).max(10_000).default(0),
  toolCalls: z.number().int().min(0).max(10_000).default(0),
  errorCategory: z.enum(["authorization", "dependency", "protocol", "timeout", "internal"]).nullish(),
  errorType: z.string().regex(/^[A-Za-z][A-Za-z0-9_.]{0,127}$/).nullish(),
  backend: z.enum(["google_cloud", "local"]),
}).strict().superRefine((value, ctx) => {
  if (value.outcome === "success" && (value.errorCategory || value.errorType)) {
    ctx.addIssue({ code: "custom", message: "successful activity cannot contain error metadata" });
  }
  if (value.outcome === "error" && !value.errorCategory) {
    ctx.addIssue({ code: "custom", message: "failed activity requires a safe error category" });
  }
  if (value.eventName === "tool.execution" && !value.tool) {
    ctx.addIssue({ code: "custom", message: "tool activity requires a tool name" });
  }
});

export const observabilityQuerySchema = z.object({
  types: z.array(z.enum(["log", "trace", "metric"])).max(3).default([]),
  agent: optionalName,
  stage: optionalName,
  outcome: z.enum(["success", "error"]).nullish(),
  severity: z.enum(["debug", "info", "warning", "error"]).nullish(),
  model: z.string().min(1).max(160).nullish(),
  tool: optionalName,
  jobId: tenantId.nullish(),
  traceId: z.string().regex(/^[a-f0-9]{32}$/).nullish(),
  since: z.iso.datetime({ offset: true }).nullish(),
  until: z.iso.datetime({ offset: true }).nullish(),
  q: z.string().trim().max(200).nullish(),
  limit: z.number().int().min(10).max(100).default(25),
  cursor: z.string().min(1).max(600).nullish(),
}).strict();

export type AgentActivityInput = z.input<typeof agentActivitySchema>;
export type AgentActivityData = z.output<typeof agentActivitySchema>;
export type AgentActivity = AgentActivityData & { id: string };
export type ObservabilityQuery = z.output<typeof observabilityQuerySchema>;

export interface ObservabilityPage {
  items: AgentActivity[];
  nextCursor: string | null;
  hasMore: boolean;
  facets: {
    agents: string[];
    stages: string[];
    models: string[];
    tools: string[];
  };
}

export const durableRuntimeSnapshotSchema = z.object({
  generatedAt: z.iso.datetime({ offset: true }),
  staleLeases: z.object({ operations: z.number().int().nonnegative(), inbox: z.number().int().nonnegative(), outbox: z.number().int().nonnegative() }).strict(),
  inboxLagSeconds: z.number().int().nonnegative(),
  outboxLagSeconds: z.number().int().nonnegative(),
  unknownEffects: z.array(z.object({
    jobId: tenantId, operationId: z.string().min(1).max(512), commandId: z.string().min(1).max(256),
    epoch: z.number().int().positive(), reason: z.string().max(2000), dispatchedAt: z.iso.datetime({ offset: true }).optional(),
  }).strict()).max(100),
  observedEffects: z.number().int().nonnegative(),
  projection: z.object({ count: z.number().int().nonnegative(), compilerVersion: z.string().max(100).nullable(), manifestDigest: z.string().regex(/^[a-f0-9]{64}$/).nullable() }).strict(),
  artifacts: z.object({ ready: z.number().int().nonnegative(), writing: z.number().int().nonnegative(), failed: z.number().int().nonnegative() }).strict(),
  recovery: z.object({ pending: z.number().int().nonnegative(), recentActions: z.array(z.string().min(1).max(100)).max(100) }).strict(),
}).strict();

export type DurableRuntimeSnapshot = z.infer<typeof durableRuntimeSnapshotSchema>;
