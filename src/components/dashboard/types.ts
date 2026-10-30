export type Tone = "neutral" | "info" | "success" | "warning" | "danger" | "generated";

export function joinClasses(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ");
}
