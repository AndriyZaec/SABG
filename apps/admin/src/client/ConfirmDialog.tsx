import { useEffect, useRef } from "react";
import type { ReactNode } from "react";

export function ConfirmDialog({ eyebrow, title, children, confirmLabel, destructive = true, onCancel, onConfirm }: {
  eyebrow: string;
  title: string;
  children: ReactNode;
  confirmLabel: string;
  destructive?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);

  return (
    <dialog className="confirm-modal" ref={dialogRef} aria-labelledby="leaderboard-confirm-title" onCancel={(event) => {
      event.preventDefault();
      onCancel();
    }}>
      <span className="eyebrow">{eyebrow}</span>
      <h2 id="leaderboard-confirm-title">{title}</h2>
      {children}
      <div className="confirm-modal__actions">
        <button className="secondary-action" type="button" autoFocus onClick={onCancel}>Cancel</button>
        <button className={destructive ? "danger-action" : "primary-action"} type="button" onClick={onConfirm}>{confirmLabel}</button>
      </div>
    </dialog>
  );
}
