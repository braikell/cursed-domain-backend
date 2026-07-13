import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  AscendCardInput,
  GodotAuthedRequestContext,
  UpgradeCardInput,
} from "../../contracts.js";
import { HttpModuleError } from "../../errors.js";
import { createServiceSupabaseClient } from "../../supabase.js";
import {
  canCardLevelUp,
  getCardAscensionCost,
  getCardLevelCapForAscension,
  getCardMaxAscension,
  getCardMaxLevel,
  getCardStarsForLevel,
  getCardImproveCostForLevel,
  getCardBalance,
  getCardFinalStats,
  type CardBalanceRarity,
  type CardCatalogType,
} from "./balance.js";
import {
  buildCardUpgradeFragmentMaterialIds,
  countAvailableCardFragments,
  normalizeCardMaterialId,
  pruneOwnedCardUnlockElements,
  syncOwnedCardFragmentMirrors,
} from "./materials.js";
import type { GameSaveSnapshot, OwnedCharacter, OwnedDefinitiveCard } from "../bootstrap/game-save.js";
import { createInitialGameSave, normalizeGameSave } from "../bootstrap/game-save.js";
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
  user_id: string;
  card_definition_id: string;
  character_id: string;
  character_key: string | null;
  variant: string | null;
  card_type: string | null;
  rarity: string | null;
  level: number;
  xp: number;
  stars: number;
  ascension: number;
  awakening: number;
  fragments: number;
  energy: number | null;
  max_energy: number | null;
  acquired_at: string | null;
  updated_at: string | null;
}

interface IdempotencyRow {
  operation: string;
  response: unknown | null;
}

interface CardIdentity {
  characterId: string;
  characterKey: string;
  cardType: CardCatalogType;
  rarity: CardBalanceRarity;
}

interface ResolvedUpgradeRequest {
  mode: "single" | "max_affordable";
  requestedLevels: number;
}

export async function upgradeCardDedicated(
  context: GodotAuthedRequestContext,
  input: UpgradeCardInput,
): Promise<unknown> {
  const supabase = createServiceSupabaseClient();
  const upgradeRequest = resolveUpgradeRequest(input);
  const operation = `upgrade_card_v2:${input.userCardId}:${upgradeRequest.mode}:${upgradeRequest.requestedLevels}`;
  const replay = await beginIdempotentOperation(supabase, context.userId, operation, input.requestId, "cards_upgrade");
  if (replay.status === "replayed") {
    if (replay.response == null) {
      throw new HttpModuleError(409, "operation_in_progress", "cards_upgrade", "La mejora de carta sigue procesandose. Intenta otra vez en unos segundos.");
    }
    return replay.response;
  }

  await ensureBootstrapMonetizationFoundation(supabase, context.userId);
  const config = await getBootstrapMonetizationConfig(supabase);
  await ensureDailyMissionSnapshotState(supabase, context.userId, config, getUtcResetDate());

  const save = await loadPlayerSave(supabase, context.userId);
  const row = await loadUserCardRow(supabase, context.userId, input.userCardId);
  const identity = resolveCardIdentity(row);
  const currentLevel = Math.max(1, Math.floor(Number(row.level) || 1));
  const currentAscension = Math.max(0, Math.floor(Number(row.ascension) || 0));
  const currentLevelCap = getCardLevelCapForAscension(identity.cardType, identity.rarity, currentAscension);
  if (!canCardLevelUp(identity.cardType, identity.rarity, currentLevel, currentAscension)) {
    if (currentLevel >= getCardMaxLevel(identity.cardType, identity.rarity)) {
      throw new HttpModuleError(409, "card_max_level_reached", "cards_upgrade", "La carta ya alcanzo su nivel maximo.");
    }
    throw new HttpModuleError(409, "card_requires_ascension", "cards_upgrade", "Debes ascender la carta antes de seguir subiendo de nivel.");
  }

  const materialIds = buildUpgradeMaterialIds(identity);
  const upgradePlan = buildUpgradePlan(save, materialIds, identity, currentLevel, currentLevelCap, upgradeRequest);
  if (upgradePlan.levelsApplied <= 0) {
    throw new HttpModuleError(409, "not_enough_resources", "cards_upgrade", "No tienes recursos suficientes para mejorar esta carta.");
  }

  save.gold -= upgradePlan.cost.gold;
  consumeFragments(save, materialIds, upgradePlan.cost.fragments, "cards_upgrade");
  const remainingFragments = countAvailableCardFragments(save, identity);

  const nextLevel = upgradePlan.targetLevel;
  const nextStars = getCardStarsForLevel(identity.cardType, identity.rarity, nextLevel);
  const nextXp = 0;

  mutateSaveCardState(save, identity, {
    level: nextLevel,
    xp: nextXp,
    stars: nextStars,
    ascension: currentAscension,
    awakening: Math.max(0, Math.floor(Number(row.awakening) || 0)),
    fragments: remainingFragments,
    energy: Math.max(0, Math.floor(Number(row.energy) || 0)),
    maxEnergy: Math.max(0, Math.floor(Number(row.max_energy) || 0)),
    cardDefinitionId: row.card_definition_id,
    acquiredAt: row.acquired_at,
  });

  await persistCardProgressState(supabase, context.userId, save, row.id, {
    level: nextLevel,
    xp: nextXp,
    stars: nextStars,
    ascension: currentAscension,
    fragments: remainingFragments,
  });

  await updateDailyMissionProgress(supabase, context.userId, config, "gold_spent", upgradePlan.cost.gold);

  const response = {
    ok: true,
    action: "upgrade_card",
    userCardId: row.id,
    characterKey: identity.characterKey,
    cardType: identity.cardType,
    rarity: identity.rarity,
    fromLevel: currentLevel,
    toLevel: nextLevel,
    requestedLevels: upgradeRequest.mode === "max_affordable" ? null : upgradeRequest.requestedLevels,
    upgradedLevels: upgradePlan.levelsApplied,
    upgradeMode: upgradeRequest.mode,
    stoppedReason: upgradePlan.stoppedReason,
    currentLevelCap,
    cost: upgradePlan.cost,
    finalStats: getCardFinalStats(identity.characterKey, identity.cardType, nextLevel, currentAscension, getEquipmentBonusForCharacter(save, identity.characterId, identity.characterKey)),
    save,
  };
  await completeIdempotentOperation(supabase, context.userId, input.requestId, response);
  return response;
}

function resolveUpgradeRequest(input: UpgradeCardInput): ResolvedUpgradeRequest {
  if (input.mode === "max_affordable") {
    return {
      mode: "max_affordable",
      requestedLevels: 200,
    };
  }
  return {
    mode: "single",
    requestedLevels: Math.max(1, Math.min(200, Math.floor(Number(input.levels) || 1))),
  };
}

function buildUpgradePlan(
  save: GameSaveSnapshot,
  materialIds: string[],
  identity: CardIdentity,
  currentLevel: number,
  currentLevelCap: number,
  upgradeRequest: ResolvedUpgradeRequest,
) {
  const availableGold = Math.max(0, Math.floor(Number(save.gold) || 0));
  const availableFragments = materialIds.reduce((sum, materialId) => sum + Math.max(0, Math.floor(save.fragments[materialId] ?? 0)), 0);
  const maxStepsByCap = Math.max(0, currentLevelCap - currentLevel);
  const requestedSteps = upgradeRequest.mode === "max_affordable"
    ? maxStepsByCap
    : Math.min(upgradeRequest.requestedLevels, maxStepsByCap);
  let targetLevel = currentLevel;
  let levelsApplied = 0;
  let totalGold = 0;
  let totalFragments = 0;
  let stoppedReason: "requested_levels" | "level_cap" | "resources" = "requested_levels";

  for (let step = 0; step < requestedSteps; step += 1) {
    const cost = getCardImproveCostForLevel(identity.cardType, identity.rarity, targetLevel);
    if (totalGold + cost.gold > availableGold || totalFragments + cost.fragments > availableFragments) {
      stoppedReason = "resources";
      break;
    }
    totalGold += cost.gold;
    totalFragments += cost.fragments;
    targetLevel += 1;
    levelsApplied += 1;
  }

  if (levelsApplied >= maxStepsByCap) {
    stoppedReason = "level_cap";
  } else if (levelsApplied >= requestedSteps && upgradeRequest.mode !== "max_affordable") {
    stoppedReason = "requested_levels";
  }

  return {
    targetLevel,
    levelsApplied,
    stoppedReason,
    cost: {
      gold: totalGold,
      fragments: totalFragments,
    },
  };
}

export async function ascendCardDedicated(
  context: GodotAuthedRequestContext,
  input: AscendCardInput,
): Promise<unknown> {
  const supabase = createServiceSupabaseClient();
  const operation = `ascend_card_v1:${input.userCardId}`;
  const replay = await beginIdempotentOperation(supabase, context.userId, operation, input.requestId, "cards_ascend");
  if (replay.status === "replayed") {
    if (replay.response == null) {
      throw new HttpModuleError(409, "operation_in_progress", "cards_ascend", "La ascension de carta sigue procesandose. Intenta otra vez en unos segundos.");
    }
    return replay.response;
  }

  await ensureBootstrapMonetizationFoundation(supabase, context.userId);
  const config = await getBootstrapMonetizationConfig(supabase);
  await ensureDailyMissionSnapshotState(supabase, context.userId, config, getUtcResetDate());

  const save = await loadPlayerSave(supabase, context.userId);
  const row = await loadUserCardRow(supabase, context.userId, input.userCardId);
  const identity = resolveCardIdentity(row);
  const currentLevel = Math.max(1, Math.floor(Number(row.level) || 1));
  const currentAscension = Math.max(0, Math.floor(Number(row.ascension) || 0));
  const maxAscension = getCardMaxAscension(identity.cardType, identity.rarity);
  if (currentAscension >= maxAscension) {
    throw new HttpModuleError(409, "card_max_ascension_reached", "cards_ascend", "La carta ya alcanzo su ascension maxima.");
  }

  const currentLevelCap = getCardLevelCapForAscension(identity.cardType, identity.rarity, currentAscension);
  if (currentLevel < currentLevelCap) {
    throw new HttpModuleError(409, "card_level_cap_not_reached", "cards_ascend", "La carta debe llegar a su tope actual antes de ascender.");
  }

  const targetAscension = currentAscension + 1;
  const cost = getCardAscensionCost(targetAscension);
  const materialIds = buildUpgradeMaterialIds(identity);
  ensureEnoughResources(save, materialIds, cost.gold, cost.fragments, "cards_ascend");

  save.gold -= cost.gold;
  consumeFragments(save, materialIds, cost.fragments, "cards_ascend");
  const remainingFragments = countAvailableCardFragments(save, identity);

  const currentStars = getCardStarsForLevel(identity.cardType, identity.rarity, currentLevel);
  mutateSaveCardState(save, identity, {
    level: currentLevel,
    xp: Math.max(0, Math.floor(Number(row.xp) || 0)),
    stars: currentStars,
    ascension: targetAscension,
    awakening: Math.max(0, Math.floor(Number(row.awakening) || 0)),
    fragments: remainingFragments,
    energy: Math.max(0, Math.floor(Number(row.energy) || 0)),
    maxEnergy: Math.max(0, Math.floor(Number(row.max_energy) || 0)),
    cardDefinitionId: row.card_definition_id,
    acquiredAt: row.acquired_at,
  });

  await persistCardProgressState(supabase, context.userId, save, row.id, {
    level: currentLevel,
    xp: Math.max(0, Math.floor(Number(row.xp) || 0)),
    stars: currentStars,
    ascension: targetAscension,
    fragments: remainingFragments,
  });

  await updateDailyMissionProgress(supabase, context.userId, config, "gold_spent", cost.gold);

  const response = {
    ok: true,
    action: "ascend_card",
    userCardId: row.id,
    characterKey: identity.characterKey,
    cardType: identity.cardType,
    rarity: identity.rarity,
    fromAscension: currentAscension,
    toAscension: targetAscension,
    newLevelCap: getCardLevelCapForAscension(identity.cardType, identity.rarity, targetAscension),
    cost,
    finalStats: getCardFinalStats(identity.characterKey, identity.cardType, currentLevel, targetAscension, getEquipmentBonusForCharacter(save, identity.characterId, identity.characterKey)),
    save,
  };
  await completeIdempotentOperation(supabase, context.userId, input.requestId, response);
  return response;
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
  pruneOwnedCardUnlockElements(save);
  syncOwnedCardFragmentMirrors(save);
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
    const materialId = normalizeCardMaterialId(String(row.material_id ?? ""));
    const quantity = Math.max(0, Math.floor(Number(row.quantity) || 0));
    if (!materialId || quantity <= 0) continue;
    save.fragments[materialId] = Math.max(Math.max(0, Math.floor(Number(save.fragments[materialId]) || 0)), quantity);
  }
}

async function loadUserCardRow(supabase: SupabaseClient, userId: string, userCardId: string) {
  const { data, error } = await supabase
    .from("user_cards")
    .select("id,user_id,card_definition_id,character_id,character_key,variant,card_type,rarity,level,xp,stars,ascension,awakening,fragments,energy,max_energy,acquired_at,updated_at")
    .eq("user_id", userId)
    .eq("id", userCardId)
    .maybeSingle<UserCardRow>();
  if (error) throw new Error(error.message);
  if (!data) {
    throw new HttpModuleError(404, "card_not_found", "cards_upgrade", "Carta no encontrada.");
  }
  return data;
}

function resolveCardIdentity(row: UserCardRow): CardIdentity {
  const cardType = String(row.card_type ?? row.variant ?? "BASE").trim().toUpperCase() === "DEFINITIVA"
    || String(row.variant ?? "").trim().toLowerCase() == "definitive"
    ? "DEFINITIVA"
    : "BASE";
  const characterKey = String(row.character_key ?? row.character_id).trim().toLowerCase();
  const rarity = normalizeCardRarity(String(row.rarity ?? getCardBalance(characterKey, cardType)?.rarity ?? "basic"));
  return {
    characterId: row.character_id,
    characterKey,
    cardType,
    rarity,
  };
}

function getEquipmentBonusForCharacter(save: GameSaveSnapshot, characterId: string, characterKey: string) {
  const character = save.characters[characterId] ?? save.characters[characterKey];
  const equipment = character?.equipment ?? {};
  return Object.values(equipment).reduce(
    (bonus, item) => ({
      ad: bonus.ad + Math.max(0, Math.floor(Number(item?.ad ?? item?.atk ?? 0) || 0)),
      ap: bonus.ap + Math.max(0, Math.floor(Number(item?.ap ?? item?.def ?? 0) || 0)),
      hp: bonus.hp + Math.max(0, Math.floor(Number(item?.hp ?? 0) || 0)),
    }),
    { ad: 0, ap: 0, hp: 0 },
  );
}

function normalizeCardRarity(raw: string): CardBalanceRarity {
  switch (String(raw).trim().toLowerCase()) {
    case "epic":
    case "epico":
      return "epic";
    case "legendary":
    case "legendario":
      return "legendary";
    case "mythic":
    case "mitico":
      return "mythic";
    default:
      return "basic";
  }
}

function buildUpgradeMaterialIds(identity: CardIdentity) {
  return buildCardUpgradeFragmentMaterialIds(identity);
}

function ensureEnoughResources(
  save: GameSaveSnapshot,
  materialIds: string[],
  goldCost: number,
  fragmentCost: number,
  moduleName: "cards_upgrade" | "cards_ascend",
) {
  if (save.gold < goldCost) {
    throw new HttpModuleError(409, "not_enough_gold", moduleName, "No tienes suficiente oro.");
  }
  const available = materialIds.reduce((sum, materialId) => sum + Math.max(0, Math.floor(save.fragments[materialId] ?? 0)), 0);
  if (available < fragmentCost) {
    throw new HttpModuleError(409, "not_enough_fragments", moduleName, "No tienes suficientes fragmentos.");
  }
}

function consumeFragments(
  save: GameSaveSnapshot,
  materialIds: string[],
  fragmentCost: number,
  moduleName: "cards_upgrade" | "cards_ascend",
) {
  let remaining = Math.max(0, Math.floor(fragmentCost));
  for (const materialId of materialIds) {
    if (remaining <= 0) break;
    const available = Math.max(0, Math.floor(save.fragments[materialId] ?? 0));
    if (available <= 0) continue;
    const consumed = Math.min(available, remaining);
    const nextQuantity = available - consumed;
    if (nextQuantity <= 0) {
      delete save.fragments[materialId];
    } else {
      save.fragments[materialId] = nextQuantity;
    }
    remaining -= consumed;
  }
  if (remaining > 0) {
    throw new HttpModuleError(409, "fragment_consumption_incomplete", moduleName, "No se pudieron consumir todos los fragmentos requeridos.");
  }
}

function mutateSaveCardState(
  save: GameSaveSnapshot,
  identity: CardIdentity,
  state: {
    level: number;
    xp: number;
    stars: number;
    ascension: number;
    awakening: number;
    fragments: number;
    energy: number;
    maxEnergy: number;
    cardDefinitionId: string;
    acquiredAt: string | null;
  },
) {
  if (identity.cardType === "DEFINITIVA") {
    const current = save.definitiveCards[identity.characterId];
    const nextCard: OwnedDefinitiveCard = {
      characterId: identity.characterId,
      cardDefinitionId: state.cardDefinitionId,
      level: state.level,
      xp: state.xp,
      stars: state.stars,
      ascension: state.ascension,
      awakening: state.awakening,
      fragments: state.fragments,
      acquiredAt: state.acquiredAt ? Date.parse(state.acquiredAt) : current?.acquiredAt ?? Date.now(),
    };
    save.definitiveCards[identity.characterId] = nextCard;
    return;
  }

  const currentCharacter = save.characters[identity.characterId];
  const nextCharacter: OwnedCharacter = {
    id: identity.characterId,
    level: state.level,
    xp: state.xp,
    stars: state.stars,
    ascension: state.ascension,
    awakening: state.awakening,
    fragments: state.fragments,
    equipment: currentCharacter?.equipment ?? {},
    energy: state.energy,
    maxEnergy: state.maxEnergy > 0 ? state.maxEnergy : currentCharacter?.maxEnergy ?? 100,
  };
  save.characters[identity.characterId] = nextCharacter;
}

async function persistCardProgressState(
  supabase: SupabaseClient,
  userId: string,
  save: GameSaveSnapshot,
  userCardId: string,
  cardState: {
    level: number;
    xp: number;
    stars: number;
    ascension: number;
    fragments: number;
  },
) {
  const now = new Date().toISOString();
  const { error: saveError } = await supabase.from("player_saves").upsert(
    {
      user_id: userId,
      save,
      save_version: save.schemaVersion,
      updated_at: now,
    },
    { onConflict: "user_id" },
  );
  if (saveError) throw new Error(saveError.message);

  const { error: economyError } = await supabase.from("user_economy").upsert(
    {
      user_id: userId,
      gold: save.gold,
      gems: save.gems,
      updated_at: now,
    },
    { onConflict: "user_id" },
  );
  if (economyError) throw new Error(economyError.message);

  const { error: materialDeleteError } = await supabase
    .from("user_materials")
    .delete()
    .eq("user_id", userId);
  if (materialDeleteError) throw new Error(materialDeleteError.message);

  const materialEntries = Object.entries(save.fragments);
  if (materialEntries.length > 0) {
    const { error: materialInsertError } = await supabase.from("user_materials").insert(
      materialEntries.map(([materialId, quantity]) => ({
        user_id: userId,
        material_id: materialId,
        quantity: Math.max(0, Math.floor(quantity)),
        updated_at: now,
      })),
    );
    if (materialInsertError) throw new Error(materialInsertError.message);
  }

  const { error: cardError } = await supabase
    .from("user_cards")
    .update({
      level: cardState.level,
      xp: cardState.xp,
      stars: cardState.stars,
      ascension: cardState.ascension,
      fragments: cardState.fragments,
      updated_at: now,
    })
    .eq("user_id", userId)
    .eq("id", userCardId);
  if (cardError) throw new Error(cardError.message);
}

async function beginIdempotentOperation(
  supabase: SupabaseClient,
  userId: string,
  operation: string,
  requestId: string,
  module: "cards_upgrade" | "cards_ascend",
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
    throw new HttpModuleError(400, "request_id_reused", module, "requestId ya fue usado para otra operacion.");
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

function assertRequestId(requestId: string, module: "cards_upgrade" | "cards_ascend") {
  const value = requestId.trim();
  if (!/^[a-zA-Z0-9_-]{8,80}$/.test(value)) {
    throw new HttpModuleError(400, "invalid_request_id", module, "Invalid requestId.");
  }
}
