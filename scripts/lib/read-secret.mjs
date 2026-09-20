import { stdin as defaultInput, stdout as defaultOutput } from "node:process";

export function consumeSecretCharacter(state, character) {
  if (character === "\r" || character === "\n")
    return { ...state, complete: true };
  if (character === "\u0003") return { ...state, interrupted: true };
  if (character === "\u007f" || character === "\b")
    return { ...state, value: state.value.slice(0, -1) };
  return { ...state, value: state.value + character };
}

export function consumeSecretChunk(state, chunk) {
  let next = state;
  for (const character of String(chunk)) {
    next = consumeSecretCharacter(next, character);
    if (next.complete || next.interrupted) break;
  }
  return next;
}

export async function readSecret(
  label,
  { input = defaultInput, output = defaultOutput } = {},
) {
  if (!input.isTTY || typeof input.setRawMode !== "function")
    throw new Error("Run this command in an interactive local terminal.");
  const previousRawMode = Boolean(input.isRaw);
  output.write(label);
  let state = { value: "", complete: false, interrupted: false };
  try {
    input.setRawMode(true);
    input.resume();
    for await (const chunk of input) {
      state = consumeSecretChunk(state, chunk);
      if (state.complete || state.interrupted) break;
    }
  } finally {
    input.setRawMode(previousRawMode);
    input.pause();
    output.write("\n");
  }
  if (state.interrupted) {
    const error = new Error("Password input interrupted.");
    error.code = "EINTERRUPTED";
    throw error;
  }
  return state.value;
}
