import { createHash } from "node:crypto";

export interface DriveFolder { id: string; name: string; driveId?: string; modifiedTime?: string }
export interface DriveFileVersion extends DriveFolder { mimeType: string; size?: string; md5Checksum?: string; version?: string }
type RequestFn = (input: string, init?: RequestInit) => Promise<Response>;

async function driveGet(accessToken: string, path: string, params: Record<string, string>, request: RequestFn): Promise<Record<string, unknown>> {
  const url = new URL(`https://www.googleapis.com/drive/v3/${path}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  const response = await request(url.toString(), { headers: { authorization: `Bearer ${accessToken}`, accept: "application/json" }, signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`Google Drive request failed (${response.status})`);
  return response.json() as Promise<Record<string, unknown>>;
}

export async function listDriveFolders(accessToken: string, parentId = "root", pageToken?: string, request: RequestFn = fetch): Promise<{ folders: DriveFolder[]; nextPageToken?: string }> {
  const escaped = parentId.replaceAll("'", "\\'");
  const data = await driveGet(accessToken, "files", { q: `'${escaped}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`, fields: "nextPageToken,files(id,name,driveId,modifiedTime)", pageSize: "100", supportsAllDrives: "true", includeItemsFromAllDrives: "true", ...(pageToken ? { pageToken } : {}) }, request);
  return { folders: Array.isArray(data.files) ? data.files as DriveFolder[] : [], ...(typeof data.nextPageToken === "string" ? { nextPageToken: data.nextPageToken } : {}) };
}

export async function listDriveFolderFiles(accessToken: string, folderId: string, pageToken?: string, request: RequestFn = fetch): Promise<{ files: DriveFileVersion[]; nextPageToken?: string }> {
  const escaped = folderId.replaceAll("'", "\\'");
  const data = await driveGet(accessToken, "files", { q: `'${escaped}' in parents and trashed=false`, fields: "nextPageToken,files(id,name,mimeType,size,md5Checksum,version,driveId,modifiedTime)", pageSize: "100", supportsAllDrives: "true", includeItemsFromAllDrives: "true", ...(pageToken ? { pageToken } : {}) }, request);
  return { files: (Array.isArray(data.files) ? data.files as DriveFileVersion[] : []).filter((file) => file.mimeType !== "application/vnd.google-apps.folder"), ...(typeof data.nextPageToken === "string" ? { nextPageToken: data.nextPageToken } : {}) };
}

export async function downloadDriveFile(accessToken: string, file: DriveFileVersion, request: RequestFn = fetch): Promise<{ bytes: Buffer; mimeType: string }> {
  if (!file.version) throw new Error("Google Drive file version is required");
  const assertVersion = async () => {
    const current = await driveGet(accessToken, `files/${encodeURIComponent(file.id)}`, { fields: "id,version,trashed", supportsAllDrives: "true" }, request);
    if (current.id !== file.id || current.version !== file.version || current.trashed === true) throw new Error("Google Drive file version changed; retry synchronization");
  };
  await assertVersion();
  const nativeExports: Record<string, string> = { "application/vnd.google-apps.document": "application/pdf", "application/vnd.google-apps.presentation": "application/pdf", "application/vnd.google-apps.spreadsheet": "text/csv" };
  const exportMime = nativeExports[file.mimeType]; const url = new URL(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(file.id)}/${exportMime ? "export" : ""}`.replace(/\/$/, ""));
  url.searchParams.set(exportMime ? "mimeType" : "alt", exportMime ?? "media");
  if (!exportMime) url.searchParams.set("supportsAllDrives", "true");
  const response = await request(url.toString(), { headers: { authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(60_000) });
  if (!response.ok) throw new Error(`Google Drive download failed (${response.status})`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!exportMime && file.md5Checksum && createHash("md5").update(bytes).digest("hex") !== file.md5Checksum) throw new Error("Google Drive file checksum mismatch");
  await assertVersion();
  return { bytes, mimeType: exportMime ?? file.mimeType };
}
