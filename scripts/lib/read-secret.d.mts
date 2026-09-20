export type SecretState = { value: string; complete: boolean; interrupted: boolean };
export function consumeSecretCharacter(state: SecretState, character: string): SecretState;
export function consumeSecretChunk(state: SecretState, chunk: unknown): SecretState;
export function readSecret(label: string, options?: { input?: NodeJS.ReadStream; output?: NodeJS.WriteStream }): Promise<string>;
