import { randomUUID } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  DismantleItemInput,
  EquipItemInput,
  GodotAuthedRequestContext,
  UnequipItemInput,
  UpgradeItemInput,
} from "../../contracts.js";
import { HttpModuleError } from "../../errors.js";
import { createServiceSupabaseClient } from "../../supabase.js";
import type { EquipmentItem, GameSaveSnapshot } from "../bootstrap/game-save.js";
import { createInitialGameSave, normalizeGameSave } from "../bootstrap/game-save.js";
import {
  buildEquipmentMaterialId,
  buildEquipmentStats,
  canUpgradeToTier,
  EQUIPMENT_DISMANTLE_YIELD_BY_RARITY,
  EQUIPMENT_ITEMS,
  EQUIPMENT_MAX_TIER_BY_RARITY,
  getUpgradeCostForTier,
  normalizeEquipmentRarity,
  normalizeEquipmentRarityForDatabase,
  normalizeEquipmentSlotForDatabase,
  type EquipmentDefinition,
  type EquipmentRarity,
  type EquipmentSlot,
} from "./balance.js";
import {
  ensureBootstrapMonetizationFoundation,
  ensureDailyMissionSnapshotState,
  getBootstrapMonetizationConfig,
  getUtcResetDate,
  updateDailyMissionProgress,
} from "../bootstrap/monetization-foundation.js";

interface PlayerSaveRow {
  save: GameSaveSnapshot;
}

interface UserCardRow {
  id: string;
  character_key: string | null;
  character_id: string;
  card_type: string | null;
  variant: string | null;
}

interface IdempotencyRow {
  operation: string;
  response: unknown | null;
}

const EQUIPMENT_DEFINITIONS_BY_KEY = new Map(EQUIPMENT_ITEMS.map((item) => [item.key, item]));

export async function getEquipmentDedicated(context: GodotAuthedRequestContext): Promise<unknown> {
  const supabase = createServiceSupabaseClient();
  await ensureBootstrapMonetizationFoundation(supabase, context.userId);
  await ensureDailyMissionSnapshotState(supabase, context.userId, await getBootstrapMonetizationConfig(supabase), getUtcResetDate());
  const save = await ensureEquipmentFoundation(supabase, context.userId);
  return await buildEquipmentResponse(supabase, context.userId, save);
}

export async function equipItemDedicated(
  context: GodotAuthedRequestContext,
  input: EquipItemInput,
): Promise<unknown> {
  const supabase = createServiceSupabaseClient();
  const operation = `equip_item_v1:${input.itemId}:${input.targetCharacterId ?? "auto"}`;
  const replay = await beginIdempotentOperation(supabase, context.userId, operation, input.requestId, "equipment_equip");
  if (replay.status === "replayed") {
    if (replay.response == null) {
      throw new HttpModuleError(409, "operation_in_progress", "equipment_equip", "El equipamiento todavia esta procesandose. Intenta otra vez en unos segundos.");
    }
    return replay.response;
  }

  const save = await ensureEquipmentFoundation(supabase, context.userId);
  const itemIndex = save.inventory.findIndex((item) => item.id === input.itemId);
  if (itemIndex < 0) {
    throw new HttpModuleError(404, "equipment_not_found", "equipment_equip", "Item de equipamiento no encontrado.");
  }

  const targetCharacterId = resolveTargetCharacterId(save, input.targetCharacterId);
  const item = save.inventory[itemIndex];
  if (item.equippedToCharacterId && item.equippedToCharacterId !== targetCharacterId) {
    throw new HttpModuleError(409, "equipment_already_equipped", "equipment_equip", "Este item ya esta equipado en otro heroe. Quitalo antes de usarlo en otra carta.");
  }

  for (const candidate of save.inventory) {
    if (candidate.slot === item.slot && candidate.equippedToCharacterId === targetCharacterId) {
      candidate.equippedToCharacterId = null;
    }
  }
  save.inventory[itemIndex] = {
    ...item,
    equippedToCharacterId: targetCharacterId,
  };

  syncCharacterEquipmentMaps(save);
  await persistEquipmentState(supabase, context.userId, save);
  const response = {
    ok: true,
    action: "equip",
    itemId: input.itemId,
    targetCharacterId,
    snapshot: await buildEquipmentResponse(supabase, context.userId, save),
  };
  await updateDailyMissionProgress(supabase, context.userId, await getBootstrapMonetizationConfig(supabase), "item_equipped_or_upgraded", 1);
  await completeIdempotentOperation(supabase, context.userId, input.requestId, response);
  return response;
}

export async function unequipItemDedicated(
  context: GodotAuthedRequestContext,
  input: UnequipItemInput,
): Promise<unknown> {
  const supabase = createServiceSupabaseClient();
  const operation = `unequip_item_v1:${input.itemId ?? "slot"}:${input.targetCharacterId ?? "any"}:${input.slot ?? "any"}:${input.clearAll ? "all" : "one"}`;
  const replay = await beginIdempotentOperation(supabase, context.userId, operation, input.requestId, "equipment_unequip");
  if (replay.status === "replayed") {
    if (replay.response == null) {
      throw new HttpModuleError(409, "operation_in_progress", "equipment_unequip", "El desequipado todavia esta procesandose. Intenta otra vez en unos segundos.");
    }
    return replay.response;
  }

  const save = await ensureEquipmentFoundation(supabase, context.userId);
  const targetCharacterId = input.targetCharacterId?.trim();
  const slot = input.slot?.trim();
  let changed = 0;

  for (const item of save.inventory) {
    if (input.clearAll) {
      if (targetCharacterId && item.equippedToCharacterId !== targetCharacterId) continue;
      if (item.equippedToCharacterId) {
        item.equippedToCharacterId = null;
        changed += 1;
      }
      continue;
    }

    if (input.itemId && item.id !== input.itemId) continue;
    if (!input.itemId && targetCharacterId && item.equippedToCharacterId !== targetCharacterId) continue;
    if (!input.itemId && slot && item.slot !== slot) continue;
    if (item.equippedToCharacterId) {
      item.equippedToCharacterId = null;
      changed += 1;
    }
    if (input.itemId) break;
  }

  if (!input.clearAll && changed === 0) {
    throw new HttpModuleError(404, "equipment_not_equipped", "equipment_unequip", "Item equipado no encontrado.");
  }

  syncCharacterEquipmentMaps(save);
  await persistEquipmentState(supabase, context.userId, save);
  const response = {
    ok: true,
    action: input.clearAll ? "unequip_all" : "unequip",
    itemId: input.itemId ?? null,
    targetCharacterId: targetCharacterId ?? null,
    slot: slot ?? null,
    changed,
    snapshot: await buildEquipmentResponse(supabase, context.userId, save),
  };
  await completeIdempotentOperation(supabase, context.userId, input.requestId, response);
  return response;
}

export async function upgradeItemDedicated(
  context: GodotAuthedRequestContext,
  input: UpgradeItemInput,
): Promise<unknown> {
  const supabase = createServiceSupabaseClient();
  const operation = `upgrade_item_v1:${input.itemId}`;
  const replay = await beginIdempotentOperation(supabase, context.userId, operation, input.requestId, "equipment_upgrade");
  if (replay.status === "replayed") {
    if (replay.response == null) {
      throw new HttpModuleError(409, "operation_in_progress", "equipment_upgrade", "La mejora del item todavia esta procesandose. Intenta otra vez en unos segundos.");
    }
    return replay.response;
  }

  const save = await ensureEquipmentFoundation(supabase, context.userId);
  const itemIndex = save.inventory.findIndex((item) => item.id === input.itemId);
  if (itemIndex < 0) {
    throw new HttpModuleError(404, "equipment_not_found", "equipment_upgrade", "Item de equipamiento no encontrado.");
  }

  const item = save.inventory[itemIndex];
  const rarity = normalizeEquipmentRarity(item.rarity);
  const currentTier = Math.max(1, Math.floor(item.tier ?? 1));
  const nextTier = currentTier + 1;
  if (!canUpgradeToTier(rarity, nextTier)) {
    throw new HttpModuleError(409, "equipment_max_tier_reached", "equipment_upgrade", "El item ya alcanzo su tier maximo.");
  }

  const cost = getUpgradeCostForTier(currentTier);
  if (cost == null) {
    throw new HttpModuleError(400, "equipment_invalid_tier", "equipment_upgrade", "Tier actual invalido para mejorar.");
  }

  const materialId = buildEquipmentMaterialId(item.slot as EquipmentSlot);
  const availableMaterials = Math.max(0, save.fragments[materialId] ?? 0);
  if (availableMaterials < cost.materials) {
    throw new HttpModuleError(409, "equipment_not_enough_materials", "equipment_upgrade", "No hay suficientes materiales para mejorar este item.");
  }
  if (save.gold < cost.gold) {
    throw new HttpModuleError(409, "equipment_not_enough_gold", "equipment_upgrade", "No hay suficiente oro para mejorar este item.");
  }

  const definition = requireEquipmentDefinition(item.equipmentKey);
  save.fragments[materialId] = availableMaterials - cost.materials;
  if (save.fragments[materialId] <= 0) {
    delete save.fragments[materialId];
  }
  save.gold -= cost.gold;
  save.inventory[itemIndex] = buildInventoryItem(definition, rarity, nextTier, item.id, item.equippedToCharacterId ?? null);

  syncCharacterEquipmentMaps(save);
  await persistEquipmentState(supabase, context.userId, save);

  const config = await getBootstrapMonetizationConfig(supabase);
  await updateDailyMissionProgress(supabase, context.userId, config, "item_equipped_or_upgraded", 1);
  await updateDailyMissionProgress(supabase, context.userId, config, "gold_spent", cost.gold);

  const response = {
    ok: true,
    action: "upgrade",
    itemId: input.itemId,
    fromTier: currentTier,
    toTier: nextTier,
    cost,
    snapshot: await buildEquipmentResponse(supabase, context.userId, save),
  };
  await completeIdempotentOperation(supabase, context.userId, input.requestId, response);
  return response;
}

export async function dismantleItemDedicated(
  context: GodotAuthedRequestContext,
  input: DismantleItemInput,
): Promise<unknown> {
  const supabase = createServiceSupabaseClient();
  const operation = `dismantle_item_v1:${input.itemId}`;
  const replay = await beginIdempotentOperation(supabase, context.userId, operation, input.requestId, "equipment_dismantle");
  if (replay.status === "replayed") {
    if (replay.response == null) {
      throw new HttpModuleError(409, "operation_in_progress", "equipment_dismantle", "El desmantelado todavia esta procesandose. Intenta otra vez en unos segundos.");
    }
    return replay.response;
  }

  const supaConfig = await getBootstrapMonetizationConfig(supabase);
  const save = await ensureEquipmentFoundation(supabase, context.userId);
  const itemIndex = save.inventory.findIndex((item) => item.id === input.itemId);
  if (itemIndex < 0) {
    throw new HttpModuleError(404, "equipment_not_found", "equipment_dismantle", "Item de equipamiento no encontrado.");
  }

  const item = save.inventory[itemIndex];
  if (item.equippedToCharacterId) {
    throw new HttpModuleError(409, "equipment_equipped", "equipment_dismantle", "No se puede desmantelar un item equipado.");
  }

  const rarity = normalizeEquipmentRarity(item.rarity);
  const materialId = buildEquipmentMaterialId(item.slot as EquipmentSlot);
  const gained = EQUIPMENT_DISMANTLE_YIELD_BY_RARITY[rarity];
  save.fragments[materialId] = Math.max(0, save.fragments[materialId] ?? 0) + gained;
  save.inventory.splice(itemIndex, 1);

  syncCharacterEquipmentMaps(save);
  await persistEquipmentState(supabase, context.userId, save);
  await updateDailyMissionProgress(supabase, context.userId, supaConfig, "item_sold_or_dismantled", 1);

  const response = {
    ok: true,
    action: "dismantle",
    itemId: input.itemId,
    materialId,
    gained,
    snapshot: await buildEquipmentResponse(supabase, context.userId, save),
  };
  await completeIdempotentOperation(supabase, context.userId, input.requestId, response);
  return response;
}

async function buildEquipmentResponse(supabase: SupabaseClient, userId: string, save: GameSaveSnapshot) {
  const heroes = await loadOwnedBaseCharacterIds(supabase, userId, save);
  const items = save.inventory.map((item) => ({
    id: item.id,
    equipmentKey: item.equipmentKey ?? "",
    family: item.family ?? "",
    name: item.name,
    slot: item.slot,
    rarity: normalizeEquipmentRarity(item.rarity),
    tier: Math.max(1, Math.floor(item.tier ?? 1)),
    maxTier: EQUIPMENT_MAX_TIER_BY_RARITY[normalizeEquipmentRarity(item.rarity)],
    ad: item.ad,
    hp: item.hp,
    ap: item.ap,
    equippedToCharacterId: item.equippedToCharacterId ?? null,
    isEquipped: Boolean(item.equippedToCharacterId),
  })).sort(compareEquipmentRows);

  const equipmentMaterials = (["weapon", "helmet", "armor", "boots", "accessory"] as EquipmentSlot[]).map((slot) => ({
    materialId: buildEquipmentMaterialId(slot),
    slot,
    quantity: Math.max(0, save.fragments[buildEquipmentMaterialId(slot)] ?? 0),
  }));
  const materialIds = new Set(equipmentMaterials.map((entry) => entry.materialId));
  const extraMaterials = Object.entries(save.fragments)
    .filter(([materialId, quantity]) => !materialIds.has(materialId) && Math.max(0, Math.floor(Number(quantity) || 0)) > 0)
    .map(([materialId, quantity]) => ({
      materialId,
      slot: materialId.startsWith("element:") ? "card_element" : materialId.startsWith("fragment:") ? "card_fragment" : "material",
      quantity: Math.max(0, Math.floor(Number(quantity) || 0)),
    }));

  return {
    ok: true,
    gold: save.gold,
    items,
    materials: [...equipmentMaterials, ...extraMaterials],
    heroes,
  };
}

async function ensureEquipmentFoundation(supabase: SupabaseClient, userId: string) {
  const save = await loadPlayerSave(supabase, userId);
  let changed = false;

  const normalizedInventory = save.inventory
    .filter((item) => typeof item.equipmentKey === "string" && item.equipmentKey.trim().length > 0)
    .map((item) => normalizeEquipmentInventoryItem(item));
  if (normalizedInventory.length !== save.inventory.length || JSON.stringify(normalizedInventory) !== JSON.stringify(save.inventory)) {
    save.inventory = normalizedInventory;
    changed = true;
  }

  syncCharacterEquipmentMaps(save);
  if (changed) {
    await persistEquipmentState(supabase, userId, save);
  }
  return save;
}

function normalizeEquipmentInventoryItem(item: EquipmentItem): EquipmentItem {
  const definition = requireEquipmentDefinition(item.equipmentKey);
  const rarity = normalizeEquipmentRarity(item.rarity);
  const tier = Math.max(1, Math.min(EQUIPMENT_MAX_TIER_BY_RARITY[rarity], Math.floor(item.tier ?? 1)));
  return buildInventoryItem(definition, rarity, tier, item.id, item.equippedToCharacterId ?? null);
}

function buildInventoryItem(
  definition: EquipmentDefinition,
  rarity: EquipmentRarity,
  tier: number,
  id: string = randomUUID(),
  equippedToCharacterId: string | null = null,
): EquipmentItem {
  const stats = buildEquipmentStats(definition, rarity, tier);
  return {
    id,
    slot: definition.slot,
    rarity,
    name: definition.name,
    equipmentKey: definition.key,
    family: definition.family,
    tier,
    equippedToCharacterId,
    ad: stats.ad,
    hp: stats.hp,
    ap: stats.ap,
    atk: stats.ad,
    def: stats.ap,
  };
}

function syncCharacterEquipmentMaps(save: GameSaveSnapshot) {
  for (const character of Object.values(save.characters)) {
    character.equipment = {};
  }
  for (const item of save.inventory) {
    const characterId = item.equippedToCharacterId?.trim();
    if (!characterId) continue;
    const owner = save.characters[characterId];
    if (!owner) {
      item.equippedToCharacterId = null;
      continue;
    }
    owner.equipment[item.slot] = item;
  }
}

function resolveTargetCharacterId(save: GameSaveSnapshot, targetCharacterId?: string) {
  const normalized = targetCharacterId?.trim();
  if (normalized) {
    if (!save.characters[normalized]) {
      throw new HttpModuleError(404, "equipment_target_not_found", "equipment_equip", "Heroe objetivo no encontrado.");
    }
    return normalized;
  }

  for (const candidate of save.team) {
    if (candidate && save.characters[candidate]) return candidate;
  }
  const firstOwned = Object.keys(save.characters)[0];
  if (!firstOwned) {
    throw new HttpModuleError(409, "equipment_no_owned_heroes", "equipment_equip", "No hay heroes base disponibles para equipar.");
  }
  return firstOwned;
}

function requireEquipmentDefinition(equipmentKey?: string) {
  const key = String(equipmentKey ?? "").trim();
  const definition = EQUIPMENT_DEFINITIONS_BY_KEY.get(key);
  if (!definition) {
    throw new HttpModuleError(500, "equipment_definition_missing", "equipment_status", `No existe definicion de equipamiento para ${key || "unknown"}.`);
  }
  return definition;
}

async function persistEquipmentState(supabase: SupabaseClient, userId: string, save: GameSaveSnapshot) {
  const now = new Date().toISOString();
  await upsertPlayerSave(supabase, userId, save, now);
  await syncUserEconomy(supabase, userId, save, now);
  await syncUserInventoryMirror(supabase, userId, save, now);
  await syncUserMaterialsMirror(supabase, userId, save, now);
}

async function upsertPlayerSave(supabase: SupabaseClient, userId: string, save: GameSaveSnapshot, now: string) {
  const { error } = await supabase.from("player_saves").upsert(
    {
      user_id: userId,
      save,
      save_version: save.schemaVersion,
      updated_at: now,
    },
    { onConflict: "user_id" },
  );
  if (error) throw new Error(error.message);
}

async function syncUserEconomy(supabase: SupabaseClient, userId: string, save: GameSaveSnapshot, now: string) {
  const { error } = await supabase.from("user_economy").upsert(
    {
      user_id: userId,
      gold: save.gold,
      gems: save.gems,
      updated_at: now,
    },
    { onConflict: "user_id" },
  );
  if (error) throw new Error(error.message);
}

async function syncUserInventoryMirror(supabase: SupabaseClient, userId: string, save: GameSaveSnapshot, now: string) {
  const equippedCardIdsByCharacter = await loadBaseUserCardIdByCharacter(supabase, userId);

  const { error: deleteError } = await supabase
    .from("user_inventory")
    .delete()
    .eq("user_id", userId);
  if (deleteError) throw new Error(deleteError.message);

  if (save.inventory.length === 0) return;

  const rows = save.inventory.map((item) => ({
    user_id: userId,
    id: item.id,
    slot: normalizeEquipmentSlotForDatabase(item.slot),
    rarity: normalizeEquipmentRarityForDatabase(item.rarity),
    name: item.name,
    atk: item.ad,
    hp: item.hp,
    def: item.ap,
    equipment_key: item.equipmentKey ?? null,
    equipment_tier: item.tier ?? 1,
    equipped_to_card_id: item.equippedToCharacterId ? (equippedCardIdsByCharacter.get(item.equippedToCharacterId) ?? null) : null,
    updated_at: now,
  }));

  const { error: insertError } = await supabase.from("user_inventory").insert(rows);
  if (insertError) throw new Error(insertError.message);
}

async function syncUserMaterialsMirror(supabase: SupabaseClient, userId: string, save: GameSaveSnapshot, now: string) {
  const { error: deleteError } = await supabase
    .from("user_materials")
    .delete()
    .eq("user_id", userId);
  if (deleteError) throw new Error(deleteError.message);

  const entries = Object.entries(save.fragments);
  if (entries.length === 0) return;

  const rows = entries.map(([materialId, quantity]) => ({
    user_id: userId,
    material_id: materialId,
    quantity: Math.max(0, Math.floor(quantity)),
    updated_at: now,
  }));
  const { error: insertError } = await supabase.from("user_materials").insert(rows);
  if (insertError) throw new Error(insertError.message);
}

async function loadBaseUserCardIdByCharacter(supabase: SupabaseClient, userId: string) {
  const { data, error } = await supabase
    .from("user_cards")
    .select("id, character_key, character_id, card_type, variant")
    .eq("user_id", userId)
    .returns<UserCardRow[]>();
  if (error) throw new Error(error.message);

  const output = new Map<string, string>();
  for (const row of data ?? []) {
    const isBaseCard = row.card_type === "BASE" || row.variant === "base" || (row.card_type == null && row.variant == null);
    if (!isBaseCard) continue;
    const key = row.character_key?.trim() || row.character_id;
    if (!output.has(key)) {
      output.set(key, row.id);
    }
  }
  return output;
}

async function loadOwnedBaseCharacterIds(supabase: SupabaseClient, userId: string, save: GameSaveSnapshot) {
  try {
    const { data, error } = await supabase
      .from("user_cards")
      .select("character_key, character_id, card_type, variant")
      .eq("user_id", userId)
      .returns<Array<Pick<UserCardRow, "character_key" | "character_id" | "card_type" | "variant">>>();
    if (error) throw new Error(error.message);

    const characters = new Set<string>();
    for (const row of data ?? []) {
      const isBaseCard = row.card_type === "BASE" || row.variant === "base" || (row.card_type == null && row.variant == null);
      if (!isBaseCard) continue;
      characters.add(row.character_key?.trim() || row.character_id);
    }

    if (characters.size > 0) {
      return [...characters].map((characterId) => ({
        characterId,
        equippedSlots: Object.keys(save.characters[characterId]?.equipment ?? {}),
      }));
    }
  } catch {
    // Fallback to save only.
  }

  return Object.keys(save.characters).map((characterId) => ({
    characterId,
    equippedSlots: Object.keys(save.characters[characterId]?.equipment ?? {}),
  }));
}

async function loadPlayerSave(supabase: SupabaseClient, userId: string) {
  const { data, error } = await supabase
    .from("player_saves")
    .select("save")
    .eq("user_id", userId)
    .maybeSingle<PlayerSaveRow>();
  if (error) throw new Error(error.message);
  const save = normalizeGameSave(data?.save ?? createInitialGameSave());
  await mergeUserMaterialStacks(supabase, userId, save);
  return save;
}

async function mergeUserMaterialStacks(supabase: SupabaseClient, userId: string, save: GameSaveSnapshot) {
  const { data, error } = await supabase
    .from("user_materials")
    .select("material_id, quantity")
    .eq("user_id", userId)
    .returns<Array<{ material_id: string | null; quantity: number | null }>>();
  if (error) throw new Error(error.message);

  for (const row of data ?? []) {
    const materialId = String(row.material_id ?? "").trim().toLowerCase();
    const quantity = Math.max(0, Math.floor(Number(row.quantity) || 0));
    if (!materialId || quantity <= 0) continue;
    save.fragments[materialId] = Math.max(Math.max(0, Math.floor(Number(save.fragments[materialId]) || 0)), quantity);
  }
}

function compareEquipmentRows(
  left: {
    rarity: EquipmentRarity;
    slot: string;
    family: string;
    tier: number;
    name: string;
  },
  right: {
    rarity: EquipmentRarity;
    slot: string;
    family: string;
    tier: number;
    name: string;
  },
) {
  const rarityOrder = { mythic: 1, legendary: 2, epic: 3, basic: 4 };
  const familyOrder = { espectral: 1, vacio: 2, maldito: 3 };
  return (
    (rarityOrder[left.rarity] - rarityOrder[right.rarity]) ||
    left.slot.localeCompare(right.slot) ||
    ((familyOrder[left.family as keyof typeof familyOrder] ?? 99) - (familyOrder[right.family as keyof typeof familyOrder] ?? 99)) ||
    (right.tier - left.tier) ||
    left.name.localeCompare(right.name)
  );
}

async function beginIdempotentOperation(
  supabase: SupabaseClient,
  userId: string,
  operation: string,
  requestId: string,
  module: "equipment_equip" | "equipment_unequip" | "equipment_upgrade" | "equipment_dismantle",
) {
  assertRequestId(requestId, module);
  const { error: insertError } = await supabase.from("idempotency_keys").insert({
    user_id: userId,
    request_id: requestId,
    operation,
  });
  if (!insertError) {
    return { status: "started" as const, response: null as unknown };
  }

  const { data, error: readError } = await supabase
    .from("idempotency_keys")
    .select("operation, response")
    .eq("user_id", userId)
    .eq("request_id", requestId)
    .maybeSingle<IdempotencyRow>();
  if (readError || !data) throw new Error(insertError.message);
  if (data.operation !== operation) {
    throw new HttpModuleError(400, "request_id_reused", module, "requestId already used for another operation.");
  }
  return { status: "replayed" as const, response: data.response };
}

async function completeIdempotentOperation(
  supabase: SupabaseClient,
  userId: string,
  requestId: string,
  response: unknown,
) {
  const { error } = await supabase
    .from("idempotency_keys")
    .update({ response })
    .eq("user_id", userId)
    .eq("request_id", requestId);
  if (error) throw new Error(error.message);
}

function assertRequestId(
  requestId: string,
  module: "equipment_equip" | "equipment_unequip" | "equipment_upgrade" | "equipment_dismantle",
) {
  const value = requestId.trim();
  if (!/^[a-zA-Z0-9_-]{8,80}$/.test(value)) {
    throw new HttpModuleError(400, "invalid_request_id", module, "Invalid requestId.");
  }
}
