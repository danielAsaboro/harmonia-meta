import { expect, it } from "vitest";
import { downloadDriveFile } from "@/lib/brandLibraries/googleDrive";

const file = { id: "video", name: "video.mp4", mimeType: "video/mp4", version: "7", size: "3", md5Checksum: "900150983cd24fb0d6963f7d28e17f72" };

it("rejects bytes that do not match the enumerated Drive checksum", async () => {
  await expect(downloadDriveFile("token", file, async (url) =>
    new URL(url).searchParams.get("alt") === "media" ? new Response("bad") : Response.json(file),
  )).rejects.toThrow(/checksum/i);
});

it("rejects a Drive revision changed during download", async () => {
  let reads = 0;
  await expect(downloadDriveFile("token", file, async (url) => {
    if (new URL(url).searchParams.get("alt") === "media") return new Response("abc");
    return Response.json({ ...file, version: ++reads === 1 ? "7" : "8" });
  })).rejects.toThrow(/version/i);
});

it("retrieves verified bytes from a shared Drive using its supported request flag", async () => {
  const result = await downloadDriveFile("token", file, async (url) => {
    const parsed = new URL(url);
    if (parsed.searchParams.get("supportsAllDrives") !== "true") return new Response(null, { status: 400 });
    return parsed.searchParams.get("alt") === "media" ? new Response("abc") : Response.json(file);
  });
  expect(result.bytes.toString()).toBe("abc");
});
