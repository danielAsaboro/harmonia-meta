import { describe, expect, it } from "vitest";
import { brandLibraryConnectionSchema } from "@/lib/brandLibraries/contracts";

const valid = (cadence?: string) => ({ id: "library-1", workspaceId: "workspace-1", brandId: "brand-1", name: "Brand truth", selector: { provider: "google_drive", driveId: "drive-1", folderId: "folder-1" }, credentialReferenceId: "credential-1", ...(cadence ? { cadence } : {}), policy: {}, revision: 1, lastSyncStatus: "never", createdAt: "2026-08-30T00:00:00Z", updatedAt: "2026-08-30T00:00:00Z" });

describe("brand library contracts", () => {
  it.each(["hourly", "six_hours", "daily", "paused"])("accepts cadence %s", (cadence) => expect(brandLibraryConnectionSchema.parse(valid(cadence)).cadence).toBe(cadence));
  it("defaults to six-hour sync", () => expect(brandLibraryConnectionSchema.parse(valid()).cadence).toBe("six_hours"));
  it("rejects GCS traversal", () => expect(() => brandLibraryConnectionSchema.parse({ ...valid(), selector: { provider: "gcs", projectId: "p", bucket: "brand-assets", prefix: "../secret" } })).toThrow());
});
