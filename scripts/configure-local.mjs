import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";

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
writeFileSync(
  ".env.local",
  `NEXT_PUBLIC_SUPABASE_URL=${data.API_URL}\nNEXT_PUBLIC_SUPABASE_ANON_KEY=${data.ANON_KEY}\nAPP_ORIGIN=http://localhost:3107\n`,
  { mode: 0o600, flag: "wx" },
);
console.log(
  "Local configuration written; privileged test key isolated from application environment.",
);
