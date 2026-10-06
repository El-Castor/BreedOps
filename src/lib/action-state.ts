import { ZodError } from "zod";

export type ActionState = {
  status: "idle" | "success" | "error";
  message?: string;
  fieldErrors?: Record<string, string[]>;
};

export const initialActionState: ActionState = { status: "idle" };

export function actionError(error: unknown, fallback: string): ActionState {
  if (error instanceof ZodError) {
    const flattened = error.flatten();
    return {
      status: "error",
      message: "Vérifiez les champs signalés.",
      fieldErrors: flattened.fieldErrors as Record<string, string[]>,
    };
  }
  console.error("BreedOps action failed", {
    name: error instanceof Error ? error.name : "UnknownError",
    message: error instanceof Error ? error.message : "Unknown failure",
  });
  return { status: "error", message: fallback };
}

export function actionSuccess(message: string): ActionState {
  return { status: "success", message };
}
