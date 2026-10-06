"use client";

import { type ReactNode, useRef } from "react";
import { Icon, type IconName } from "@/components/icons";

// Creation and configuration forms live in a side drawer instead of occupying
// the workspace. The form stays server-rendered inside the dialog, so it works
// before hydration and remains reachable by tests.
export function FormDrawer({
  label,
  title,
  description,
  icon = "add",
  variant = "primary",
  disabled = false,
  disabledReason,
  children,
}: {
  label: string;
  title: string;
  description?: string;
  icon?: IconName;
  variant?: "primary" | "secondary";
  disabled?: boolean;
  disabledReason?: string;
  children: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  return (
    <>
      <button
        type="button"
        className={
          variant === "primary" ? "drawer-trigger" : "drawer-trigger secondary"
        }
        onClick={() => dialog.current?.showModal()}
        disabled={disabled}
        title={disabled ? disabledReason : undefined}
      >
        <Icon name={icon} />
        {label}
      </button>
      <dialog
        ref={dialog}
        className="form-drawer"
        aria-label={title}
        onClick={(event) => {
          if (event.target === event.currentTarget) dialog.current?.close();
        }}
      >
        <div className="form-drawer-panel">
          <header>
            <div>
              <h2>{title}</h2>
              {description && <p>{description}</p>}
            </div>
            <button
              type="button"
              className="icon-button"
              aria-label="Fermer"
              onClick={() => dialog.current?.close()}
            >
              <Icon name="close" />
            </button>
          </header>
          <div className="form-drawer-body">{children}</div>
        </div>
      </dialog>
    </>
  );
}
