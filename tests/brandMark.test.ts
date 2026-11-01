import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { BrandMark } from "../src/components/BrandMark";

describe("BrandMark", () => {
  it("renders the production Harmonia symbol with accessible alternative text", () => {
    const html = renderToStaticMarkup(createElement(BrandMark));

    expect(html).toContain('src="/brand/harmonia-mark.png"');
    expect(html).toContain('alt="Harmonia"');
    expect(html).not.toContain(">H<");
  });

  it("can be decorative when the surrounding link already names Harmonia", () => {
    const html = renderToStaticMarkup(createElement(BrandMark, { decorative: true }));

    expect(html).toContain('alt=""');
    expect(html).toContain('aria-hidden="true"');
  });
});
