// Prints the disposable release-check stack's app env vars as KEY=value
// lines (one per line), reading the backend file npm run local:configure
// wrote under the release-check profile. Used by CI to export these into
// $GITHUB_ENV for the build/test steps that follow, without ever writing
// .env.local - the same no-dotenv-mutation approach release-check.mjs uses
// locally, so CI and a developer's machine exercise the identical path.
import { readFileSync } from "node:fs";
import { RELEASE_CHECK } from "./lib/stack-identity.mjs";

const backend = JSON.parse(readFileSync(RELEASE_CHECK.backendFile, "utf8"));
const lines = [
  `NEXT_PUBLIC_SUPABASE_URL=${backend.API_URL}`,
  `NEXT_PUBLIC_SUPABASE_ANON_KEY=${backend.ANON_KEY}`,
  `SUPABASE_SERVICE_ROLE_KEY=${backend.SERVICE_ROLE_KEY}`,
  `APP_ORIGIN=${RELEASE_CHECK.appOrigin}`,
  `ALLOW_SELF_SIGNUP=false`,
];
console.log(lines.join("\n"));
