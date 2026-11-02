import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("login presentation", () => {
  it("uses a dedicated branded auth shell without legacy zinc styling", () => {
    const page = readFileSync("src/app/login/page.tsx", "utf8");
    const styles = readFileSync("src/app/login/login.module.css", "utf8");

    expect(page).toContain("styles.shell");
    expect(page).toContain("styles.story");
    expect(page).toContain("styles.authPanel");
    expect(page).toContain('role="alert"');
    expect(page).toContain('aria-busy={busy}');
    expect(page).not.toMatch(/dark:|zinc-/);
    expect(styles).toContain("@media (max-width: 760px)");
    expect(styles).toContain("prefers-reduced-motion");
    expect(styles).toContain(".googleButton > span:last-child");
    expect(styles).toContain("grid-template-columns: 24px auto 24px");
    expect(page).toContain("styles.googleLogo");
    expect(page).toContain('viewBox="0 0 18 18"');
  });
});
