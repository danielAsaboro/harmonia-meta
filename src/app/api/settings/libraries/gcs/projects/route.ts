import { tenantHandler } from "@/lib/auth";
import { listAuthorizedProjects } from "@/lib/brandLibraries/gcs";
async function get() { return Response.json({ projects: listAuthorizedProjects() }); }
export const GET = tenantHandler(get);
