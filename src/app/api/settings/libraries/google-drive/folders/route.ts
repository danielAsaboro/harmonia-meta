import { tenantHandler } from "@/lib/auth";
import { listDriveFolders } from "@/lib/brandLibraries/googleDrive";
import { getConnection } from "@/lib/firestore";
import { validPlatformConnection } from "@/lib/validConnection";
async function get(request: Request) {
  if (!await getConnection("google-drive")) return Response.json({ error: "Google Drive is not connected" }, { status: 409 });
  const connection = await validPlatformConnection("google-drive");
  const url = new URL(request.url);
  const result = await listDriveFolders(connection.accessToken, url.searchParams.get("parentId") ?? "root", url.searchParams.get("pageToken") ?? undefined);
  return Response.json(result);
}
export const GET = tenantHandler(get);
