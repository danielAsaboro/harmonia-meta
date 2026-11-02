import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("settings presentation", () => {
  it("uses the shared operator page and semantic settings sections", () => {
    const page = readFileSync("src/app/dashboard/settings/page.tsx", "utf8");
    const view = readFileSync("src/components/SettingsView.tsx", "utf8");
    expect(page).toContain("<DashboardPage");
    expect(view).toContain('className="settings-grid"');
    expect(view).toContain('className="settings-section"');
    expect(view).toContain("<TextInput");
    expect(view).toContain("<Button");
    expect(view).toContain("<StatusBadge");
  });
});
