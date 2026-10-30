import type { HTMLAttributes } from "react";
import type { Tone } from "./types";
import { joinClasses } from "./types";

interface StatusBadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: Tone;
}

export function StatusBadge({ tone = "neutral", children, className, ...props }: StatusBadgeProps) {
  return (
    <span data-tone={tone} className={joinClasses("dash-status", className)} {...props}>
      <span className="dash-status__mark" aria-hidden="true" />
      <span>{children}</span>
    </span>
  );
}
