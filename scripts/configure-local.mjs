import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { updateEnvFile } from "./lib/env-file.mjs";
import { runSupabase } from "./lib/supabase-cli.mjs";
import {
  CANONICAL,
  assertStatusMatchesProfile,
  currentProfile,
} from "./lib/stack-identity.mjs";
import { releaseCheckWorkdirPath } from "./lib/release-check-workdir.mjs";

const profile = currentProfile();
const statusArgs =
  profile.name === CANONICAL.name
    ? ["status", "-o", "json"]
    : ["status", "-o", "json", "--workdir", releaseCheckWorkdirPath()];

// Local CLI-generated keys only; never print credentials or use a hosted project.
const raw = runSupabase(statusArgs, { capture: true });
const data = JSON.parse(raw);
assertStatusMatchesProfile(data, profile);
if (!data.ANON_KEY || !data.SERVICE_ROLE_KEY) {
  throw new Error(`Expected isolated local Supabase stack (${profile.name}) with keys present`);
}

mkdirSync(".local", { recursive: true });
writeFileSync(profile.backendFile, JSON.stringify(data), { mode: 0o600 });
console.log(`Privileged local test configuration written to ${profile.backendFile}.`);

if (profile.name === CANONICAL.name) {
  // Only the canonical dev profile ever writes to .env.local - the
  // disposable release-check profile never touches a developer's real
  // local app configuration. release-check.mjs instead passes the
  // disposable stack's URL/keys as explicit process env vars to the
  // `build`/`start` child processes it spawns.
  const currentEnv = existsSync(".env.local")
    ? readFileSync(".env.local", "utf8")
    : "";
  writeFileSync(
    ".env.local",
    updateEnvFile(currentEnv, {
      NEXT_PUBLIC_SUPABASE_URL: data.API_URL,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: data.ANON_KEY,
      SUPABASE_SERVICE_ROLE_KEY: data.SERVICE_ROLE_KEY,
      APP_ORIGIN: profile.appOrigin,
      ALLOW_SELF_SIGNUP: "false",
    }),
    { mode: 0o600 },
  );
  console.log("Local application configuration updated in .env.local.");
}
