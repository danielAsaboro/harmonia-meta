import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (name: string) => readFileSync(`src/components/monitoring/${name}.tsx`, "utf8");
const legacyTheme = /dark:|bg-zinc|border-zinc|text-zinc/;

describe("monitoring presentation", () => {
  it.each(["ReceiptsLedger", "WorkflowActivityView", "AssetsGallery"])("keeps %s on the shared dashboard system", (name) => {
    const source = read(name);
    expect(source).not.toMatch(legacyTheme);
    expect(source).toContain("<Surface");
    expect(source).toContain("<Button");
  });

  it("renders receipts through shared controls, statuses, data shell, and empty state", () => {
    const source = read("ReceiptsLedger");
    for (const primitive of ["<TextInput", "<StatusBadge", "<DataShell", "<EmptyState"]) {
      expect(source).toContain(primitive);
    }
  });

  it.each(["JobsTableView", "LogsView"])("removes residual legacy colors from %s", (name) => {
    expect(read(name)).not.toMatch(legacyTheme);
  });
});
