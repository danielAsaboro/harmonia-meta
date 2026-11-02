import { describe, expect, it } from "vitest";
import { assertNoForbiddenReplayMaterial, sanitizeReplayObservation } from "@/lib/recordReplay/sanitize";

describe("replay sanitizer", () => {
  it.each(["authorizationHeader", "cookie", "access_token", "apiKey", "privateKey", "chainOfThought", "rawPrompt", "stackTrace"])("rejects forbidden field %s at arbitrary depth", (key) => {
    expect(() => assertNoForbiddenReplayMaterial({ safe: { nested: { [key]: "secret" } } })).toThrow(/forbidden/i);
  });
  it.each(["Bearer abcdefghijklmnop", "-----BEGIN PRIVATE KEY-----", "https://x.test/?access_token=secret"])("rejects credential value %s", (value) => {
    expect(() => assertNoForbiddenReplayMaterial({ summary: value })).toThrow(/forbidden/i);
  });
  it("requires source capture authorization and projects only allowlisted fields", () => {
    const input = { sequence: 0, capturedAt: "2026-08-26T10:00:00.000Z", offsetMs: 0, kind: "transcript_segment", payload: { jobId: "job-1", segmentId: "s1", startSec: 0, endSec: 1, text: "authorized words", ignored: "drop" } };
    expect(() => sanitizeReplayObservation(input, { sourceCaptureAuthorized: false })).toThrow(/authorization/i);
    expect(sanitizeReplayObservation(input, { sourceCaptureAuthorized: true }).payload).not.toHaveProperty("ignored");
  });
});
