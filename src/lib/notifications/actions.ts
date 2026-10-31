"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireIdentity } from "@/lib/auth";
import { safeNextPath } from "@/lib/safe-next-path";

// Marks a notification read and, in one round trip, navigates to its
// target page - the same open-redirect-safe validation already used for
// the post-login "next" destination (src/lib/safe-next-path.ts) is reused
// here rather than trusting the posted "next" field directly.
export async function markNotificationRead(form: FormData) {
  const { client } = await requireIdentity();
  const id = z.string().uuid().parse(form.get("id"));
  // mark_notification_read itself re-checks ownership (recipient_profile_id
  // = current_profile_id()) - this is never trusted from the form alone.
  await client.rpc("mark_notification_read", { target_id: id });
  const next = form.get("next");
  if (next) redirect(safeNextPath(next));
  revalidatePath("/app", "layout");
}

export async function markAllNotificationsRead() {
  const { client } = await requireIdentity();
  await client.rpc("mark_all_notifications_read");
  revalidatePath("/app", "layout");
}
