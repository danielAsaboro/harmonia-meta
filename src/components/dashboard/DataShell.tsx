import type { HTMLAttributes, ReactNode } from "react";
import { joinClasses } from "./types";

interface DataShellProps extends Omit<HTMLAttributes<HTMLElement>, "title"> {
  title?: ReactNode;
  description?: ReactNode;
  filters?: ReactNode;
  actions?: ReactNode;
}

export function DataShell({ title, description, filters, actions, children, className, ...props }: DataShellProps) {
  return (
    <section className={joinClasses("dash-data-shell", className)} {...props}>
      {(title || description || actions) && <header className="dash-data-shell__header"><div>{title && <h2>{title}</h2>}{description && <p>{description}</p>}</div>{actions}</header>}
      {filters && <div className="dash-data-shell__filters" aria-label="Filters">{filters}</div>}
      <div className="dash-data-shell__viewport">{children}</div>
    </section>
  );
}
