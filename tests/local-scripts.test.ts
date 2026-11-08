import { describe, expect, it } from "vitest";
import {
  consumeSecretCharacter,
  consumeSecretChunk,
  readSecret,
} from "../scripts/lib/read-secret.mjs";
import { updateEnvFile } from "../scripts/lib/env-file.mjs";

const initial = { value: "", complete: false, interrupted: false };

describe("hidden local password input", () => {
  it("terminates a pasted password at CR without storing the terminator", () => {
    expect(consumeSecretChunk(initial, "A-valid-password\r")).toEqual({
      value: "A-valid-password",
      complete: true,
      interrupted: false,
    });
  });

  it("terminates at LF and ignores data after the terminator", () => {
    expect(consumeSecretChunk(initial, "secret-value\nignored").value).toBe(
      "secret-value",
    );
  });

  it("supports character input and backspace", () => {
    let state = initial;
    for (const character of "secrex\u007ft\r")
      state = consumeSecretCharacter(state, character);
    expect(state).toMatchObject({ value: "secret", complete: true });
  });

  it("detects interruption without adding control characters", () => {
    expect(consumeSecretChunk(initial, "secret\u0003")).toEqual({
      value: "secret",
      complete: false,
      interrupted: true,
    });
  });

  it("restores terminal raw mode after pasted input", async () => {
    const rawModes: boolean[] = [];
    const input = {
      isTTY: true, isRaw: false,
      setRawMode(value: boolean) { rawModes.push(value); this.isRaw = value; },
      resume() {}, pause() {},
      async *[Symbol.asyncIterator]() { yield "pasted-password\r"; },
    };
    const writes: string[] = [];
    const value = await readSecret("Password: ", {
      input: input as never,
      output: { write: (text: string) => { writes.push(text); } } as never,
    });
    expect(value).toBe("pasted-password");
    expect(rawModes).toEqual([true, false]);
    expect(writes.join("")).not.toContain(value);
  });
});

describe("local environment configuration", () => {
  it("updates canonical values without duplicating or deleting custom values", () => {
    const result = updateEnvFile("CUSTOM=value\nAPP_ORIGIN=http://old\n", {
      APP_ORIGIN: "http://localhost:3107",
      ALLOW_SELF_SIGNUP: "false",
    });
    expect(result).toContain("CUSTOM=value\n");
    expect(result).toContain("APP_ORIGIN=http://localhost:3107\n");
    expect(result).toContain("ALLOW_SELF_SIGNUP=false\n");
    expect(result.match(/APP_ORIGIN=/g)).toHaveLength(1);
  });

  it("removes duplicate managed keys", () => {
    const result = updateEnvFile("APP_ORIGIN=one\nAPP_ORIGIN=two\n", {
      APP_ORIGIN: "http://localhost:3107",
    });
    expect(result.match(/APP_ORIGIN=/g)).toHaveLength(1);
  });
});
