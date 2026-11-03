import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SubjectTrackPreview, subjectTracks } from "@/components/SubjectTrackPreview";

const track = {
  momentId: "m1", model: "sam-3.1", subject: "person", sourceWidth: 1920, sourceHeight: 1080,
  cropWidth: 608, cropHeight: 1080, keyframes: [[12, 400], [13.2, 520], [14.4, 900]] as [number, number][],
};

describe("SAM subject track preview", () => {
  it("reads only well-formed tracks from a receipt", () => {
    expect(subjectTracks({ tracking: [track, { momentId: "bad" }] })).toEqual([track]);
    expect(subjectTracks({ notes: ["kept the full frame"] })).toEqual([]);
    expect(subjectTracks(undefined)).toEqual([]);
  });

  it("animates the crop window along the tracked keyframes over the moment", () => {
    const html = renderToStaticMarkup(createElement(SubjectTrackPreview, { track }));
    expect(html).toContain('viewBox="0 0 1920 1080"');
    expect(html).toContain('values="400;520;900"');
    expect(html).toContain('keyTimes="0;0.5000;1"');
    expect(html).toContain(`dur="${14.4 - 12}s"`);
    expect(html).toContain("crop moved between x 400 and 900");
  });
});
