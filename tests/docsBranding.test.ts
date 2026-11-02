import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const config = JSON.parse(readFileSync(join(root, "docs/docs.json"), "utf8")) as Record<string, unknown>;

describe("Harmonia documentation brand", () => {
  it("uses the product visual system and real brand assets", () => {
    expect(config).toMatchObject({
      theme: "maple",
      name: "Harmonia",
      description: expect.stringContaining("social media agent"),
      colors: {
        primary: "#5F8F22",
        light: "#B9FF66",
        dark: "#17221D",
      },
      logo: {
        light: "/brand/harmonia-mark.png",
        dark: "/brand/harmonia-mark.png",
        href: "https://useharmonia.xyz",
      },
      background: {
        decoration: "gradient",
        color: { light: "#F4F3E9", dark: "#0D1511" },
      },
      appearance: { default: "system" },
      search: { prompt: "Search Harmonia docs..." },
      metadata: { timestamp: true },
      seo: { indexing: "navigable" },
    });

    expect(existsSync(join(root, "docs/brand/harmonia-mark.png"))).toBe(true);
    expect(existsSync(join(root, "docs/brand/harmonia-banner.png"))).toBe(true);
  });

  it("connects the docs to the product and source repository", () => {
    expect(config).toMatchObject({
      navbar: {
        primary: { type: "button", label: "Open Harmonia", href: "https://useharmonia.xyz" },
      },
      footer: {
        socials: {
          website: "https://useharmonia.xyz",
          github: "https://github.com/danielAsaboro/harmonia",
        },
      },
    });
  });
});
