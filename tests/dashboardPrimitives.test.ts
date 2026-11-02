import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Button } from "@/components/dashboard/Button";
import { TextInput } from "@/components/dashboard/Controls";
import { FormField } from "@/components/dashboard/FormField";
import { StatusBadge } from "@/components/dashboard/StatusBadge";
import { ErrorState } from "@/components/dashboard/SystemState";
import { ConfirmationDialog } from "@/components/dashboard/ConfirmationDialog";
import { nextTabIndex } from "@/components/dashboard/Tabs";

describe("dashboard primitives", () => {
  it("keeps a field label, description, and error associated with its control", () => {
    const html = renderToStaticMarkup(
      createElement(
        FormField,
        {
          id: "audience",
          label: "Target audience",
          description: "Used in drafting.",
          error: "Audience is required",
        },
        createElement(TextInput, { id: "audience" }),
      ),
    );

    expect(html).toContain('for="audience"');
    expect(html).toContain('aria-describedby="audience-description audience-error"');
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain('role="alert"');
  });

  it("communicates operational status with a readable label rather than color alone", () => {
    const html = renderToStaticMarkup(
      createElement(StatusBadge, { tone: "warning" }, "Awaiting approval"),
    );

    expect(html).toContain("Awaiting approval");
    expect(html).toContain('data-tone="warning"');
    expect(html).toContain('aria-hidden="true"');
  });

  it("keeps busy and error states explicit to assistive technology", () => {
    const busy = renderToStaticMarkup(
      createElement(Button, { busy: true, busyLabel: "Saving changes" }, "Save"),
    );
    const error = renderToStaticMarkup(
      createElement(ErrorState, { title: "Could not load", message: "HTTP 401" }),
    );

    expect(busy).toContain("Saving changes");
    expect(busy).toContain('aria-busy="true"');
    expect(busy).toContain("disabled");
    expect(error).toContain('role="alert"');
    expect(error).toContain("HTTP 401");
  });

  it("wraps keyboard tab navigation without losing the active tab", () => {
    expect(nextTabIndex(0, 3, "ArrowLeft")).toBe(2);
    expect(nextTabIndex(2, 3, "ArrowRight")).toBe(0);
    expect(nextTabIndex(1, 3, "Home")).toBe(0);
    expect(nextTabIndex(1, 3, "End")).toBe(2);
  });

  it("carries dashboard tokens when a dialog mounts outside the page canvas", () => {
    const html = renderToStaticMarkup(createElement(ConfirmationDialog, {
      open: true,
      title: "Sign out?",
      description: "Your workspace remains unchanged.",
      confirmLabel: "Sign out",
      onConfirm: () => undefined,
      onCancel: () => undefined,
    }));
    expect(html).toContain('class="dashboard-app dash-dialog-backdrop"');
    expect(html).toContain('class="dash-dialog"');
  });
});
