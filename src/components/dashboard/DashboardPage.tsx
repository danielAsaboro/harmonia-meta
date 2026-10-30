import type { HTMLAttributes, ReactNode } from "react";
import { joinClasses } from "./types";

interface DashboardPageProps extends HTMLAttributes<HTMLDivElement> {
  title: string;
  description?: ReactNode;
  eyebrow?: ReactNode;
  actions?: ReactNode;
}

export function DashboardPage({ title, description, eyebrow, actions, children, className, ...props }: DashboardPageProps) {
  return (
    <div className={joinClasses("dash-page", className)} {...props}>
      <header className="dash-page__header">
        <div className="dash-page__heading">
          {eyebrow && <div className="dash-eyebrow">{eyebrow}</div>}
          <h1>{title}</h1>
          {description && <p>{description}</p>}
        </div>
        {actions && <div className="dash-page__actions">{actions}</div>}
      </header>
      {children}
    </div>
  );
}

interface SectionHeaderProps extends HTMLAttributes<HTMLDivElement> {
  title: string;
  description?: ReactNode;
  metadata?: ReactNode;
  actions?: ReactNode;
}

export function SectionHeader({ title, description, metadata, actions, className, ...props }: SectionHeaderProps) {
  return (
    <div className={joinClasses("dash-section-header", className)} {...props}>
      <div>
        <div className="dash-section-header__title-row">
          <h2>{title}</h2>
          {metadata}
        </div>
        {description && <p>{description}</p>}
      </div>
      {actions && <div className="dash-section-header__actions">{actions}</div>}
    </div>
  );
}
