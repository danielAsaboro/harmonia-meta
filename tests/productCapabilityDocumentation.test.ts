import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const read = (relative: string) => fs.readFileSync(path.join(process.cwd(), relative), "utf8");

describe("public product capability documentation", () => {
  it("states the exact export, publication, approval, and evidence boundaries", () => {
    const publicDocs = ["README.md", "docs/pipeline.mdx", "docs/operational-model.mdx"]
      .map(read).join("\n");
    expect(publicDocs).toContain("canonical JSON plus deterministic Markdown");
    expect(publicDocs).toContain("publish_x_thread");
    expect(publicDocs).toContain("publish_linkedin_post");
    expect(publicDocs).toContain("content packs require already-verified constituents");
    expect(publicDocs).toContain("pending authenticated run");
    expect(publicDocs).not.toMatch(/all (?:formats|artifacts) (?:are|can be) published/i);
  });

  it("keeps current architecture surfaces free of replaced runtime contracts", () => {
    const current = [
      "README.md", "docs/pipeline.mdx", "docs/architecture/overview.mdx",
      "docs/operational-model.mdx", "docs/a2ui-console.mdx",
      "docs/architecture-explorer.mdx", "src/lib/architecture/data.ts",
      "src/docs-architecture-flow.tsx",
    ].map(read).join("\n");
    expect(current).not.toContain("export_content_pack");
    expect(current).not.toContain("Compatibility display alias");
    expect(current).not.toContain("run_ingest");
    expect(current).not.toContain("run_transcribe");
    expect(current).not.toContain("Creates one grounded platform-native draft");
  });
});
