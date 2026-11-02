import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ReplayModeBanner } from "@/components/ReplayModeBanner";

describe("replay disclosure", () => {
  it("permanently identifies historical replay provenance", () => {
    const html = renderToStaticMarkup(createElement(ReplayModeBanner, { bundleId: "golden-1", capturedAt: "2026-08-26T10:00:00.000Z" }));
    expect(html).toContain("Recorded authenticated run — replay mode"); expect(html).toContain("golden-1"); expect(html).toContain("Aug 26, 2026"); expect(html).toContain("not fresh provider or deployment evidence"); expect(html).not.toContain("button");
  });
});
