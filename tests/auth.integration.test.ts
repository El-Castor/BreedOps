import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const backend = JSON.parse(readFileSync(".local/test-backend.json", "utf8"));
if (backend.API_URL !== "http://127.0.0.1:55421")
  throw new Error("Tests require isolated local Supabase");
const admin = createClient(backend.API_URL, backend.SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
const base = "http://localhost:3107";
const email = `auth-${randomUUID()}@example.test`;
const password = randomUUID() + "Aa9!";
const teamId = randomUUID();
let userId: string | undefined;
let cookies = "";

async function request(path: string, options: RequestInit = {}) {
  const response = await fetch(base + path, {
    ...options,
    redirect: "manual",
    headers: { cookie: cookies, ...options.headers },
  });
  const jar = new Map(
    cookies
      .split("; ")
      .filter(Boolean)
      .map((x) => {
        const i = x.indexOf("=");
        return [x.slice(0, i), x.slice(i + 1)];
      }),
  );
  for (const item of response.headers.getSetCookie()) {
    const pair = item.split(";")[0];
    const i = pair.indexOf("=");
    jar.set(pair.slice(0, i), pair.slice(i + 1));
  }
  cookies = [...jar].map(([key, value]) => `${key}=${value}`).join("; ");
  return response;
}

describe.sequential("real Supabase authentication over HTTP", () => {
  beforeAll(async () => {
    const { error: teamError } = await admin.from("organizations").insert({
      id: teamId,
      name: "Synthetic auth test",
      slug: `test-${teamId}`,
    });
    if (teamError) throw teamError;
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (error) throw error;
    userId = data.user.id;
    const { error: profileError } = await admin
      .from("profiles")
      .insert({ user_id: userId, organization_id: teamId, role: "user" });
    if (profileError) throw profileError;
  }, 30000);
  afterAll(async () => {
    if (userId) {
      await admin.from("profiles").delete().eq("user_id", userId);
      await admin.auth.admin.deleteUser(userId);
    }
    await admin.from("organizations").delete().eq("id", teamId);
  });
  it("redirects anonymous protected requests", async () => {
    const response = await request("/app");
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toContain("/login");
  });
  it("rejects cross-origin login", async () => {
    expect(
      (
        await request("/auth/login", {
          method: "POST",
          headers: { origin: "https://attacker.example" },
        })
      ).status,
    ).toBe(403);
  });
  it("rejects invalid credentials", async () => {
    const response = await request("/auth/login", {
      method: "POST",
      headers: { origin: base },
      body: new URLSearchParams({ email, password: "incorrect" }),
    });
    expect(response.headers.get("location")).toContain("error=invalid");
  });
  it("logs in and stores an HttpOnly session", async () => {
    const response = await request("/auth/login", {
      method: "POST",
      headers: { origin: base },
      body: new URLSearchParams({ email, password }),
    });
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(base + "/app");
    expect(
      response.headers.getSetCookie().some((x) => /httponly/i.test(x)),
    ).toBe(true);
    expect(cookies).not.toBe("");
  });
  it("retains real identity on repeated page requests", async () => {
    for (let n = 0; n < 2; n++) {
      const response = await request("/app");
      expect(response.status).toBe(200);
      expect(await response.text()).toContain(email);
    }
  });
  it("persists an allowed profile Server Action", async () => {
    const html = await (await request("/app")).text();
    const form = html.match(
      /<form[^>]*>[\s\S]*?name="display_name"[\s\S]*?<\/form>/,
    )?.[0];
    const action = form?.match(/name="(\$ACTION_ID_[^"]+)"/)?.[1];
    expect(action).toBeTruthy();
    const body = new FormData();
    body.set(action!, "");
    body.set("display_name", "Synthetic updated profile");
    expect(
      (
        await request("/app", {
          method: "POST",
          headers: { origin: base },
          body,
        })
      ).status,
    ).toBe(200);
    const { data } = await admin
      .from("profiles")
      .select("display_name")
      .eq("user_id", userId!)
      .single();
    expect(data?.display_name).toBe("Synthetic updated profile");
  });
  it("authorizes team administration on the server and rejects stale admin forms after demotion", async () => {
    const { error } = await admin
      .from("profiles")
      .update({ role: "team_admin" })
      .eq("user_id", userId!);
    if (error) throw error;
    const html = await (await request("/app")).text();
    const form = [...html.matchAll(/<form[^>]*>[\s\S]*?<\/form>/g)]
      .map((x) => x[0])
      .find((x) => x.includes('name="name"'));
    const action = form?.match(/name="(\$ACTION_ID_[^"]+)"/)?.[1];
    expect(action).toBeTruthy();
    const body = new FormData();
    body.set(action!, "");
    body.set("name", "Synthetic renamed team");
    expect(
      (
        await request("/app", {
          method: "POST",
          headers: { origin: base },
          body,
        })
      ).status,
    ).toBe(200);
    const { error: demotionError } = await admin
      .from("profiles")
      .update({ role: "user" })
      .eq("user_id", userId!);
    if (demotionError) throw demotionError;
    body.set("name", "Forbidden team rename");
    expect(
      (
        await request("/app", {
          method: "POST",
          headers: { origin: base },
          body,
        })
      ).status,
    ).toBe(500);
    const { data } = await admin
      .from("organizations")
      .select("name")
      .eq("id", teamId)
      .single();
    expect(data?.name).toBe("Synthetic renamed team");
  });
  it("rejects membership revoked after login", async () => {
    const { error } = await admin
      .from("profiles")
      .update({ is_active: false })
      .eq("user_id", userId!);
    if (error) throw error;
    expect((await request("/app")).headers.get("location")).toContain(
      "membership",
    );
  });
  it("logs out and rejects the following protected request", async () => {
    expect(
      (
        await request("/auth/logout", {
          method: "POST",
          headers: { origin: base },
        })
      ).status,
    ).toBe(303);
    expect((await request("/app")).headers.get("location")).toContain("/login");
  });
});
