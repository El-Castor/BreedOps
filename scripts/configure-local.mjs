import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { updateEnvFile } from "./lib/env-file.mjs";

// Local CLI-generated keys only; never print credentials or use a hosted project.
const raw = execFileSync(
  "npm",
  [
    "exec",
    "--yes",
    "--package=supabase@2.75.0",
    "--",
    "supabase",
    "status",
    "-o",
    "json",
  ],
  { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
);
const data = JSON.parse(raw);
if (
  data.API_URL !== "http://127.0.0.1:55421" ||
  !data.ANON_KEY ||
  !data.SERVICE_ROLE_KEY
) {
  throw new Error("Expected isolated local BreedOps Supabase on port 55421");
}
mkdirSync(".local", { recursive: true });
writeFileSync(".local/test-backend.json", JSON.stringify(data), {
  mode: 0o600,
});
const currentEnv = existsSync(".env.local")
  ? readFileSync(".env.local", "utf8")
  : "";
writeFileSync(
  ".env.local",
  updateEnvFile(currentEnv, {
    NEXT_PUBLIC_SUPABASE_URL: data.API_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: data.ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY: data.SERVICE_ROLE_KEY,
    APP_ORIGIN: "http://localhost:3107",
    ALLOW_SELF_SIGNUP: "false",
  }),
  { mode: 0o600 },
);
console.log("Local application configuration updated in .env.local.");
console.log(
  "Privileged local test configuration written to .local/test-backend.json.",
);
