import { describe, expect, test } from "vitest";
import {
  attachmentObjectName,
  metadataMatchesAttachment,
  sniffAttachmentMime,
  validateAttachmentInput,
} from "../src/lib/chatAttachments";

describe("chat attachment transport", () => {
  test("accepts supported production media within its category limit", () => {
    expect(validateAttachmentInput({ filename: "demo.mp4", mime: "video/mp4", sizeBytes: 20_000_000 })).toEqual({
      filename: "demo.mp4",
      mime: "video/mp4",
      sizeBytes: 20_000_000,
      category: "video",
    });
  });

  test("rejects executable and oversized inputs before creating an upload", () => {
    expect(() => validateAttachmentInput({ filename: "payload.exe", mime: "application/octet-stream", sizeBytes: 10 })).toThrow("unsupported attachment type");
    expect(() => validateAttachmentInput({ filename: "huge.mp4", mime: "video/mp4", sizeBytes: 25_165_825 })).toThrow("attachment exceeds");
  });

  test("builds a tenant-scoped object name without trusting the filename", () => {
    expect(attachmentObjectName(
      { workspaceId: "ws_one", brandId: "brand_one" },
      "attachment-id",
      "../../launch demo.MP4",
    )).toBe("chat-attachments/ws_one/brand_one/attachment-id.mp4");
  });

  test("marks completion ready only when cloud metadata matches the request", () => {
    const attachment = { mime: "video/mp4", sizeBytes: 42 };
    expect(metadataMatchesAttachment(attachment, { contentType: "video/mp4", size: "42" })).toBe(true);
    expect(metadataMatchesAttachment(attachment, { contentType: "video/mp4", size: "41" })).toBe(false);
    expect(metadataMatchesAttachment(attachment, { contentType: "text/plain", size: "42" })).toBe(false);
  });

  test("rejects declared media whose magic bytes identify another format", () => {
    const png = Buffer.from("89504e470d0a1a0a00000000", "hex");
    expect(sniffAttachmentMime(png)).toBe("image/png");
    expect(() => sniffAttachmentMime(Buffer.from("MZ executable"))).toThrow("unrecognized attachment content");
  });
});
