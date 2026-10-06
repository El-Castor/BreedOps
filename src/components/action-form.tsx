"use client";

import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { initialActionState, type ActionState } from "@/lib/action-state";

type FormAction = (
  previousState: ActionState,
  formData: FormData,
) => Promise<ActionState>;

const flashKey = "breedops-action-result";

export function ActionForm({
  action,
  children,
  className = "form",
  actionName,
  resetOnSuccess = true,
  disabled = false,
  submitLabel = "Enregistrer",
  revealOnFlash = true,
}: {
  action: FormAction;
  children: ReactNode;
  className?: string;
  actionName?: string;
  resetOnSuccess?: boolean;
  disabled?: boolean;
  submitLabel?: string;
  /** Open an enclosing menu so a restored success/error message is visible. */
  revealOnFlash?: boolean;
}) {
  const [state, setState] = useState(initialActionState);
  const [pending, setPending] = useState(false);
  const ref = useRef<HTMLFormElement>(null);
  const progressiveAction = action.bind(
    null,
    initialActionState,
  ) as unknown as (formData: FormData) => void | Promise<void>;
  useEffect(() => {
    if (!actionName) return;
    const stored = window.sessionStorage.getItem(flashKey);
    if (!stored) return;
    try {
      const flash = JSON.parse(stored) as {
        actionName?: string;
        state?: ActionState;
      };
      if (flash.actionName === actionName && flash.state) {
        setState(flash.state);
        window.sessionStorage.removeItem(flashKey);
        if (revealOnFlash)
          ref.current?.closest("details")?.setAttribute("open", "");
      }
    } catch {
      window.sessionStorage.removeItem(flashKey);
    }
  }, [actionName, revealOnFlash]);
  useEffect(() => {
    if (state.status === "success") {
      if (resetOnSuccess) ref.current?.reset();
    }
  }, [state.status, resetOnSuccess]);
  // Inline validation: server-side Zod errors mark the matching controls and
  // are listed under their visible label next to the form message.
  const invalidKey = Object.keys(state.fieldErrors ?? {}).join(",");
  const invalidFields = invalidKey ? invalidKey.split(",") : [];
  useEffect(() => {
    const form = ref.current;
    if (!form) return;
    form
      .querySelectorAll("[aria-invalid]")
      .forEach((element) => element.removeAttribute("aria-invalid"));
    for (const name of invalidKey ? invalidKey.split(",") : []) {
      const control = form.elements.namedItem(name);
      if (control instanceof HTMLElement)
        control.setAttribute("aria-invalid", "true");
    }
  }, [invalidKey]);
  const fieldLabel = (name: string) => {
    const control = ref.current?.elements.namedItem(name);
    const label =
      control instanceof HTMLElement ? control.closest("label") : null;
    return label?.firstChild?.textContent?.trim() || name;
  };
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    setPending(true);
    try {
      const result = await action(initialActionState, formData);
      setState(result);
      if (result.status === "success") {
        if (actionName) {
          window.sessionStorage.setItem(
            flashKey,
            JSON.stringify({ actionName, state: result }),
          );
        }
        window.setTimeout(() => window.location.reload(), 0);
      }
    } catch {
      setState({
        status: "error",
        message: "La requête n’a pas pu aboutir. Réessayez.",
      });
    } finally {
      setPending(false);
    }
  };
  return (
    <form
      ref={ref}
      action={progressiveAction}
      onSubmit={submit}
      className={className}
      data-action={actionName}
    >
      {children}
      {state.message && (
        <div
          className={`form-message ${state.status}`}
          role={state.status === "error" ? "alert" : "status"}
        >
          {state.message}
          {invalidFields.length > 0 && (
            <ul>
              {invalidFields.map((name) => (
                <li key={name}>{fieldLabel(name)}</li>
              ))}
            </ul>
          )}
        </div>
      )}
      <SubmitButton
        disabled={disabled || pending}
        label={pending ? "Enregistrement…" : submitLabel}
        pending={pending}
      />
    </form>
  );
}

function SubmitButton({
  disabled,
  label,
  pending,
}: {
  disabled: boolean;
  label: string;
  pending: boolean;
}) {
  return (
    <button type="submit" disabled={disabled} aria-busy={pending}>
      {label}
    </button>
  );
}

export function FieldError({
  state,
  name,
}: {
  state: ActionState;
  name: string;
}) {
  const message = state.fieldErrors?.[name]?.[0];
  return message ? <small className="field-error">{message}</small> : null;
}
