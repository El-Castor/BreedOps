"use server";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireIdentity } from "@/lib/auth";

export async function changePassword(form: FormData) {
  const { client } = await requireIdentity();
  const values = z
    .object({ password: z.string().min(8).max(1024), confirmation: z.string() })
    .parse({
      password: form.get("password"),
      confirmation: form.get("confirmation"),
    });
  if (values.password !== values.confirmation)
    redirect("/app/profile?error=mismatch");
  const { error } = await client.auth.updateUser({ password: values.password });
  redirect(
    error ? "/app/profile?error=unexpected" : "/app/profile?success=password",
  );
}
