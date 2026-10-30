import type { HTMLAttributes } from "react";
import { joinClasses } from "./types";

export type SurfaceVariant = "base" | "raised" | "inset" | "interactive" | "danger";

interface SurfaceProps extends HTMLAttributes<HTMLElement> {
  as?: "div" | "section" | "article" | "aside";
  variant?: SurfaceVariant;
}

export function Surface({ as: Element = "div", variant = "base", className, ...props }: SurfaceProps) {
  return <Element className={joinClasses("dash-surface", `dash-surface--${variant}`, className)} {...props} />;
}
