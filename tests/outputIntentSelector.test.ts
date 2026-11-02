import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { OutputIntentSelector } from "@/components/studio/OutputIntentSelector";
import { OUTPUT_CAPABILITIES } from "@/lib/outputCapabilities";

describe("OutputIntentSelector", () => {
  it("renders every registry capability and marks unavailable promises disabled", () => {
    const html = renderToStaticMarkup(createElement(OutputIntentSelector, { selected: [], onChange: () => undefined }));
    expect((html.match(/<button/g) ?? [])).toHaveLength(Object.keys(OUTPUT_CAPABILITIES).length);
    expect(html).toContain("Generated video");
    expect(html).toContain("Generated music");
    expect(html).toContain("Unavailable");
    expect(html).toContain("LinkedIn post");
    expect(html).toContain("Publish when connected");
  });
});
