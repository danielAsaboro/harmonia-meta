import { z } from "zod";

const id = z.string().regex(/^[A-Za-z0-9_-]{1,300}$/);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const timestamp = z.string().datetime({ offset: true });

export const dataWorkItemStateSchema = z.enum([
  "pending",
  "claimed",
  "succeeded",
  "failed",
  "dead_lettered",
  "cancelled",
]);
export type DataWorkItemState = z.infer<typeof dataWorkItemStateSchema>;

export const dataBatchSchema = z.object({
  id,
  workspaceId: id,
  brandId: id,
  manifest: z.object({
    uri: z.string().regex(/^gs:\/\/[A-Za-z0-9._-]+\/.+/),
    sha256: digest,
    itemCount: z.number().int().positive().max(1_000_000),
    byteCount: z.number().int().nonnegative(),
  }).strict(),
  processorVersion: z.string().regex(/^[A-Za-z0-9._-]{1,100}$/),
  state: z.enum(["initializing", "pending", "running", "complete", "partial", "failed", "cancelled"]),
  maxInFlight: z.number().int().positive().max(100),
  maxAttempts: z.number().int().positive().max(20),
  minimumSuccessRatio: z.number().min(0).max(1),
  allowPartial: z.boolean(),
  createdAt: timestamp,
  updatedAt: timestamp,
  failureCode: z.string().min(1).max(100).optional(),
}).strict();
export type DataBatch = z.infer<typeof dataBatchSchema>;

export const dataWorkItemSchema = z.object({
  id,
  workspaceId: id,
  brandId: id,
  batchId: id,
  partitionIndex: z.number().int().nonnegative(),
  sourceDigest: digest,
  processorVersion: z.string().regex(/^[A-Za-z0-9._-]{1,100}$/),
  state: dataWorkItemStateSchema,
  attempt: z.number().int().nonnegative(),
  maxAttempts: z.number().int().positive().max(20),
  epoch: z.number().int().nonnegative(),
  ownerId: id.optional(),
  ownerTokenDigest: digest.optional(),
  leaseExpiresAt: timestamp.optional(),
  artifactIds: z.array(id).max(100),
  failureCode: z.string().min(1).max(100).optional(),
  lastDispatchedAt: timestamp.optional(),
  dispatchCount: z.number().int().nonnegative().optional(),
  createdAt: timestamp,
  updatedAt: timestamp,
  finalizedAt: timestamp.optional(),
}).strict();
export type DataWorkItem = z.infer<typeof dataWorkItemSchema>;
