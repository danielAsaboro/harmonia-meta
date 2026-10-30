import { cloneElement, type AriaAttributes, type HTMLAttributes, type ReactElement, type ReactNode } from "react";
import { joinClasses } from "./types";

type FieldControlProps = {
  id?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: AriaAttributes["aria-invalid"];
};

interface FormFieldProps extends Omit<HTMLAttributes<HTMLDivElement>, "children"> {
  id: string;
  label: ReactNode;
  description?: ReactNode;
  error?: ReactNode;
  required?: boolean;
  children?: ReactElement<FieldControlProps>;
}

export function FormField({ id, label, description, error, required, children, className, ...props }: FormFieldProps) {
  if (!children) throw new Error("FormField requires exactly one control child.");
  const describedBy = [description && `${id}-description`, error && `${id}-error`].filter(Boolean).join(" ") || undefined;
  const control = cloneElement(children, {
    id,
    "aria-describedby": describedBy,
    "aria-invalid": error ? true : children.props["aria-invalid"],
  });

  return (
    <div className={joinClasses("dash-field", className)} {...props}>
      <label htmlFor={id} className="dash-field__label">
        {label}
        {required && <span className="dash-field__required" aria-hidden="true">*</span>}
      </label>
      {description && <p id={`${id}-description`} className="dash-field__description">{description}</p>}
      {control}
      {error && <p id={`${id}-error`} role="alert" className="dash-field__error">{error}</p>}
    </div>
  );
}
