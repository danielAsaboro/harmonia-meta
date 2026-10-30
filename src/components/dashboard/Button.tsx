import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { joinClasses } from "./types";

export type ButtonVariant = "primary" | "secondary" | "quiet" | "danger";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  busy?: boolean;
  busyLabel?: string;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button({ variant = "secondary", busy = false, busyLabel = "Working…", children, disabled, className, type = "button", ...props }, ref) {
  return (
    <button
      type={type}
      ref={ref}
      {...props}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      className={joinClasses("dash-button", `dash-button--${variant}`, className)}
    >
      {busy && <span className="dash-button__spinner" aria-hidden="true" />}
      <span>{busy ? busyLabel : children}</span>
    </button>
  );
});

interface IconButtonProps extends Omit<ButtonProps, "children"> {
  label: string;
  tooltip?: string;
  children: ReactNode;
}

export function IconButton({ label, tooltip = label, children, className, ...props }: IconButtonProps) {
  return (
    <Button {...props} aria-label={label} data-tooltip={tooltip} className={joinClasses("dash-icon-button", className)}>
      {children}
    </Button>
  );
}
