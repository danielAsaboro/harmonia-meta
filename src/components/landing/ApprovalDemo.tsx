"use client";

import { useState } from "react";

import { type ApprovalDecision, getApprovalOutcome } from "./workflow";

export function ApprovalDemo() {
  const [decision, setDecision] = useState<ApprovalDecision>("pending");
  const outcome = getApprovalOutcome(decision);

  return (
    <div className="approval-demo" data-decision={decision}>
      <div className="approval-island" aria-live="polite">
        <span className="approval-light" />
        <div>
          <small>{outcome.label}</small>
          <strong>{outcome.detail}</strong>
        </div>
        <span className="approval-lock">{decision === "approved" ? "↗" : "⌁"}</span>
      </div>

      <div className="approval-preview-card">
        <div className="approval-card-head">
          <span className="platform-avatar">in</span>
          <div><strong>LinkedIn founder post</strong><small>Draft 04 · policy checked</small></div>
          <span className="draft-pill">READY</span>
        </div>
        <p>
          We spent months trying to manufacture attention. The breakthrough came when we stopped
          broadcasting and started listening to the conversations customers were already having.
        </p>
        <div className="approval-metrics">
          <span>Voice match <b>94%</b></span>
          <span>Claims <b>3 checked</b></span>
          <span>Risk <b>low</b></span>
        </div>
        <div className="approval-actions">
          <button type="button" onClick={() => setDecision("revision")}>Request revision</button>
          <button type="button" onClick={() => setDecision("approved")}>Approve & unlock <span>✓</span></button>
        </div>
      </div>

      <button type="button" className="reset-decision" onClick={() => setDecision("pending")}>Reset demo</button>
    </div>
  );
}
