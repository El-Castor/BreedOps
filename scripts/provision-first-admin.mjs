import { readFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { createClient } from "@supabase/supabase-js";

if (!stdin.isTTY)
  throw new Error("Run this command in an interactive local terminal.");
const backend = JSON.parse(readFileSync(".local/test-backend.json", "utf8"));
if (backend.API_URL !== "http://127.0.0.1:55421")
  throw new Error("Only the isolated local BreedOps backend is supported.");
const prompt = createInterface({ input: stdin, output: stdout });
const email = (await prompt.question("Administrator email: ")).trim();
const displayName = (await prompt.question("Display name: ")).trim();
const teamName = (await prompt.question("First team name: ")).trim();
const teamSlugInput = (
  await prompt.question("First team slug (lowercase, for example nad): ")
).trim();
const teamSlug = teamSlugInput.toLowerCase();
stdout.write("Password (input hidden): ");
stdin.setRawMode(true);
let password = "";
for await (const chunk of stdin) {
  const value = String(chunk);
  if (value === "\r" || value === "\n") break;
  if (value === "\u0003") process.exit(130);
  if (value === "\u007f") password = password.slice(0, -1);
  else password += value;
}
stdin.setRawMode(false);
stdout.write("\n");
prompt.close();

const invalid = [];
if (!/^\S+@\S+\.\S+$/.test(email)) invalid.push("administrator email");
if (displayName.length < 1) invalid.push("display name");
if (teamName.length < 1) invalid.push("team name");
if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(teamSlug))
  invalid.push("team slug (use lowercase letters, digits, and single hyphens)");
if (password.length < 8) invalid.push("password (minimum 8 characters)");
if (invalid.length) throw new Error(`Invalid input: ${invalid.join(", ")}.`);
if (teamSlugInput !== teamSlug)
  stdout.write(`Using normalized team slug: ${teamSlug}\n`);
const admin = createClient(backend.API_URL, backend.SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
const { data: team, error: teamError } = await admin
  .from("organizations")
  .insert({ name: teamName, slug: teamSlug })
  .select("id")
  .single();
if (teamError) throw teamError;
let userId;
try {
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error) throw error;
  userId = data.user.id;
  const { error: profileError } = await admin
    .from("profiles")
    .insert({
      user_id: userId,
      organization_id: team.id,
      role: "system_admin",
      display_name: displayName,
    });
  if (profileError) throw profileError;
  stdout.write("First local system administrator provisioned.\n");
} catch (error) {
  if (userId) await admin.auth.admin.deleteUser(userId);
  await admin.from("organizations").delete().eq("id", team.id);
  throw error;
}
