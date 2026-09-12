import type { SupabaseClient } from "@supabase/supabase-js";

import type { ClaimArenaInput, EquipArenaInput, PurchaseArenaInput, GodotAuthedRequestContext } from "../../contracts.js";
import { HttpModuleError } from "../../errors.js";
import { createServiceSupabaseClient } from "../../supabase.js";
import {
  createInitialGameSave,
  normalizeArenaCosmeticsState,
  normalizeGameSave,
  type GameSaveSnapshot,
} from "../bootstrap/game-save.js";
import { findArenaCatalogEntry, isPurchasableArena, publicArenaCatalog } from "./catalog.js";

type ArenaModule = "arena_cosmetics_status" | "arena_cosmetics_equip" | "arena_cosmetics_purchase" | "arena_cosmetics_claim";
interface PlayerSaveRow { save: unknown }
interface IdempotencyRow { operation: string; response: unknown }

export async function getArenaCosmeticsDedicated(context: GodotAuthedRequestContext): Promise<unknown> {
  const supabase = createServiceSupabaseClient();
  const save = await loadPlayerSave(supabase, context.userId);
  return buildResponse(save);
}

export async function equipArenaDedicated(context: GodotAuthedRequestContext, input: EquipArenaInput): Promise<unknown> {
  const supabase = createServiceSupabaseClient();
  const arenaId = normalizeArenaId(input.arenaId, "arena_cosmetics_equip");
  const entry = findArenaCatalogEntry(arenaId);
  if (!entry) {
    throw new HttpModuleError(404, "arena_not_found", "arena_cosmetics_equip", "La arena solicitada no esta disponible.");
  }
  const save = await loadPlayerSave(supabase, context.userId);
  if (!save.arenaCosmetics.ownedArenaIds.includes(arenaId)) {
    throw new HttpModuleError(403, "arena_not_owned", "arena_cosmetics_equip", "Debes obtener esta arena antes de equiparla.");
  }
  const replay = await beginIdempotentOperation(supabase, context.userId, `equip_arena_v1:${arenaId}`, input.requestId, "arena_cosmetics_equip");
  if (replay.status === "replayed") return requireCompletedReplay(replay.response, "arena_cosmetics_equip");
  save.arenaCosmetics.equippedArenaId = arenaId;
  await persistSave(supabase, context.userId, save, false);
  const response = { ...buildResponse(save), action: "equip", arenaId };
  await completeIdempotentOperation(supabase, context.userId, input.requestId, response);
  return response;
}

export async function purchaseArenaDedicated(context: GodotAuthedRequestContext, input: PurchaseArenaInput): Promise<unknown> {
  const supabase = createServiceSupabaseClient();
  const arenaId = normalizeArenaId(input.arenaId, "arena_cosmetics_purchase");
  const entry = findArenaCatalogEntry(arenaId);
  if (!entry || !isArenaAvailable(entry, new Date())) {
    throw new HttpModuleError(404, "arena_not_found", "arena_cosmetics_purchase", "La arena solicitada no esta disponible.");
  }
  if (!isPurchasableArena(entry)) {
    throw new HttpModuleError(409, "arena_not_purchasable", "arena_cosmetics_purchase", "Esta arena se obtiene mediante otra fuente.");
  }
  const save = await loadPlayerSave(supabase, context.userId);
  const currency: "gold" | "gems" = entry.acquisitionType === "gold" ? "gold" : "gems";
  if (!save.arenaCosmetics.ownedArenaIds.includes(arenaId) && save[currency] < entry.price) {
    throw new HttpModuleError(409, "insufficient_currency", "arena_cosmetics_purchase", `No tienes suficiente ${currency}.`);
  }
  const replay = await beginIdempotentOperation(supabase, context.userId, `purchase_arena_v1:${arenaId}`, input.requestId, "arena_cosmetics_purchase");
  if (replay.status === "replayed") return requireCompletedReplay(replay.response, "arena_cosmetics_purchase");
  if (save.arenaCosmetics.ownedArenaIds.includes(arenaId)) {
    const response = { ...buildResponse(save), action: "purchase", arenaId, alreadyOwned: true };
    await completeIdempotentOperation(supabase, context.userId, input.requestId, response);
    return response;
  }
  save[currency] -= entry.price;
  save.arenaCosmetics.ownedArenaIds.push(arenaId);
  save.arenaCosmetics = normalizeArenaCosmeticsState(save.arenaCosmetics);
  await persistSave(supabase, context.userId, save, true);
  const response = { ...buildResponse(save), action: "purchase", arenaId, alreadyOwned: false, charged: { currency, amount: entry.price } };
  await completeIdempotentOperation(supabase, context.userId, input.requestId, response);
  return response;
}

export async function claimArenaDedicated(context: GodotAuthedRequestContext, input: ClaimArenaInput): Promise<unknown> {
  const supabase = createServiceSupabaseClient();
  const arenaId = normalizeArenaId(input.arenaId, "arena_cosmetics_claim");
  const entry = findArenaCatalogEntry(arenaId);
  if (!entry) {
    throw new HttpModuleError(404, "arena_not_found", "arena_cosmetics_claim", "La arena solicitada no existe.");
  }
  if (!["chapter", "event", "season"].includes(entry.acquisitionType)) {
    throw new HttpModuleError(409, "arena_not_claimable", "arena_cosmetics_claim", "Esta arena se obtiene mediante otra fuente.");
  }
  const save = await loadPlayerSave(supabase, context.userId);
  const status = arenaEntitlementStatus(entry, save, new Date());
  if (!status.available) {
    throw new HttpModuleError(409, "arena_not_available", "arena_cosmetics_claim", "Esta recompensa no se encuentra activa.");
  }
  if (!status.eligible) {
    throw new HttpModuleError(409, "arena_requirement_not_met", "arena_cosmetics_claim", status.reason);
  }
  const replay = await beginIdempotentOperation(supabase, context.userId, `claim_arena_v1:${arenaId}`, input.requestId, "arena_cosmetics_claim");
  if (replay.status === "replayed") return requireCompletedReplay(replay.response, "arena_cosmetics_claim");
  const alreadyOwned = save.arenaCosmetics.ownedArenaIds.includes(arenaId);
  if (!alreadyOwned) {
    save.arenaCosmetics.ownedArenaIds.push(arenaId);
    save.arenaCosmetics = normalizeArenaCosmeticsState(save.arenaCosmetics);
    await persistSave(supabase, context.userId, save, false);
  }
  const response = { ...buildResponse(save), action: "claim", arenaId, alreadyOwned };
  await completeIdempotentOperation(supabase, context.userId, input.requestId, response);
  return response;
}

function buildResponse(save: GameSaveSnapshot, now = new Date()) {
  const state = normalizeArenaCosmeticsState(save.arenaCosmetics);
  return {
    ok: true as const,
    arenaCosmetics: state,
    catalog: publicArenaCatalog().map((entry) => {
      const entitlement = arenaEntitlementStatus(entry, save, now);
      const owned = state.ownedArenaIds.includes(entry.id);
      return {
        ...entry,
        ...entitlement,
        claimable: !owned && entitlement.available && entitlement.eligible && ["chapter", "event", "season"].includes(entry.acquisitionType),
        owned,
        equipped: state.equippedArenaId === entry.id,
      };
    }),
    balances: { gold: save.gold, gems: save.gems },
  };
}

function isArenaAvailable(entry: ReturnType<typeof publicArenaCatalog>[number], now: Date): boolean {
  if (!entry.available) return false;
  const timestamp = now.getTime();
  if (entry.availableFrom && timestamp < Date.parse(entry.availableFrom)) return false;
  if (entry.availableUntil && timestamp >= Date.parse(entry.availableUntil)) return false;
  return true;
}

function arenaEntitlementStatus(entry: ReturnType<typeof publicArenaCatalog>[number], save: GameSaveSnapshot, now: Date) {
  const available = isArenaAvailable(entry, now);
  const target = Math.max(0, Math.floor(entry.requirementTarget ?? 0));
  let progress = 0;
  let eligible = ["free", "gold", "gems"].includes(entry.acquisitionType);
  if (entry.acquisitionType === "chapter") {
    progress = campaignStageProgress(save.highestStage, entry.requirementId ?? "world_1_stage_1");
    eligible = progress >= target;
  } else if (entry.acquisitionType === "event" || entry.acquisitionType === "season") {
    progress = Math.max(0, Math.floor(save.totalBattlesWon));
    eligible = progress >= target;
  }
  const reason = !available
    ? "La recompensa esta fuera de su periodo de disponibilidad."
    : eligible
      ? "Requisito completado."
      : `${entry.requirementLabel ?? "Requisito pendiente"} (${Math.min(progress, target)}/${target}).`;
  return { available, eligible, progress, target, reason };
}

function campaignStageProgress(highestStage: string, requirementId: string): number {
  const highest = /^world_(\d+)_stage_(\d+)$/i.exec(highestStage);
  const required = /^world_(\d+)_stage_(\d+)$/i.exec(requirementId);
  if (!highest || !required) return 0;
  const highestWorld = Number(highest[1]);
  const requiredWorld = Number(required[1]);
  if (highestWorld > requiredWorld) return Number(required[2]);
  if (highestWorld < requiredWorld) return 0;
  return Math.min(Number(highest[2]), Number(required[2]));
}

function normalizeArenaId(value: string, module: ArenaModule): string {
  const arenaId = value.trim().toLowerCase();
  if (!/^[a-z0-9_]{1,64}$/.test(arenaId)) {
    throw new HttpModuleError(400, "invalid_arena_id", module, "arenaId invalido.");
  }
  return arenaId;
}

async function loadPlayerSave(supabase: SupabaseClient, userId: string): Promise<GameSaveSnapshot> {
  const { data, error } = await supabase.from("player_saves").select("save").eq("user_id", userId).maybeSingle<PlayerSaveRow>();
  if (error) throw new Error(error.message);
  return normalizeGameSave(data?.save ?? createInitialGameSave());
}

async function persistSave(supabase: SupabaseClient, userId: string, save: GameSaveSnapshot, syncEconomy: boolean) {
  const updatedAt = new Date().toISOString();
  const { error } = await supabase.from("player_saves").upsert({ user_id: userId, save, save_version: save.schemaVersion, updated_at: updatedAt }, { onConflict: "user_id" });
  if (error) throw new Error(error.message);
  if (!syncEconomy) return;
  const { error: economyError } = await supabase.from("user_economy").upsert({ user_id: userId, gold: save.gold, gems: save.gems, updated_at: updatedAt }, { onConflict: "user_id" });
  if (economyError) throw new Error(economyError.message);
}

async function beginIdempotentOperation(supabase: SupabaseClient, userId: string, operation: string, requestId: string, module: ArenaModule) {
  assertRequestId(requestId, module);
  const { error: insertError } = await supabase.from("idempotency_keys").insert({ user_id: userId, request_id: requestId, operation });
  if (!insertError) return { status: "started" as const, response: null as unknown };
  const { data, error } = await supabase.from("idempotency_keys").select("operation, response").eq("user_id", userId).eq("request_id", requestId).maybeSingle<IdempotencyRow>();
  if (error || !data) throw new Error(insertError.message);
  if (data.operation !== operation) throw new HttpModuleError(400, "request_id_reused", module, "requestId ya fue utilizado para otra operacion.");
  return { status: "replayed" as const, response: data.response };
}

async function completeIdempotentOperation(supabase: SupabaseClient, userId: string, requestId: string, response: unknown) {
  const { error } = await supabase.from("idempotency_keys").update({ response }).eq("user_id", userId).eq("request_id", requestId);
  if (error) throw new Error(error.message);
}

function assertRequestId(requestId: string, module: ArenaModule) {
  if (!/^[a-zA-Z0-9_-]{8,80}$/.test(requestId.trim())) {
    throw new HttpModuleError(400, "invalid_request_id", module, "requestId invalido.");
  }
}

function requireCompletedReplay(response: unknown, module: ArenaModule): unknown {
  if (response == null) throw new HttpModuleError(409, "operation_in_progress", module, "La operacion todavia esta procesandose.");
  return response;
}
