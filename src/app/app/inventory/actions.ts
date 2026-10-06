"use server";

import { z } from "zod";
import { requireIdentity } from "@/lib/auth";
import {
  actionError,
  actionSuccess,
  type ActionState,
} from "@/lib/action-state";

const id = z.string().uuid();
const optionalDate = z.string().date().or(z.literal(""));

export async function createInventoryItem(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  try {
    const values = z
      .object({
        organization_id: id,
        category: z.string().trim().min(1).max(80),
        name: z.string().trim().min(1).max(160),
        cas_number: z.string().trim().max(80),
        supplier_reference: z.string().trim().max(120),
        default_unit: z.string().trim().min(1).max(30),
        minimum_stock: z.coerce.number().nonnegative(),
        storage_requirements: z.string().trim().max(300),
      })
      .parse(Object.fromEntries(form));
    const { client, team } = await requireIdentity();
    if (team.id !== values.organization_id) throw new Error("Équipe invalide.");
    const { error } = await client.from("inventory_items").insert({
      ...values,
      cas_number: values.cas_number || null,
      supplier_reference: values.supplier_reference || null,
      storage_requirements: values.storage_requirements || null,
    });
    if (error) throw new Error("Création de l’article refusée.");
    return actionSuccess(
      "Article créé. Vous pouvez maintenant réceptionner un lot.",
    );
  } catch (error) {
    return actionError(error, "Impossible de créer cet article.");
  }
}

export async function createInventoryLot(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  try {
    const values = z
      .object({
        inventory_item_id: id,
        batch_number: z.string().trim().min(1).max(120),
        received_at: z.string().date(),
        expiration_date: optionalDate,
        quantity: z.coerce.number().positive(),
        storage_location: z.string().trim().max(160),
      })
      .parse(Object.fromEntries(form));
    const { client } = await requireIdentity();
    const { error } = await client.rpc("create_inventory_lot_with_receipt", {
      target_item_id: values.inventory_item_id,
      target_batch_number: values.batch_number,
      target_received_at: values.received_at,
      target_expiration_date: values.expiration_date || null,
      target_quantity: values.quantity,
      target_location: values.storage_location,
      target_reason: "Initial reception",
    });
    if (error) throw new Error("Création du lot refusée.");
    return actionSuccess(
      "Lot créé et réception enregistrée dans le registre des mouvements.",
    );
  } catch (error) {
    return actionError(error, "Impossible de créer et réceptionner ce lot.");
  }
}

export async function recordInventoryMovement(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  try {
    const values = z
      .object({
        inventory_lot_id: id,
        movement_type: z.enum([
          "receipt",
          "consumption",
          "positive_adjustment",
          "negative_adjustment",
          "return",
          "destruction",
        ]),
        quantity: z.coerce.number().positive(),
        movement_date: z.string().date(),
        reason: z.string().trim().max(300),
        notes: z.string().trim().max(500),
      })
      .superRefine((value, context) => {
        if (value.movement_type.includes("adjustment") && !value.reason) {
          context.addIssue({
            code: "custom",
            path: ["reason"],
            message: "required",
          });
        }
      })
      .parse(Object.fromEntries(form));
    const { client } = await requireIdentity();
    const { error } = await client.rpc("record_inventory_movement", {
      target_lot_id: values.inventory_lot_id,
      target_movement_type: values.movement_type,
      target_quantity: values.quantity,
      target_date: values.movement_date,
      target_reason: values.reason,
      target_notes: values.notes,
    });
    if (error)
      throw new Error(
        "Mouvement refusé. Vérifiez le stock et la justification.",
      );
    return actionSuccess("Mouvement enregistré et stock recalculé.");
  } catch (error) {
    return actionError(
      error,
      "Mouvement refusé. Vérifiez le stock et la justification.",
    );
  }
}
