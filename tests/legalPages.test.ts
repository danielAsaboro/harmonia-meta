import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import PrivacyPage from "@/app/privacy/page";
import DataDeletionPage from "@/app/data-deletion/page";
import TermsPage from "@/app/terms/page";

describe("public legal pages", () => {
  it("renders an actionable privacy policy for OAuth users", () => {
    const html = renderToStaticMarkup(createElement(PrivacyPage));

    expect(html).toContain("Privacy Policy");
    expect(html).toContain("Google");
    expect(html).toContain("LinkedIn");
    expect(html).toContain("Instagram");
    expect(html).toContain("YouTube");
    expect(html).toContain("disconnect");
    expect(html).toContain("delete");
    expect(html).toContain('href="/"');
  });

  it("renders terms that describe approval-gated publishing", () => {
    const html = renderToStaticMarkup(createElement(TermsPage));

    expect(html).toContain("Terms of Service");
    expect(html).toContain("human approval");
    expect(html).toContain("official platform APIs");
    expect(html).toContain("connected account");
    expect(html).toContain('href="/privacy"');
  });

  it("renders actionable Meta user-data deletion instructions", () => {
    const html = renderToStaticMarkup(createElement(DataDeletionPage));

    expect(html).toContain("User Data Deletion");
    expect(html).toContain("Harmonia settings");
    expect(html).toContain("Facebook");
    expect(html).toContain("Instagram");
    expect(html).toContain("published content");
    expect(html).toContain('href="/privacy"');
  });
});
