import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { appendServerActionFields } from "./server-action";

const backend = JSON.parse(readFileSync(".local/test-backend.json", "utf8"));
if (backend.API_URL !== "http://127.0.0.1:55421")
  throw new Error("Tests require isolated local Supabase");
const admin = createClient(backend.API_URL, backend.SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
const base = "http://localhost:3107";
const marker = randomUUID().slice(0, 8);
const email = `inventory-${marker}@example.test`;
const password = randomUUID() + "Aa9!";
const ids: Record<string, string> = {};
let cookies = "";

function day(offset: number) {
  return new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
}

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
      .map((entry) => {
        const index = entry.indexOf("=");
        return [entry.slice(0, index), entry.slice(index + 1)];
      }),
  );
  for (const item of response.headers.getSetCookie()) {
    const pair = item.split(";")[0];
    const index = pair.indexOf("=");
    jar.set(pair.slice(0, index), pair.slice(index + 1));
  }
  cookies = [...jar].map(([key, value]) => `${key}=${value}`).join("; ");
  return response;
}

async function submit(
  html: string,
  markerName: string,
  values: Record<string, string>,
  expected = 200,
) {
  const body = new FormData();
  appendServerActionFields(body, html, markerName);
  Object.entries(values).forEach(([key, value]) => body.set(key, value));
  expect(
    (
      await request("/app/inventory", {
        method: "POST",
        headers: { origin: base },
        body,
      })
    ).status,
  ).toBe(expected);
}

describe.sequential("transactional inventory workflow", () => {
  beforeAll(async () => {
    const team = await admin
      .from("organizations")
      .insert({ name: "Synthetic inventory test", slug: `inventory-${marker}` })
      .select("id")
      .single();
    if (team.error) throw team.error;
    ids.team = team.data.id;
    const account = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (account.error) throw account.error;
    ids.user = account.data.user.id;
    const profile = await admin
      .from("profiles")
      .insert({ user_id: ids.user, organization_id: ids.team, role: "user" })
      .select("id")
      .single();
    if (profile.error) throw profile.error;
    ids.profile = profile.data.id;
    expect(
      (
        await request("/auth/login", {
          method: "POST",
          headers: { origin: base },
          body: new URLSearchParams({ email, password }),
        })
      ).status,
    ).toBe(303);
  }, 30000);
  afterAll(async () => {
    if (ids.user) await admin.auth.admin.deleteUser(ids.user);
    if (ids.team) await admin.from("organizations").delete().eq("id", ids.team);
  });

  it("creates a real team-owned inventory item", async () => {
    const html = await (await request("/app/inventory")).text();
    await submit(html, "inventory-item", {
      organization_id: ids.team,
      category: "reagent",
      name: `Synthetic reagent ${marker}`,
      cas_number: `CAS-${marker}`,
      supplier_reference: `SUP-${marker}`,
      default_unit: "g",
      minimum_stock: "80",
      storage_requirements: "Synthetic cabinet",
    });
    const result = await admin
      .from("inventory_items")
      .select("id,minimum_stock")
      .eq("organization_id", ids.team)
      .single();
    if (result.error) throw result.error;
    ids.item = result.data.id;
    expect(Number(result.data.minimum_stock)).toBe(80);
  });

  it("creates a lot and records its initial stock as a receipt", async () => {
    const html = await (await request("/app/inventory")).text();
    await submit(html, "inventory-lot", {
      inventory_item_id: ids.item,
      batch_number: `LOT-${marker}`,
      received_at: day(-1),
      expiration_date: day(14),
      quantity: "100",
      storage_location: "A-1",
    });
    const lot = await admin
      .from("inventory_lots")
      .select("id,initial_quantity,current_quantity")
      .eq("inventory_item_id", ids.item)
      .single();
    if (lot.error) throw lot.error;
    ids.lot = lot.data.id;
    expect(Number(lot.data.initial_quantity)).toBe(0);
    expect(Number(lot.data.current_quantity)).toBe(100);
    const movements = await admin
      .from("inventory_movements")
      .select("movement_type,quantity,performed_by")
      .eq("inventory_lot_id", ids.lot);
    expect(movements.data).toHaveLength(1);
    expect(movements.data?.[0]).toMatchObject({
      movement_type: "receipt",
      performed_by: ids.profile,
    });
  });

  it("records consumption and derives low-stock and expiry state", async () => {
    const html = await (await request("/app/inventory")).text();
    await submit(html, "inventory-movement", {
      inventory_lot_id: ids.lot,
      movement_type: "consumption",
      quantity: "30",
      movement_date: day(0),
      reason: "Synthetic assay",
      notes: "fixture",
    });
    expect(
      Number(
        (
          await admin
            .from("inventory_lots")
            .select("current_quantity")
            .eq("id", ids.lot)
            .single()
        ).data?.current_quantity,
      ),
    ).toBe(70);
    const status = await admin
      .from("inventory_lot_status")
      .select("alert_level")
      .eq("inventory_lot_id", ids.lot)
      .single();
    if (status.error) throw status.error;
    expect(status.data.alert_level).toBe("urgent");
    const rendered = await (
      await request(`/app/inventory?q=CAS-${marker}`)
    ).text();
    expect(rendered).toContain(`LOT-${marker}`);
    expect(rendered).toContain("urgent");
    expect(rendered).toContain("consumption");
    expect(
      await (await request(`/app/inventory?q=LOT-${marker}`)).text(),
    ).toContain(`Synthetic reagent ${marker}`);
    expect(await (await request("/app/inventory?q=A-1")).text()).toContain(
      `LOT-${marker}`,
    );
  });

  it("requires adjustment justification and prevents negative stock atomically", async () => {
    let html = await (await request("/app/inventory")).text();
    await submit(
      html,
      "inventory-movement",
      {
        inventory_lot_id: ids.lot,
        movement_type: "negative_adjustment",
        quantity: "1",
        movement_date: day(0),
        reason: "",
        notes: "",
      },
      200,
    );
    html = await (await request("/app/inventory")).text();
    await submit(
      html,
      "inventory-movement",
      {
        inventory_lot_id: ids.lot,
        movement_type: "consumption",
        quantity: "1000",
        movement_date: day(0),
        reason: "Synthetic invalid",
        notes: "",
      },
      200,
    );
    expect(
      Number(
        (
          await admin
            .from("inventory_lots")
            .select("current_quantity")
            .eq("id", ids.lot)
            .single()
        ).data?.current_quantity,
      ),
    ).toBe(70);
    expect(
      (
        await admin
          .from("inventory_movements")
          .select("id", { count: "exact", head: true })
          .eq("inventory_lot_id", ids.lot)
      ).count,
    ).toBe(2);
  });
});
