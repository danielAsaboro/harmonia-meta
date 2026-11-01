import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("approval accessibility contract", () => {
  it.each(["src/components/studio/ApprovalDock.tsx", "src/components/JobDetail.tsx"])(
    "%s exposes keyboard-native decisions and announced progress",
    (path) => {
      const source = readFileSync(path, "utf8");
      expect(source).toContain('role="status"');
      expect(source).toContain('aria-live="polite"');
      expect(source).toContain("aria-busy={busy}");
      expect(source).toMatch(/aria-label={`Approve \$\{/);
      expect(source).toMatch(/aria-label={`Reject \$\{/);
      expect(source).toContain("Replay proof for");
      expect(source).not.toContain("tabIndex={-1}");
    },
  );
});
