import { describe, expect, it } from "vitest";

import { authorizeJobRetry } from "../src/lib/jobRetry";

const permanentFailure = {
  stage: "strategize",
  category: "validation",
  code: "internal_contract_rejected",
  publicMessage: "Stage input or output did not satisfy its contract.",
  retryable: false,
  details: { contractRevision: "internal-contract-2026-09-04.1" },
};

describe("job retry authorization", () => {
  it("allows an ordinary retry only for a retryable failure", () => {
    expect(authorizeJobRetry({ ...permanentFailure, retryable: true }, false, "internal-contract-2026-09-04.1")).toEqual({ allowPermanent: false });
  });

  it("blocks blind replay of deterministic failures", () => {
    expect(() => authorizeJobRetry(permanentFailure, false, "internal-contract-2026-09-04.2")).toThrow("requires an explicit deployed-fix acknowledgement");
  });

  it("rejects after-fix replay while the failed contract revision is still deployed", () => {
    expect(() => authorizeJobRetry(permanentFailure, true, "internal-contract-2026-09-04.1")).toThrow("no newer contract correction is deployed");
  });

  it("allows an administrator to resume after deploying a newer correction", () => {
    expect(authorizeJobRetry(permanentFailure, true, "internal-contract-2026-09-04.2")).toEqual({ allowPermanent: true });
  });

  it("allows an acknowledged legacy failure that predates contract revision tagging", () => {
    expect(authorizeJobRetry({ ...permanentFailure, details: {} }, true, "internal-contract-2026-09-04.1")).toEqual({ allowPermanent: true });
  });
});
