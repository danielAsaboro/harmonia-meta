import { z } from "zod";

export const syncCadenceSchema = z.enum(["hourly", "six_hours", "daily", "paused"]);
export const librarySelectorSchema = z.discriminatedUnion("provider", [
  z.object({ provider: z.literal("google_drive"), driveId: z.string().min(1), folderId: z.string().min(1) }).strict(),
  z.object({ provider: z.literal("gcs"), projectId: z.string().min(1), bucket: z.string().regex(/^[a-z0-9][a-z0-9._-]{1,220}[a-z0-9]$/), prefix: z.string().max(1024).refine((value) => !value.split("/").includes(".."), "prefix traversal is forbidden") }).strict(),
]);

export const libraryPolicySchema = z.object({ maximumFiles: z.number().int().positive().max(10_000).default(500), maximumBytes: z.number().int().positive().max(10_000_000_000).default(500_000_000), maximumExtractedCharacters: z.number().int().positive().max(100_000_000).default(5_000_000), maximumMediaDurationSeconds: z.number().int().positive().max(864_000).default(36_000), maximumSyncCostUsd: z.string().regex(/^\d+\.\d{2,6}$/).default("5.00") }).strict();

export const brandLibraryConnectionSchema = z.object({
  id: z.string().min(1), workspaceId: z.string().min(1), brandId: z.string().min(1), name: z.string().min(1).max(200),
  selector: librarySelectorSchema, credentialReferenceId: z.string().min(1), cadence: syncCadenceSchema.default("six_hours"),
  policy: libraryPolicySchema.default({ maximumFiles: 500, maximumBytes: 500_000_000, maximumExtractedCharacters: 5_000_000, maximumMediaDurationSeconds: 36_000, maximumSyncCostUsd: "5.00" }), revision: z.number().int().positive(), currentHealthySnapshotId: z.string().min(1).optional(),
  lastSyncStatus: z.enum(["never", "running", "healthy", "transient_failure", "reconnection_required", "permanent_failure"]).default("never"), retryCount: z.number().int().nonnegative().default(0), nextEligibleRetryAt: z.string().datetime({ offset: true }).optional(), createdAt: z.string().datetime({ offset: true }), updatedAt: z.string().datetime({ offset: true }), pausedAt: z.string().datetime({ offset: true }).optional(), revokedAt: z.string().datetime({ offset: true }).optional(),
}).strict();

export const librarySyncOperationSchema = z.object({ id: z.string().min(1), connectionId: z.string().min(1), expectedConnectionRevision: z.number().int().positive(), status: z.enum(["claimed", "enumerating", "extracting", "healthy", "failed"]), startedAt: z.string().datetime({ offset: true }), completedAt: z.string().datetime({ offset: true }).optional(), failure: z.object({ code: z.string().min(1), category: z.enum(["transient", "reconnection_required", "permanent"]), publicMessage: z.string().min(1), retryCount: z.number().int().nonnegative(), nextEligibleRetryAt: z.string().datetime({ offset: true }).optional() }).strict().optional() }).strict();
export const libraryFileVersionSchema = z.object({ sourceId: z.string().min(1), providerResourceId: z.string().min(1), providerVersion: z.string().min(1), contentDigest: z.string().regex(/^[a-f0-9]{64}$/).optional(), state: z.enum(["ready", "failed", "excluded"]) }).strict();
export const brandLibrarySnapshotSchema = z.object({ id: z.string().min(1), connectionId: z.string().min(1), revision: z.number().int().positive(), syncOperationId: z.string().min(1), status: z.literal("healthy"), fileVersions: z.array(libraryFileVersionSchema), manifestDigest: z.string().regex(/^[a-f0-9]{64}$/), createdAt: z.string().datetime({ offset: true }) }).strict();

export type SyncCadence = z.infer<typeof syncCadenceSchema>;
export type BrandLibraryConnection = z.infer<typeof brandLibraryConnectionSchema>;
export type LibrarySyncOperation = z.infer<typeof librarySyncOperationSchema>;
export type LibraryFileVersion = z.infer<typeof libraryFileVersionSchema>;
export type BrandLibrarySnapshot = z.infer<typeof brandLibrarySnapshotSchema>;
