import { administratorTenantHandler, tenantHandler } from "@/lib/auth";
import { librarySelectorSchema, syncCadenceSchema } from "@/lib/brandLibraries/contracts";
import { createLibraryConnection, listLibraryConnections } from "@/lib/brandLibraries/repository";
import { getConnection } from "@/lib/firestore";
import { z } from "zod";

const createSchema = z.object({ name: z.string().min(1).max(200), selector: librarySelectorSchema, cadence: syncCadenceSchema.default("six_hours") }).strict();
async function get() { return Response.json({ libraries: await listLibraryConnections() }); }
async function post(request: Request) {
  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid brand library", detail: parsed.error.flatten() }, { status: 400 });
  if (parsed.data.selector.provider === "google_drive" && !(await getConnection("google-drive"))) return Response.json({ error: "Google Drive must be connected first" }, { status: 409 });
  const credentialReferenceId = parsed.data.selector.provider === "google_drive" ? "connection:google-drive" : `adc:gcs:${parsed.data.selector.projectId}`;
  const library = await createLibraryConnection({ ...parsed.data, credentialReferenceId, policy: { maximumFiles: 500, maximumBytes: 500_000_000, maximumExtractedCharacters: 5_000_000, maximumMediaDurationSeconds: 36_000, maximumSyncCostUsd: "5.00" }, cadence: parsed.data.cadence });
  return Response.json({ library }, { status: 201 });
}
export const GET = tenantHandler(get);
export const POST = administratorTenantHandler(post);
