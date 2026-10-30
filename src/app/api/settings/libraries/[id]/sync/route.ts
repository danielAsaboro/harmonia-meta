import { administratorTenantHandler } from "@/lib/auth";
import { getLibraryConnection } from "@/lib/brandLibraries/repository";
import { runLibrarySync } from "@/lib/brandLibraries/sync";
async function post(_request: Request, { params }: { params: Promise<{ id: string }> }) { const { id } = await params; try { const connection = await getLibraryConnection(id); const result = await runLibrarySync(id, connection.revision); return Response.json({ ...result, status: "healthy" }); } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "sync could not complete" }, { status: 409 }); } }
export const POST = administratorTenantHandler(post);
