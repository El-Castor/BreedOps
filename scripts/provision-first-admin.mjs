import { readFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { createClient } from "@supabase/supabase-js";
import { readSecret } from "./lib/read-secret.mjs";

if (!stdin.isTTY) throw new Error("Run this command in an interactive local terminal.");
const backend = JSON.parse(readFileSync(".local/test-backend.json", "utf8"));
if (backend.API_URL !== "http://127.0.0.1:55421")
  throw new Error("Only the isolated local BreedOps backend is supported.");
const admin = createClient(backend.API_URL, backend.SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const authClient = createClient(backend.API_URL, backend.ANON_KEY, { auth: { persistSession: false } });

async function ask(questions) {
  const prompt = createInterface({ input: stdin, output: stdout });
  try {
    const answers = [];
    for (const question of questions) answers.push((await prompt.question(question)).trim());
    return answers;
  } finally { prompt.close(); }
}

async function findAuthUser(email) {
  for (let page = 1; page <= 100; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 100 });
    if (error) throw error;
    const found = data.users.find((user) => user.email?.toLowerCase() === email);
    if (found || data.users.length < 100) return found;
  }
  throw new Error("Too many local users to search safely.");
}

async function getOrCreateTeam(name, slug) {
  const existing = await admin.from("organizations").select("id").eq("slug", slug).maybeSingle();
  if (existing.error) throw existing.error;
  if (existing.data) return { team: existing.data, created: false };
  const created = await admin.from("organizations").insert({ name, slug }).select("id").single();
  if (created.error) throw created.error;
  return { team: created.data, created: true };
}

const [emailInput] = await ask(["Administrator email: "]);
const email = emailInput.toLowerCase();
if (!/^\S+@\S+\.\S+$/.test(email)) throw new Error("Invalid administrator email.");
const existingUser = await findAuthUser(email);
if (existingUser) {
  const profileResult = await admin.from("profiles").select("id,organization_id,role,is_active,deleted_at").eq("user_id", existingUser.id).maybeSingle();
  if (profileResult.error) throw profileResult.error;
  if (profileResult.data) {
    const profile = profileResult.data;
    if (profile.role !== "system_admin" || !profile.is_active || profile.deleted_at || !profile.organization_id)
      throw new Error("The existing account has a conflicting profile; repair it through authorized user administration.");
    stdout.write("Administrator already provisioned. Use npm run local:reset-password to change the password.\n");
    process.exit(0);
  }
  const [displayName, teamName, rawSlug] = await ask(["Display name: ", "First team name: ", "First team slug (lowercase, for example nad): "]);
  const teamSlug = rawSlug.toLowerCase();
  if (!displayName || !teamName || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(teamSlug))
    throw new Error("Invalid display name, team name, or team slug.");
  const { team } = await getOrCreateTeam(teamName, teamSlug);
  const { error } = await admin.from("profiles").insert({ user_id: existingUser.id, organization_id: team.id, role: "system_admin", display_name: displayName, is_active: true });
  if (error) throw error;
  stdout.write("Missing administrator profile repaired.\n");
  process.exit(0);
}

const [displayName, teamName, rawSlug] = await ask(["Display name: ", "First team name: ", "First team slug (lowercase, for example nad): "]);
const teamSlug = rawSlug.toLowerCase();
const password = await readSecret("Password (input hidden): ");
const invalid = [];
if (!displayName) invalid.push("display name");
if (!teamName) invalid.push("team name");
if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(teamSlug)) invalid.push("team slug");
if (password.length < 8) invalid.push("password (minimum 8 characters)");
if (invalid.length) throw new Error(`Invalid input: ${invalid.join(", ")}.`);

let team;
let teamCreated = false;
let userId;
try {
  const result = await getOrCreateTeam(teamName, teamSlug);
  team = result.team;
  teamCreated = result.created;
  const createdUser = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (createdUser.error) throw createdUser.error;
  userId = createdUser.data.user.id;
  const profile = await admin.from("profiles").insert({ user_id: userId, organization_id: team.id, role: "system_admin", display_name: displayName, is_active: true });
  if (profile.error) throw profile.error;
  const verification = await authClient.auth.signInWithPassword({ email, password });
  if (verification.error || verification.data.user?.id !== userId) throw new Error("Administrator credential verification failed.");
  await authClient.auth.signOut();
  stdout.write("First local system administrator provisioned and verified.\n");
} catch (error) {
  if (userId) await admin.auth.admin.deleteUser(userId);
  if (teamCreated && team) await admin.from("organizations").delete().eq("id", team.id);
  throw error;
}
