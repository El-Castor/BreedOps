import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split("\n")
    .filter((line) => /^[A-Z][A-Z0-9_]*=/.test(line))
    .map((line) => {
      const index = line.indexOf("=");
      return [line.slice(0, index), line.slice(index + 1)];
    }),
);
const secret = env.SUPABASE_SERVICE_ROLE_KEY;
if (!secret) throw new Error("SUPABASE_SERVICE_ROLE_KEY is required for this check.");
const matches = [];
function scan(path) {
  for (const entry of readdirSync(path)) {
    const target = join(path, entry);
    if (statSync(target).isDirectory()) scan(target);
    else if (readFileSync(target).includes(secret)) matches.push(target);
  }
}
scan(".next/static");
if (matches.length) {
  console.error(`Server credential found in ${matches.length} client artifact(s).`);
  process.exit(1);
}
console.log("No server credential found in client artifacts.");
