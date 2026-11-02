import { expect, it } from "vitest";
import { planOutputRevision } from "@/lib/outputRevision";

const job = { status: "failed", stage: "understand", controlEpoch: 2, actions: [], config: { desiredOutputs: ["content_pack"], allowedOutputs: ["content_pack"], platforms: [], sourceManifestId: "manifest-1" } };

it("records an exact operator output correction without changing the source or restarting work", () => {
  const revision = planOutputRevision(job, 2, ["linkedin_post", "short_clip", "content_pack"]);
  expect(revision.config.desiredOutputs).toEqual(["linkedin_post", "short_clip", "content_pack"]);
  expect(revision.config.allowedOutputs).toEqual(revision.config.desiredOutputs);
  expect(revision.config).toMatchObject({ sourceManifestId: "manifest-1" });
  expect(revision.controlEpoch).toBe(3);
  expect(revision).not.toHaveProperty("status");
});

it.each([
  { ...job, controlEpoch: 3 }, { ...job, status: "running" },
  { ...job, stage: "draft" }, { ...job, actions: [{ state: "executed" }] },
])("rejects stale or already-derived work", (value) => {
  expect(() => planOutputRevision(value, 2, ["linkedin_post"])).toThrow();
});

it("rejects a pack with no text child instead of creating an impossible plan", () => {
  expect(() => planOutputRevision(job, 2, ["content_pack", "short_clip"])).toThrow(/child/);
});
