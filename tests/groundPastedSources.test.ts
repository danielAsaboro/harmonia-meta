import { describe, expect, it } from "vitest";
import { groundPastedSources } from "@/lib/chatIntent";

const message = 'Turn this into a LinkedIn post. Source: "Rules alone caught 7 of 12; with Muse Glimmer, 12 of 12."';

describe("pasted sources stay the operator's own words", () => {
  it("uses the whole message when the router found no source", () => {
    expect(groundPastedSources([], message, false)).toEqual([{ kind: "pasted_text", title: "Operator message", text: message }]);
  });

  it("keeps a verbatim excerpt the router extracted", () => {
    const excerpt = { kind: "pasted_text" as const, title: "Eval", text: "Rules alone caught 7 of 12; with Muse Glimmer, 12 of 12." };
    expect(groundPastedSources([excerpt], message, false)).toEqual([excerpt]);
  });

  it("replaces a paraphrase with the message itself", () => {
    const paraphrase = { kind: "pasted_text" as const, title: "Brief", text: "Create a LinkedIn post about Harmonia's results" };
    expect(groundPastedSources([paraphrase], message, false)).toEqual([{ kind: "pasted_text", title: "Operator message", text: message }]);
  });

  it("leaves URL sources and attachment-only requests alone", () => {
    const web = { kind: "web" as const, url: "https://example.com/talk" };
    expect(groundPastedSources([web], message, false)).toEqual([web]);
    expect(groundPastedSources([], "Make posts from this video", true)).toEqual([]);
  });
});
