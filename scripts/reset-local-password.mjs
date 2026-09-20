import { readFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { createClient } from "@supabase/supabase-js";
import { readSecret } from "./lib/read-secret.mjs";

if (!stdin.isTTY) throw new Error("Run this command in an interactive local terminal.");
const backend = JSON.parse(readFileSync(".local/test-backend.json", "utf8"));
if (backend.API_URL !== "http://127.0.0.1:55421") throw new Error("Only the isolated local BreedOps backend is supported.");
const prompt = createInterface({ input: stdin, output: stdout });
let email;
try { email = (await prompt.question("Administrator email: ")).trim().toLowerCase(); }
finally { prompt.close(); }
if (!/^\S+@\S+\.\S+$/.test(email)) throw new Error("Invalid email.");
const password = await readSecret("New password (input hidden): ");
if (password.length < 8) throw new Error("Invalid password: minimum 8 characters.");
const admin = createClient(backend.API_URL, backend.SERVICE_ROLE_KEY, { auth: { persistSession: false } });
let user;
for (let page = 1; page <= 100 && !user; page += 1) {
  const result = await admin.auth.admin.listUsers({ page, perPage: 100 });
  if (result.error) throw result.error;
  user = result.data.users.find((candidate) => candidate.email?.toLowerCase() === email);
  if (result.data.users.length < 100) break;
}
if (!user) throw new Error("Administrator account not found.");
const profileResult = await admin.from("profiles").select("role,is_active,deleted_at").eq("user_id", user.id).maybeSingle();
if (profileResult.error) throw profileResult.error;
const profile = profileResult.data;
if (!profile || profile.role !== "system_admin" || !profile.is_active || profile.deleted_at)
  throw new Error("The account is not an active local system administrator.");
const updated = await admin.auth.admin.updateUserById(user.id, { password, email_confirm: true });
if (updated.error) throw updated.error;
const authClient = createClient(backend.API_URL, backend.ANON_KEY, { auth: { persistSession: false } });
const verification = await authClient.auth.signInWithPassword({ email, password });
if (verification.error || verification.data.user?.id !== user.id) throw new Error("Updated credential verification failed.");
await authClient.auth.signOut();
stdout.write("Admin password updated successfully.\n");
