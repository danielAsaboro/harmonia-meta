import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { ArtifactBoard } from "@/components/studio/ArtifactBoard";
import { buildStudioWorkspace } from "@/lib/studio/workspaceModel";
import type { JobFull } from "@/components/jobTypes";

it("shows empty workflow stages honestly instead of implying drafts and media exist", () => {
  const job = { id: "job-1", actions: [], assets: [] } as unknown as JobFull;
  const html = renderToStaticMarkup(createElement(ArtifactBoard, { job, model: buildStudioWorkspace(job, []), onSelect: () => undefined }));
  expect(html).toContain('aria-label="Content workflow"');
  expect(html).toContain("Awaiting source");
  expect(html).toContain("No drafts yet");
  expect(html).toContain("No media yet");
});

it("counts persisted motion assets as media even when there is no still image", () => {
  const job = { id: "job-1", actions: [], assets: [{ actionId: "clip-1", mime: "video/mp4", sizeBytes: 1000, digest: "a".repeat(64) }] } as unknown as JobFull;
  const html = renderToStaticMarkup(createElement(ArtifactBoard, { job, model: buildStudioWorkspace(job, []), onSelect: () => undefined }));
  expect(html).toContain("1 asset");
});
