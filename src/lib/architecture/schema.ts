import { z } from "zod";

export const ArchitectureLayerSchema = z.enum(["surfaces", "control", "apis", "workflow", "agents", "models", "prompts", "skills", "data", "effects", "external", "observability", "trust"]);
export const ArchitectureStatusSchema = z.enum(["implemented", "offline-verified", "approval-gated", "read-only", "pending-live", "planned", "unsupported"]);
export const ArchitectureAuthoritySchema = z.enum(["read", "write", "delegate", "propose", "approve", "execute-effect", "verify", "none"]);
export const ArchitectureDataScopeSchema = z.enum(["public", "workspace", "workspace-brand", "tenant", "external", "metadata-only", "none"]);
export const ArchitectureStateLifetimeSchema = z.enum(["durable", "ephemeral", "external", "stateless"]);
export const ArchitectureNodeKindSchema = z.enum(["group", "surface", "service", "route", "stage", "agent", "workflow", "model", "prompt", "skill", "tool", "store", "gate", "effect", "verification", "integration", "control", "runtime"]);
export const ArchitectureEdgeKindSchema = z.enum(["workflow", "delegation", "approval", "effect", "verification", "retrieval", "memory", "telemetry", "blocked"]);

export const ArchitectureNodeSchema = z.object({
  id: z.string().min(1), name: z.string().min(1), kind: ArchitectureNodeKindSchema,
  layer: ArchitectureLayerSchema, statuses: z.array(ArchitectureStatusSchema).min(1),
  authorities: z.array(ArchitectureAuthoritySchema).min(1), dataScope: ArchitectureDataScopeSchema,
  stateLifetime: ArchitectureStateLifetimeSchema, summary: z.string().min(1), parentId: z.string().optional(),
  runtime: z.string().optional(), model: z.object({ name: z.string(), role: z.string().optional() }).optional(),
  promptResponsibility: z.string().optional(), inputs: z.array(z.string()).optional(), outputs: z.array(z.string()).optional(),
  tools: z.array(z.string()).optional(), skills: z.array(z.string()).optional(), representativeRoutes: z.array(z.string()).optional(),
  sourceFiles: z.array(z.string()).optional(), docs: z.array(z.string()).optional(), limitations: z.array(z.string()).optional(),
  approval: z.string().optional(), idempotency: z.string().optional(), verification: z.string().optional(),
  defaultExpanded: z.boolean().optional(), presetIds: z.array(z.string()).optional(),
});
export const ArchitectureEdgeSchema = z.object({ id: z.string().min(1), source: z.string().min(1), target: z.string().min(1), kind: ArchitectureEdgeKindSchema, label: z.string().min(1) });
export const ArchitecturePresetSchema = z.object({ id: z.string().min(1), name: z.string().min(1), expanded: z.array(z.string()), layers: z.array(ArchitectureLayerSchema), statuses: z.array(ArchitectureStatusSchema), focusNodeIds: z.array(z.string()) });
export const ArchitectureDefinitionSchema = z.object({ version: z.string().min(1), nodes: z.array(ArchitectureNodeSchema), edges: z.array(ArchitectureEdgeSchema), presets: z.array(ArchitecturePresetSchema) });

export type ArchitectureLayer = z.infer<typeof ArchitectureLayerSchema>;
export type ArchitectureStatus = z.infer<typeof ArchitectureStatusSchema>;
export type ArchitectureNode = z.infer<typeof ArchitectureNodeSchema>;
export type ArchitectureEdge = z.infer<typeof ArchitectureEdgeSchema>;
export type ArchitecturePreset = z.infer<typeof ArchitecturePresetSchema>;
export type ArchitectureDefinition = z.infer<typeof ArchitectureDefinitionSchema>;
