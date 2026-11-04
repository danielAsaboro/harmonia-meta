import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ClipCritiqueSummary, ClipReviewSummary, clipCritique, clipReviews } from "@/components/ClipReviewSummary";

const review = {
  momentId: "m1", gate: "measured", kept: 2, passed: true,
  versions: [
    { window: [12, 20], passed: false, durationSec: 8, faults: [{ code: "dead_air_start", severity: "major", startSec: 0, endSec: 1.2 }] },
    { window: [13.05, 20], passed: true, durationSec: 6.95, faults: [] },
  ],
};

describe("clip review summary", () => {
  it("keeps only well-formed reviews whose kept version exists", () => {
    expect(clipReviews({ review: [review, { ...review, kept: 3 }, { momentId: "x" }] })).toHaveLength(1);
    expect(clipReviews({})).toEqual([]);
  });

  it("shows each measured version and marks the delivered one", () => {
    const html = renderToStaticMarkup(createElement(ClipReviewSummary, { review: clipReviews({ review: [review] })[0] }));
    expect(html).toContain("v1 12.00–20.00 s · failed: dead air start 0.0–1.2 s");
    expect(html).toContain("v2 13.05–20.00 s · passed");
    expect(html).toContain("· delivered");
  });

  it("shows Muse Spark's blind score and timed issues", () => {
    const critique = clipCritique({ critique: { model: "muse-spark-1.3", score: 82, issues: [{ tSec: 1.2, criterion: "hook", severity: "major", note: "Opens on a pause." }] } });
    expect(clipCritique({})).toBeNull();
    const html = renderToStaticMarkup(createElement(ClipCritiqueSummary, { critique: critique! }));
    expect(html).toContain("82/100");
    expect(html).toContain("1.2 s · hook (major): Opens on a pause.");
  });
});
