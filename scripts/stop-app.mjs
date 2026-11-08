// Stops the app process scripts/start-app.mjs started for the current
// profile. Signals the whole process group (negative PID) since `npm run
// start` spawns `next start` as a child of npm itself - a plain
// kill(pid) can leave the actual server process orphaned and holding the
// port. Never errors if nothing is running: this must be safe to call
// unconditionally from a `finally` block.
import { existsSync, readFileSync, rmSync } from "node:fs";
import { currentProfile } from "./lib/stack-identity.mjs";

const profile = currentProfile();
if (!existsSync(profile.appPidFile)) {
  console.log(`No app PID file for profile "${profile.name}" - nothing to stop.`);
  process.exit(0);
}

const pid = Number(readFileSync(profile.appPidFile, "utf8").trim());
try {
  process.kill(-pid, "SIGTERM");
  console.log(`Stopped app process group ${pid} (profile "${profile.name}").`);
} catch {
  try {
    process.kill(pid, "SIGTERM");
    console.log(`Stopped app process ${pid} (profile "${profile.name}").`);
  } catch (error) {
    console.log(`App process ${pid} was not running (${error.message}).`);
  }
}
rmSync(profile.appPidFile, { force: true });
