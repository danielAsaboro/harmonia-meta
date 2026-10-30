"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { Button } from "./Button";

interface ConfirmationDialogProps {
  open: boolean;
  title: string;
  description: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  dangerous?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmationDialog({ open, title, description, confirmLabel, cancelLabel = "Cancel", dangerous, busy, onConfirm, onCancel }: ConfirmationDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    cancelRef.current?.focus();
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") onCancel(); };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [open, onCancel]);

  if (!open) return null;
  return (
    <div className="dashboard-app dash-dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onCancel(); }}>
      <div role="dialog" aria-modal="true" aria-labelledby="dash-dialog-title" aria-describedby="dash-dialog-description" className="dash-dialog">
        <h2 id="dash-dialog-title">{title}</h2>
        <div id="dash-dialog-description">{description}</div>
        <div className="dash-dialog__actions">
          <Button ref={cancelRef} onClick={onCancel}>{cancelLabel}</Button>
          <Button variant={dangerous ? "danger" : "primary"} busy={busy} busyLabel="Confirming…" onClick={onConfirm}>{confirmLabel}</Button>
        </div>
      </div>
    </div>
  );
}
