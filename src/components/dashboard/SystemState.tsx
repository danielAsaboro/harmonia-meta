import type { HTMLAttributes, ReactNode } from "react";
import type { Tone } from "./types";
import { joinClasses } from "./types";

interface AlertBannerProps extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
  tone?: Tone;
  title?: ReactNode;
  actions?: ReactNode;
}

export function AlertBanner({ tone = "info", title, actions, children, className, ...props }: AlertBannerProps) {
  return (
    <div role={tone === "danger" ? "alert" : "status"} data-tone={tone} className={joinClasses("dash-alert", className)} {...props}>
      <span className="dash-alert__icon" aria-hidden="true" />
      <div className="dash-alert__body">{title && <strong>{title}</strong>}<div>{children}</div></div>
      {actions && <div className="dash-alert__actions">{actions}</div>}
    </div>
  );
}

interface SystemStateProps extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
  title: ReactNode;
  message?: ReactNode;
  action?: ReactNode;
}

function SystemState({ title, message, action, className, ...props }: SystemStateProps) {
  return <div className={joinClasses("dash-system-state", className)} {...props}><span className="dash-system-state__mark" aria-hidden="true" /><strong>{title}</strong>{message && <p>{message}</p>}{action && <div className="dash-system-state__action">{action}</div>}</div>;
}

export function LoadingState({ title = "Loading…", message, ...props }: Partial<SystemStateProps>) {
  return <SystemState title={title} message={message} role="status" aria-live="polite" className="dash-system-state--loading" {...props} />;
}

export function EmptyState(props: SystemStateProps) {
  return <SystemState {...props} className={joinClasses("dash-system-state--empty", props.className)} />;
}

export function ErrorState(props: SystemStateProps) {
  return <SystemState {...props} role="alert" className={joinClasses("dash-system-state--error", props.className)} />;
}
