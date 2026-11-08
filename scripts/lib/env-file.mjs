export function updateEnvFile(source, values) {
  const lines = source ? source.replace(/\n*$/, "").split("\n") : [];
  const pending = new Map(Object.entries(values));
  const seen = new Set();
  const updated = lines.flatMap((line) => {
    const match = /^([A-Z][A-Z0-9_]*)=/.exec(line);
    if (!match || !Object.hasOwn(values, match[1])) return [line];
    if (seen.has(match[1])) return [];
    seen.add(match[1]);
    const value = values[match[1]];
    pending.delete(match[1]);
    return [`${match[1]}=${value}`];
  });
  for (const [key, value] of pending) updated.push(`${key}=${value}`);
  return `${updated.join("\n")}\n`;
}
