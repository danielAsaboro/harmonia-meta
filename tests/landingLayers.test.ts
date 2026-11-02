import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import LandingPage from "../src/app/page";

describe("landing page layers", () => {
  it("places the live workflow between the existing engine and outputs layers", () => {
    const markup = renderToStaticMarkup(createElement(LandingPage));
    const engine = markup.indexOf('id="workflow"');
    const liveWorkflow = markup.indexOf('data-layer="live-workflow"');
    const outputs = markup.indexOf('id="outputs"');

    expect(engine).toBeGreaterThan(-1);
    expect(liveWorkflow).toBeGreaterThan(engine);
    expect(outputs).toBeGreaterThan(liveWorkflow);
  });

  it("uses an interactive globe visual in the existing return layer", () => {
    const markup = renderToStaticMarkup(createElement(LandingPage));

    expect(markup).toContain('aria-label="Interactive signal globe"');
    expect(markup).toContain("The receipt becomes the next seed.");
  });

  it("presents broad source support while keeping the video-led demonstration", () => {
    const markup = renderToStaticMarkup(createElement(LandingPage));

    expect(markup).toContain("Start a content run");
    expect(markup).toContain("Video · audio · documents · webpages · text");
    expect(markup).toContain("Founder story.mp4");
    expect(markup).not.toContain("Start with a video");
    expect(markup).not.toContain("inside your long-form video");
  });
});
