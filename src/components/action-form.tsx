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
}: {
  action: FormAction;
  children: ReactNode;
  className?: string;
  actionName?: string;
  resetOnSuccess?: boolean;
  disabled?: boolean;
  submitLabel?: string;
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
      }
    } catch {
      window.sessionStorage.removeItem(flashKey);
    }
  }, [actionName]);
  useEffect(() => {
    if (state.status === "success") {
      if (resetOnSuccess) ref.current?.reset();
    }
  }, [state.status, resetOnSuccess]);
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
        <p
          className={`form-message ${state.status}`}
          role={state.status === "error" ? "alert" : "status"}
        >
          {state.message}
        </p>
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
