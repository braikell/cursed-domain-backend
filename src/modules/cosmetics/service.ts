import type { SupabaseClient } from "@supabase/supabase-js";
import type { GodotAuthedRequestContext, CosmeticMutationInput, BackendModuleName } from "../../contracts.js";
import { createServiceSupabaseClient } from "../../supabase.js";
import { HttpModuleError } from "../../errors.js";

export function isCosmeticsMigrationMissing(error: { code?: string; message?: string }): boolean {
 return ["42P01","42883","PGRST202","PGRST205"].includes(error.code ?? "") &&
 /cosmetic|cosmetics/i.test(error.message ?? "");
}
export async function getCosmeticsDedicated(context: GodotAuthedRequestContext, optional = false): Promise<Record<string, unknown>> {
 const { data, error } = await createServiceSupabaseClient().rpc("get_player_cosmetics_v1", { p_user_id: context.userId });
 if (error) {
  if (optional && isCosmeticsMigrationMissing(error)) return { ok: false, available: false, cosmetics: { ownedIds: [], equipped: {} }, catalog: [] };
  throw new HttpModuleError(503, "cosmetics_unavailable", "cosmetics_status", "Los decorativos no están disponibles. Inténtalo de nuevo.");
 }
 return data as Record<string, unknown>;
}
export async function mutateCosmeticsDedicated(context: GodotAuthedRequestContext, action: "purchase" | "equip" | "unequip", input: CosmeticMutationInput): Promise<unknown> {
 const module = ("cosmetics_" + action) as BackendModuleName;
 const { data, error } = await createServiceSupabaseClient().rpc("mutate_player_cosmetics_v1", {
  p_user_id: context.userId, p_request_id: input.requestId, p_action: action,
  p_cosmetic_id: input.cosmeticId ?? "", p_category: input.category ?? "frame", p_offer_version: input.offerVersion ?? "",
 });
 if (error) throw new HttpModuleError(503, "cosmetics_unavailable", module, "No se pudo confirmar la operación. Reintenta con el mismo identificador.");
 if (!data?.ok) {
  const code = String(data?.code ?? "cosmetics_unavailable");
  const status = code === "cosmetic_not_owned" ? 403 : code === "cosmetic_not_found" ? 404 : code === "invalid_request" || code === "request_id_reused" ? 400 : 409;
  throw new HttpModuleError(status, code, module, String(data?.message ?? "No se pudo actualizar el decorativo."));
 }
 return data;
}

/** One batched query per page. No private inventory, balances, receipt or arbitrary asset URL is exposed. */
export async function publicFrameIdentities(supabase: SupabaseClient, userIds: string[]): Promise<Map<string, { frameId: string; avatar?: { character_key: string; card_type: string } }>> {
 const ids = [...new Set(userIds)];
 if (!ids.length) return new Map();
 const { data, error } = await supabase.from("user_cosmetic_loadouts").select("user_id,cosmetic_id").eq("category","frame").in("user_id",ids);
 if (error) {
  if (isCosmeticsMigrationMissing(error)) return new Map();
  throw new Error(error.message);
 }

 const result = new Map<string, { frameId: string; avatar?: { character_key: string; card_type: string } }>(ids.map(id => [id,{frameId:""}]));
 for (const row of data ?? []) result.set(String(row.user_id),{frameId:String(row.cosmetic_id)});
 const profiles = await supabase.from("profiles").select("id,avatar_card_id").in("id",ids);
 if (profiles.error) {
  if (["42703","PGRST204"].includes(profiles.error.code ?? "")) return result;
  throw new Error(profiles.error.message);
 }
 const cardIds = [...new Set((profiles.data ?? []).map(row => row.avatar_card_id).filter((id): id is string => typeof id === "string" && /^[0-9a-f-]{36}$/i.test(id)))];
 if (!cardIds.length) return result;
 const cards = await supabase.from("user_cards").select("id,user_id,character_key,character_id,card_type,variant").in("id",cardIds).in("user_id",ids);
 if (cards.error) throw new Error(cards.error.message);
 for (const profile of profiles.data ?? []) {
  const card = (cards.data ?? []).find(row => row.id === profile.avatar_card_id && row.user_id === profile.id);
  const character = String(card?.character_key ?? card?.character_id ?? "");
  if (card && /^[a-z0-9_]{1,64}$/.test(character)) {
   result.set(String(profile.id),{...result.get(String(profile.id))!,avatar:{character_key:character,card_type:card.card_type === "DEFINITIVA" || card.variant === "definitive" ? "DEFINITIVA" : "BASE"}});
  }
 }
 return result;

}
