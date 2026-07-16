import { createHash, randomUUID } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { CompleteBattleInput, GodotAuthedRequestContext, StartBattleInput } from "../../contracts.js";
import { HttpModuleError } from "../../errors.js";
import {
  compareStageKeys,
  createInitialGameSave,
  normalizeGameSave,
  normalizeStageKey,
  toLegacyStageKey,
  type EquipmentItem,
  type GameSaveSnapshot,
} from "../bootstrap/game-save.js";
import {
  ensureBootstrapMonetizationFoundation,
  ensureDailyMissionSnapshotState,
  getBootstrapMonetizationConfig,
  getUtcResetDate,
  updateDailyMissionProgress,
} from "../bootstrap/monetization-foundation.js";
import { createServiceSupabaseClient } from "../../supabase.js";
import {
  canCardGainXp,
  getCardLevelCapForAscension,
  getCardFinalStats,
  getCardMaxLevel,
  getCardStarsForLevel,
  getCardXpForNextLevel,
  normalizeCardRarity,
  type CardBalanceRarity,
  type CardCatalogType,
} from "../cards/balance.js";
import type { OwnedCharacter } from "../bootstrap/game-save.js";
import {
  buildEquipmentMaterialId,
  buildEquipmentStats,
  EQUIPMENT_DISMANTLE_YIELD_BY_RARITY,
  EQUIPMENT_ITEMS,
  normalizeEquipmentRarity,
  normalizeEquipmentRarityForDatabase,
  normalizeEquipmentSlotForDatabase,
  type EquipmentDefinition,
  type EquipmentRarity,
  type EquipmentSlot,
} from "../equipment/balance.js";
import { grantPlayerXpReward } from "../progression/player-progression.js";
import { logger } from "../../safe-logger.js";

interface PlayerSaveRow {
  save: GameSaveSnapshot;
}

interface PlayerSaveDebugRow {
  save: Record<string, unknown> | null;
  updated_at?: string | null;
}

interface PlayerProgressRow {
  player_level: number;
  xp: number;
  current_stage: string | null;
  highest_stage: string | null;
  total_battles_won: number;
}

interface PlayerProgressDebugRow {
  player_level: number | null;
  xp: number | null;
  current_stage: string | null;
  highest_stage: string | null;
  total_battles_won: number | null;
  updated_at?: string | null;
}

interface IdempotencyRow {
  operation: string;
  response: unknown | null;
}

interface StageDefinitionRow {
  stage_key: string;
  sort_order: number | null;
  display_name?: string | null;
  name?: string | null;
  gold_reward?: number | null;
  reward_gold?: number | null;
  gems_reward?: number | null;
  reward_gems?: number | null;
  xp_reward?: number | null;
  reward_xp?: number | null;
  battle_xp?: number | null;
  clear_gold?: number | null;
  clear_gems?: number | null;
  clear_xp?: number | null;
  target_pm?: number | null;
  chapter_boss_pm?: number | null;
}

interface UserCardProgressRow {
  id: string;
  character_id: string;
  card_type: string | null;
  variant: string | null;
  rarity: string | null;
  level: number;
  xp: number;
  stars: number;
  ascension: number;
  awakening: number;
  fragments: number;
  energy: number | null;
  max_energy: number | null;
}

interface BattleSessionRow {
  id: string;
  user_id: string;
  mode: string;
  stage_id: string | null;
  team_hash: string;
  team_power: number;
  target_power: number;
  min_duration_seconds: number;
  request_id: string;
  started_at: string;
  expires_at: string;
  consumed_at: string | null;
}

interface BattleStartCardRow {
  id: string;
  user_id: string;
  character_id: string;
  card_type: string | null;
  variant: string | null;
  rarity: string | null;
  level: number;
  stars: number;
  ascension: number;
  awakening: number;
}

interface BattleReward {
  gold: number;
  gems: number;
  xp: number;
  materials: number;
  materialId: string | null;
  equipmentItems: EquipmentRewardItem[];
}

interface EquipmentRewardItem {
  id: string;
  equipmentKey: string;
  name: string;
  slot: string;
  rarity: EquipmentRarity;
  tier: number;
  ad: number;
  ap: number;
  hp: number;
}

const BATTLE_SESSION_TTL_MINUTES = 15;
const MIN_BATTLE_DURATION_SECONDS = 3;

export async function startBattleDedicated(
  context: GodotAuthedRequestContext,
  input: StartBattleInput,
): Promise<unknown> {
  assertRequestId(input.requestId, "battle_start");

  const supabase = createServiceSupabaseClient();
  const stageDefinitions = await loadStageDefinitions(supabase);
  const currentStage = resolveStageDefinition(stageDefinitions, input.stageId);
  if (currentStage == null) {
    throw new HttpModuleError(404, "stage_not_found", "battle_start", "Stage not found.");
  }

  const save = await loadPlayerSave(supabase, context.userId);
  const progress = await loadPlayerProgressRow(supabase, context.userId, save);
  assertStageUnlocked(stageDefinitions, currentStage.stage_key, progress.current_stage ?? save.currentStage, progress.highest_stage ?? save.highestStage, "battle_start");

  const teamSnapshot = await buildBattleTeamSnapshot(supabase, context.userId, input.teamSlots);
  const targetPower = resolveStageTargetPower(currentStage);
  const requiredPower = Math.max(1, Math.floor(targetPower * 0.55));
  if (targetPower > 0 && teamSnapshot.teamPower < requiredPower) {
    throw new HttpModuleError(409, "battle_team_power_too_low", "battle_start", "El equipo esta demasiado bajo para abrir esta batalla.");
  }

  const startedAt = new Date();
  const expiresAt = new Date(startedAt.getTime() + BATTLE_SESSION_TTL_MINUTES * 60_000);
  const { data, error } = await supabase
    .from("battle_sessions")
    .insert({
      user_id: context.userId,
      mode: "campaign",
      stage_id: currentStage.stage_key,
      team_hash: teamSnapshot.teamHash,
      team_power: teamSnapshot.teamPower,
      target_power: targetPower,
      min_duration_seconds: MIN_BATTLE_DURATION_SECONDS,
      request_id: input.requestId,
      started_at: startedAt.toISOString(),
      expires_at: expiresAt.toISOString(),
    })
    .select("id,stage_id,team_hash,team_power,target_power,min_duration_seconds,started_at,expires_at")
    .single<Pick<BattleSessionRow, "id" | "stage_id" | "team_hash" | "team_power" | "target_power" | "min_duration_seconds" | "started_at" | "expires_at">>();
  if (error) throw new Error(error.message);

  return {
    ok: true as const,
    battleSessionId: data.id,
    mode: "campaign",
    stageId: data.stage_id,
    teamHash: data.team_hash,
    teamPower: data.team_power,
    targetPower: data.target_power,
    minDurationSeconds: data.min_duration_seconds,
    startedAt: data.started_at,
    expiresAt: data.expires_at,
  };
}

export async function completeBattleDedicated(
  context: GodotAuthedRequestContext,
  input: CompleteBattleInput,
): Promise<unknown> {
  if (input.result !== "win") {
    throw new HttpModuleError(400, "unsupported_battle_result", "battle_resolve", "Only win result is supported.");
  }
  assertUuid(input.battleSessionId, "battle_resolve");

  const supabase = createServiceSupabaseClient();
  const operation = `complete_battle_v2:${input.battleSessionId}:${input.stageId}:${input.result}`;
  const replay = await beginIdempotentOperation(supabase, context.userId, operation, input.requestId);
  if (replay.status === "replayed") {
    if (replay.response == null) {
      throw new HttpModuleError(409, "operation_in_progress", "battle_resolve", "La resolucion del combate todavia esta procesandose. Intenta otra vez en unos segundos.");
    }
    return replay.response;
  }

  await ensureBootstrapMonetizationFoundation(supabase, context.userId);
  const config = await getBootstrapMonetizationConfig(supabase);
  await ensureDailyMissionSnapshotState(supabase, context.userId, config, getUtcResetDate());

  const stageDefinitions = await loadStageDefinitions(supabase);
  const currentStage = resolveStageDefinition(stageDefinitions, input.stageId);
  if (currentStage == null) {
    throw new HttpModuleError(404, "stage_not_found", "battle_resolve", "Stage not found.");
  }
  const session = await lockBattleSession(supabase, context.userId, input.battleSessionId);
  validateBattleSession(session, currentStage.stage_key, input.durationSeconds);
  await consumeBattleSession(supabase, context.userId, input.battleSessionId);

  const save = await loadPlayerSave(supabase, context.userId);
  const progress = await loadPlayerProgressRow(supabase, context.userId, save);
  logger.debug("[battle_resolve] start", {
    userId: context.userId,
    stageId: input.stageId,
    requestId: input.requestId,
    currentStageBefore: progress.current_stage ?? save.currentStage,
    highestStageBefore: progress.highest_stage ?? save.highestStage,
    goldBefore: save.gold,
    gemsBefore: save.gems,
    xpBefore: progress.xp,
  });

  const stageFlow = resolveStageFlow(
    stageDefinitions,
    currentStage.stage_key,
    progress.current_stage ?? save.currentStage,
    progress.highest_stage ?? save.highestStage,
  );
  const reward = buildBattleReward(currentStage, stageFlow.isReplay);
  const equipmentDrop = buildEquipmentDropForStage(currentStage.stage_key, stageFlow.isReplay);
  if (equipmentDrop != null && isDuplicateEquipmentDrop(save, equipmentDrop.item)) {
    const materialId = buildEquipmentMaterialId(equipmentDrop.item.slot as EquipmentSlot);
    const gained = EQUIPMENT_DISMANTLE_YIELD_BY_RARITY[normalizeEquipmentRarity(equipmentDrop.item.rarity)];
    save.fragments[materialId] = Math.max(0, Math.floor(Number(save.fragments[materialId]) || 0)) + gained;
    reward.materials += gained;
    reward.materialId = materialId;
  } else if (equipmentDrop != null) {
    reward.equipmentItems.push(equipmentDrop.reward);
    save.inventory.push(equipmentDrop.item);
  }
  const heroProgress = await applyHeroBattleXp(supabase, context.userId, save, currentStage.stage_key, stageFlow.isReplay);
  const progressionReward = await grantPlayerXpReward(supabase, {
    userId: context.userId,
    source: "campaign_battle",
    sourceId: currentStage.stage_key,
    requestId: input.requestId,
    xpAmount: reward.xp,
    economyReward: {
      gold: reward.gold,
      gems: reward.gems,
    },
  });
  const nextXp = progressionReward.xpAfter;
  const previousPlayerLevel = progressionReward.levelBefore;
  const leveled = { playerLevel: progressionReward.levelAfter };
  const nextGold = progressionReward.save.gold;
  const nextGems = progressionReward.save.gems;
  const nextTotalBattlesWon = Math.max(progress.total_battles_won, save.totalBattlesWon) + 1;
  logger.debug("[battle_resolve] computed", {
    userId: context.userId,
    stageId: input.stageId,
    isReplay: stageFlow.isReplay,
    reward,
    heroProgress,
    currentStageAfter: stageFlow.currentStage,
    highestStageAfter: stageFlow.highestStage,
    goldAfter: nextGold,
    gemsAfter: nextGems,
    xpAfter: nextXp,
    playerLevelAfter: leveled.playerLevel,
    progressionReward,
  });

  const { error: progressError } = await supabase.from("player_progress").upsert(
    {
      user_id: context.userId,
      player_level: leveled.playerLevel,
      xp: nextXp,
      current_stage: toLegacyStageKey(stageFlow.currentStage),
      highest_stage: toLegacyStageKey(stageFlow.highestStage),
      total_battles_won: nextTotalBattlesWon,
      unlocked_slots: save.unlockedSlots,
      total_summons: save.totalSummons,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  );
  if (progressError) throw new Error(progressError.message);

  await updateDailyMissionProgress(supabase, context.userId, config, "campaign_battle_completed", 1);
  await updateDailyMissionProgress(supabase, context.userId, config, "battle_won", 1);
  await updateDailyMissionProgress(supabase, context.userId, config, "idle_stage_cleared", 1);

  const nextSave: GameSaveSnapshot = {
    ...save,
    gold: nextGold,
    gems: nextGems,
    xp: nextXp,
    playerLevel: leveled.playerLevel,
    currentStage: stageFlow.currentStage,
    highestStage: stageFlow.highestStage,
    totalBattlesWon: nextTotalBattlesWon,
  };
  await upsertLegacyPlayerSaveMirror(supabase, context.userId, nextSave);
  if (equipmentDrop != null) {
    if (reward.materialId != null && reward.materials > 0) {
      await upsertUserMaterialQuantity(supabase, context.userId, reward.materialId, nextSave.fragments[reward.materialId] ?? reward.materials);
    } else {
      await insertUserInventoryItem(supabase, context.userId, equipmentDrop.item);
    }
  }
  const persistedProgress = await loadPlayerProgressDebugRow(supabase, context.userId);
  const persistedSave = await loadPlayerSaveDebugRow(supabase, context.userId);
  logger.debug("[battle_resolve] persisted", {
    userId: context.userId,
    stageId: input.stageId,
    battleSessionId: input.battleSessionId,
    currentStage: nextSave.currentStage,
    highestStage: nextSave.highestStage,
    gold: nextSave.gold,
    gems: nextSave.gems,
    xp: nextSave.xp,
    playerLevel: nextSave.playerLevel,
    persistedProgress,
    persistedSave: persistedSave == null
      ? null
      : "error" in persistedSave
        ? persistedSave
      : {
          currentStage: persistedSave.save?.currentStage ?? persistedSave.save?.current_stage ?? null,
          highestStage: persistedSave.save?.highestStage ?? persistedSave.save?.highest_stage ?? null,
          gold: persistedSave.save?.gold ?? null,
          gems: persistedSave.save?.gems ?? null,
          xp: persistedSave.save?.xp ?? null,
          updatedAt: persistedSave.updated_at ?? null,
        },
  });

  const response = {
    ok: true,
    success: true,
    stageId: input.stageId,
    result: input.result,
    reward,
    progressionReward,
    heroProgress,
    rewards_applied: {
      gold: reward.gold,
      gems: reward.gems,
      xp: reward.xp,
      materials: reward.materials,
      material_id: reward.materialId,
      equipment_items: reward.equipmentItems,
    },
    gold_added: reward.gold,
    gems_added: reward.gems,
    xp_added: reward.xp,
    new_gold: nextSave.gold,
    new_gems: nextSave.gems,
    new_xp: nextSave.xp,
    new_level: nextSave.playerLevel,
    completed_stage: currentStage.stage_key,
    unlocked_next_stage: stageFlow.currentStage,
    progression: {
      previousPlayerLevel,
      currentPlayerLevel: leveled.playerLevel,
      currentXp: nextXp,
      levelUpRewards: progressionReward.levelUpRewards,
      gemsGranted: progressionReward.gemsGranted,
      currentStage: stageFlow.currentStage,
      highestStage: stageFlow.highestStage,
      totalBattlesWon: nextTotalBattlesWon,
    },
    save: {
      gold: nextSave.gold,
      gems: nextSave.gems,
      xp: nextSave.xp,
      playerLevel: nextSave.playerLevel,
      currentStage: nextSave.currentStage,
      highestStage: nextSave.highestStage,
      totalBattlesWon: nextSave.totalBattlesWon,
      schemaVersion: nextSave.schemaVersion,
      levelUpRewards: progressionReward.levelUpRewards,
      gemsGranted: progressionReward.gemsGranted,
    },
  };

  await completeIdempotentOperation(supabase, context.userId, input.requestId, response);
  return response;
}

async function loadStageDefinitions(supabase: SupabaseClient) {
  const { data, error } = await supabase
    .from("stage_definitions")
    .select("*")
    .eq("is_enabled", true)
    .order("sort_order", { ascending: true })
    .returns<StageDefinitionRow[]>();
  if (error) throw new Error(error.message);
  return data ?? [];
}

async function buildBattleTeamSnapshot(
  supabase: SupabaseClient,
  userId: string,
  teamSlots: StartBattleInput["teamSlots"],
) {
  const normalizedSlots = normalizeBattleTeamSlots(teamSlots);
  if (normalizedSlots.length !== 3) {
    throw new HttpModuleError(400, "invalid_battle_team", "battle_start", "La batalla requiere exactamente 3 cartas.");
  }

  const cardIds = normalizedSlots.map((slot) => slot.userCardId);
  const { data, error } = await supabase
    .from("user_cards")
    .select("id,user_id,character_id,card_type,variant,rarity,level,stars,ascension,awakening")
    .eq("user_id", userId)
    .in("id", cardIds)
    .returns<BattleStartCardRow[]>();
  if (error) throw new Error(error.message);

  const cardsById = new Map((data ?? []).map((row) => [row.id, row] as const));
  if (cardsById.size !== cardIds.length) {
    throw new HttpModuleError(404, "battle_team_card_not_found", "battle_start", "Una o mas cartas del equipo no pertenecen al jugador.");
  }

  const teamParts: string[] = [];
  let teamPower = 0;
  for (const slot of normalizedSlots) {
    const card = cardsById.get(slot.userCardId);
    if (card == null) {
      throw new HttpModuleError(404, "battle_team_card_not_found", "battle_start", "Carta del equipo no encontrada.");
    }
    const cardType = resolveCatalogCardType(card.card_type, card.variant);
    const rarity = normalizeCardRarity(card.rarity ?? "basic");
    const level = Math.max(1, Math.floor(card.level || 1));
    const stars = Math.max(1, Math.floor(card.stars || getCardStarsForLevel(cardType, rarity, level)));
    const ascension = Math.max(0, Math.floor(card.ascension || 0));
    const awakening = Math.max(0, Math.floor(card.awakening || 0));
    teamPower += estimateBattleCardPower(card.character_id, cardType, rarity, level, stars, ascension, awakening);
    teamParts.push([
      slot.boardSlot,
      card.id,
      card.character_id,
      cardType,
      rarity,
      level,
      stars,
      ascension,
      awakening,
    ].join(":"));
  }

  return {
    teamHash: stableSha256(teamParts.join("|")),
    teamPower,
  };
}

function normalizeBattleTeamSlots(teamSlots: StartBattleInput["teamSlots"]) {
  const seenCards = new Set<string>();
  const seenBoardSlots = new Set<number>();
  const normalized: Array<{ userCardId: string; boardSlot: number }> = [];
  for (const rawSlot of teamSlots) {
    const userCardId = String(rawSlot.userCardId ?? "").trim();
    const boardSlot = Math.trunc(Number(rawSlot.boardSlot));
    if (!userCardId || !Number.isInteger(boardSlot) || boardSlot < 0 || boardSlot > 8) {
      throw new HttpModuleError(400, "invalid_battle_team", "battle_start", "Equipo de batalla invalido.");
    }
    if (seenCards.has(userCardId) || seenBoardSlots.has(boardSlot)) {
      throw new HttpModuleError(400, "duplicate_battle_team_slot", "battle_start", "Equipo de batalla duplicado.");
    }
    seenCards.add(userCardId);
    seenBoardSlots.add(boardSlot);
    normalized.push({ userCardId, boardSlot });
  }
  return normalized.sort((left, right) => left.boardSlot - right.boardSlot);
}

function estimateBattleCardPower(
  characterId: string,
  cardType: CardCatalogType,
  rarity: CardBalanceRarity,
  level: number,
  stars: number,
  ascension: number,
  awakening: number,
) {
  const stats = getCardFinalStats(characterId, cardType, level, ascension, { ad: 0, ap: 0, hp: 0 });
  const rarityMultiplier: Record<CardBalanceRarity, number> = {
    basic: 1,
    epic: 1.18,
    legendary: 1.38,
    mythic: 1.65,
  };
  const basePower = stats.hp * 0.18 + Math.max(stats.ad, stats.ap) * 2.4 + Math.min(stats.ad, stats.ap) * 0.8;
  return Math.max(1, Math.floor(basePower * rarityMultiplier[rarity] + stars * 55 + awakening * 120));
}

function stableSha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function resolveStageTargetPower(stage: StageDefinitionRow) {
  return positiveIntFromKeys(stage, ["target_pm", "chapter_boss_pm"], 0);
}

function assertStageUnlocked(
  stageDefinitions: StageDefinitionRow[],
  stageId: string,
  currentStage: string,
  highestStage: string,
  module: "battle_start" | "battle_resolve",
) {
  const orderedKeys = stageDefinitions.map((row) => row.stage_key).filter((key) => key.trim().length > 0);
  const stageIndex = orderedKeys.indexOf(normalizeStageKey(stageId, stageId));
  const currentIndex = orderedKeys.indexOf(normalizeStageKey(currentStage, currentStage));
  const highestIndex = orderedKeys.indexOf(normalizeStageKey(highestStage, highestStage));
  if (stageIndex < 0) {
    throw new HttpModuleError(404, "stage_not_found", module, "Stage not found.");
  }
  if (stageIndex > Math.max(currentIndex, highestIndex, 0)) {
    throw new HttpModuleError(409, "stage_locked", module, "Stage bloqueado por progreso.");
  }
}

async function lockBattleSession(supabase: SupabaseClient, userId: string, battleSessionId: string) {
  const { data, error } = await supabase
    .from("battle_sessions")
    .select("id,user_id,mode,stage_id,team_hash,team_power,target_power,min_duration_seconds,request_id,started_at,expires_at,consumed_at")
    .eq("id", battleSessionId)
    .eq("user_id", userId)
    .maybeSingle<BattleSessionRow>();
  if (error) throw new Error(error.message);
  if (data == null) {
    throw new HttpModuleError(404, "battle_session_not_found", "battle_resolve", "Sesion de batalla no encontrada.");
  }
  return data;
}

function validateBattleSession(session: BattleSessionRow, stageId: string, durationSeconds?: number) {
  if (session.mode !== "campaign") {
    throw new HttpModuleError(400, "battle_session_mode_mismatch", "battle_resolve", "Sesion de batalla invalida.");
  }
  if (session.stage_id !== stageId) {
    throw new HttpModuleError(400, "battle_session_stage_mismatch", "battle_resolve", "La sesion no corresponde a este stage.");
  }
  if (session.consumed_at != null) {
    throw new HttpModuleError(409, "battle_session_consumed", "battle_resolve", "Esta batalla ya fue cerrada.");
  }
  if (new Date(session.expires_at).getTime() <= Date.now()) {
    throw new HttpModuleError(409, "battle_session_expired", "battle_resolve", "La sesion de batalla expiro.");
  }
  const measuredDuration = Number.isFinite(durationSeconds)
    ? Math.max(0, Number(durationSeconds))
    : Math.max(0, (Date.now() - new Date(session.started_at).getTime()) / 1000);
  if (measuredDuration + 0.75 < Math.max(0, session.min_duration_seconds)) {
    throw new HttpModuleError(409, "battle_duration_too_short", "battle_resolve", "La batalla se cerro demasiado rapido.");
  }
  const requiredPower = Math.max(1, Math.floor(Math.max(0, session.target_power) * 0.55));
  if (session.target_power > 0 && session.team_power < requiredPower) {
    throw new HttpModuleError(409, "battle_team_power_too_low", "battle_resolve", "El equipo no cumple el minimo de poder.");
  }
}

async function consumeBattleSession(supabase: SupabaseClient, userId: string, battleSessionId: string) {
  const { data, error } = await supabase
    .from("battle_sessions")
    .update({ consumed_at: new Date().toISOString() })
    .eq("id", battleSessionId)
    .eq("user_id", userId)
    .is("consumed_at", null)
    .select("id")
    .maybeSingle<{ id: string }>();
  if (error) throw new Error(error.message);
  if (data == null) {
    throw new HttpModuleError(409, "battle_session_consume_failed", "battle_resolve", "No se pudo consumir la sesion de batalla.");
  }
}

function resolveStageDefinition(stageDefinitions: StageDefinitionRow[], stageId: string) {
  const normalizedStageId = normalizeStageKey(stageId);
  return stageDefinitions.find((row) => row.stage_key === normalizedStageId) ?? null;
}

function buildBattleReward(stage: StageDefinitionRow, isReplay: boolean): BattleReward {
  if (isReplay) {
    const clearGold = positiveIntFromKeys(stage, ["gold_reward", "reward_gold", "clear_gold"], 2500);
    return { gold: Math.max(2500, Math.floor(clearGold * 0.35)), gems: 0, xp: 0, materials: 0, materialId: null, equipmentItems: [] };
  }
  const sortOrder = Number.isFinite(stage.sort_order) ? Number(stage.sort_order) : 0;
  const fallbackGold = 22000 + sortOrder * 6000;
  const fallbackXp = 25 + sortOrder * 10;
  return {
    gold: positiveIntFromKeys(stage, ["gold_reward", "reward_gold", "clear_gold"], fallbackGold),
    gems: positiveIntFromKeys(stage, ["gems_reward", "reward_gems", "clear_gems"], 0),
    xp: positiveIntFromKeys(stage, ["xp_reward", "reward_xp", "battle_xp", "clear_xp"], fallbackXp),
    materials: 0,
    materialId: null,
    equipmentItems: [],
  };
}

function isDuplicateEquipmentDrop(save: GameSaveSnapshot, item: EquipmentItem) {
  const itemRarity = normalizeEquipmentRarity(item.rarity);
  return save.inventory.some((candidate) =>
    candidate.equipmentKey === item.equipmentKey &&
    normalizeEquipmentRarity(candidate.rarity) === itemRarity
  );
}

function buildEquipmentDropForStage(stageKey: string, isReplay: boolean): { item: EquipmentItem; reward: EquipmentRewardItem } | null {
  if (isReplay) return null;
  const stageParts = parseStageKey(stageKey);
  if (stageParts == null) return null;
  if (!isEquipmentDropStage(stageParts.chapter, stageParts.stage)) return null;

  const rarity = rollEquipmentRarityForChapter(stageParts.chapter, stableHash(`${stageKey}:rarity`));
  const definition = pickEquipmentDefinition(stageParts.chapter, stageParts.stage);
  const tier = Math.max(1, Math.min(4, 1 + Math.floor((stageParts.chapter - 1) / 4)));
  const stats = buildEquipmentStats(definition, rarity, tier);
  const item: EquipmentItem = {
    id: randomUUID(),
    slot: definition.slot,
    rarity,
    name: definition.name,
    equipmentKey: definition.key,
    family: definition.family,
    tier,
    equippedToCharacterId: null,
    ad: stats.ad,
    hp: stats.hp,
    ap: stats.ap,
    atk: stats.ad,
    def: stats.ap,
  };
  return {
    item,
    reward: {
      id: item.id,
      equipmentKey: definition.key,
      name: definition.name,
      slot: definition.slot,
      rarity,
      tier,
      ad: stats.ad,
      ap: stats.ap,
      hp: stats.hp,
    },
  };
}

function isEquipmentDropStage(chapter: number, stage: number) {
  const dropCount = 2 + (stableHash(`chapter:${chapter}:drop_count`) % 2);
  const selectedStages = new Set<number>();
  let salt = 0;
  while (selectedStages.size < dropCount && salt < 64) {
    selectedStages.add((stableHash(`chapter:${chapter}:drop_stage:${salt}`) % 17) + 1);
    salt += 1;
  }
  return selectedStages.has(stage);
}

function rollEquipmentRarityForChapter(chapter: number, hash: number): EquipmentRarity {
  const roll = hash % 10_000;
  const epicChance = Math.min(4200, 650 + chapter * 230);
  const legendaryChance = Math.min(1800, Math.max(0, (chapter - 2) * 120));
  const mythicChance = Math.min(450, Math.max(0, (chapter - 6) * 35));
  if (roll < mythicChance) return "mythic";
  if (roll < mythicChance + legendaryChance) return "legendary";
  if (roll < mythicChance + legendaryChance + epicChance) return "epic";
  return "basic";
}

function pickEquipmentDefinition(chapter: number, stage: number): EquipmentDefinition {
  const index = stableHash(`equipment:${chapter}:${stage}`) % EQUIPMENT_ITEMS.length;
  return EQUIPMENT_ITEMS[index]!;
}

function parseStageKey(stageKey: string): { chapter: number; stage: number } | null {
  const match = /world_(\d+)_stage_(\d+)/i.exec(String(stageKey).trim());
  if (!match) return null;
  return {
    chapter: Math.max(1, Number(match[1]) || 1),
    stage: Math.max(1, Number(match[2]) || 1),
  };
}

function stableHash(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

async function applyHeroBattleXp(
  supabase: SupabaseClient,
  userId: string,
  save: GameSaveSnapshot,
  stageKey: string,
  isReplay: boolean,
) {
  const teamCharacterIds = (save.team ?? []).filter((characterId): characterId is string => typeof characterId === "string" && characterId.trim().length > 0);
  if (teamCharacterIds.length === 0) {
    return {
      grantedXpPerHero: 0,
      leveledCards: [] as Array<{ characterId: string; fromLevel: number; toLevel: number; finalXp: number; finalStats: ReturnType<typeof getCardFinalStats> }>,
    };
  }

  const chapterNumber = extractChapterNumber(stageKey);
  const baseHeroXp = isReplay ? 45 : 120;
  const grantedXpPerHero = Math.max(1, Math.floor(baseHeroXp * Math.pow(1.2, Math.max(0, chapterNumber - 1))));

  const { data, error } = await supabase
    .from("user_cards")
    .select("id,character_id,card_type,variant,rarity,level,xp,stars,ascension,awakening,fragments,energy,max_energy")
    .eq("user_id", userId)
    .in("character_id", teamCharacterIds)
    .returns<UserCardProgressRow[]>();
  if (error) throw new Error(error.message);

  const baseRowsByCharacter = new Map<string, UserCardProgressRow>();
  for (const row of data ?? []) {
    const cardType = resolveCatalogCardType(row.card_type, row.variant);
    if (cardType !== "BASE") continue;
    if (!baseRowsByCharacter.has(row.character_id)) {
      baseRowsByCharacter.set(row.character_id, row);
    }
  }

  const leveledCards: Array<{ characterId: string; fromLevel: number; toLevel: number; finalXp: number; finalStats: ReturnType<typeof getCardFinalStats> }> = [];
  const updates: Array<Promise<unknown>> = [];

  for (const characterId of teamCharacterIds) {
    const row = baseRowsByCharacter.get(characterId);
    if (!row) continue;

    const rarity = normalizeCardRarity(row.rarity ?? "basic");
    const cardType: CardCatalogType = "BASE";
    let level = Math.max(1, Math.floor(row.level || 1));
    let xp = Math.max(0, Math.floor(row.xp || 0));
    const ascension = Math.max(0, Math.floor(row.ascension || 0));
    const fromLevel = level;

    if (canCardGainXp(cardType, rarity, level, ascension)) {
      xp += grantedXpPerHero;
      while (canCardGainXp(cardType, rarity, level, ascension)) {
        const xpRequired = getCardXpForNextLevel(level);
        if (xp < xpRequired) break;
        xp -= xpRequired;
        level += 1;
        const ascensionCap = getCardLevelCapForAscension(cardType, rarity, ascension);
        const maxLevel = getCardMaxLevel(cardType, rarity);
        if (level >= ascensionCap || level >= maxLevel) {
          level = Math.min(level, Math.min(ascensionCap, maxLevel));
          if (!canCardGainXp(cardType, rarity, level, ascension)) {
            xp = 0;
          }
          break;
        }
      }
    }

    const stars = getCardStarsForLevel(cardType, rarity, level);
    const currentCharacter: OwnedCharacter | undefined = save.characters[characterId];
    save.characters[characterId] = {
      id: characterId,
      level,
      xp,
      stars,
      ascension,
      awakening: Math.max(0, Math.floor(row.awakening || currentCharacter?.awakening || 0)),
      fragments: Math.max(0, Math.floor(row.fragments || currentCharacter?.fragments || 0)),
      equipment: currentCharacter?.equipment ?? {},
      energy: Math.max(0, Math.floor(row.energy ?? currentCharacter?.energy ?? 0)),
      maxEnergy: Math.max(1, Math.floor(row.max_energy ?? currentCharacter?.maxEnergy ?? 100)),
    };

    updates.push(
      Promise.resolve(
        supabase
          .from("user_cards")
          .update({
            level,
            xp,
            stars,
            updated_at: new Date().toISOString(),
          })
          .eq("user_id", userId)
          .eq("id", row.id),
      ),
    );

    leveledCards.push({
      characterId,
      fromLevel,
      toLevel: level,
      finalXp: xp,
      finalStats: getCardFinalStats(characterId, cardType, level, ascension, getEquipmentBonusForCharacter(save, characterId)),
    });
  }

  if (updates.length > 0) {
    const results = await Promise.all(updates);
    for (const result of results) {
      const typed = result as { error?: { message?: string } | null };
      if (typed?.error) throw new Error(typed.error.message ?? "No se pudo persistir XP de carta.");
    }
  }

  return {
    grantedXpPerHero,
    leveledCards,
  };
}

function getEquipmentBonusForCharacter(save: GameSaveSnapshot, characterId: string) {
  const equipment = save.characters[characterId]?.equipment ?? {};
  return Object.values(equipment).reduce(
    (bonus, item) => ({
      ad: bonus.ad + Math.max(0, Math.floor(Number(item?.ad ?? item?.atk ?? 0) || 0)),
      ap: bonus.ap + Math.max(0, Math.floor(Number(item?.ap ?? item?.def ?? 0) || 0)),
      hp: bonus.hp + Math.max(0, Math.floor(Number(item?.hp ?? 0) || 0)),
    }),
    { ad: 0, ap: 0, hp: 0 },
  );
}

function resolveStageFlow(
  stageDefinitions: StageDefinitionRow[],
  clearedStageId: string,
  priorCurrentStage: string,
  priorHighestStage: string,
) {
  const orderedKeys = stageDefinitions.map((row) => row.stage_key).filter((key) => key.trim().length > 0);
  const normalizedClearedStageId = normalizeStageKey(clearedStageId, clearedStageId);
  const normalizedPriorCurrentStage = normalizeStageKey(priorCurrentStage, normalizedClearedStageId);
  const normalizedPriorHighestStage = normalizeStageKey(priorHighestStage, normalizedClearedStageId);
  const clearedIndex = orderedKeys.indexOf(normalizedClearedStageId);
  const priorCurrentIndex = orderedKeys.indexOf(normalizedPriorCurrentStage);
  const priorHighestIndex = orderedKeys.indexOf(normalizedPriorHighestStage);
  const isReplay = priorCurrentIndex >= 0 && clearedIndex >= 0 && clearedIndex < priorCurrentIndex;

  if (isReplay) {
    const safeCurrentStage = priorCurrentIndex >= 0 ? orderedKeys[priorCurrentIndex] : normalizedClearedStageId;
    const safeHighestStage = priorHighestIndex >= 0 ? orderedKeys[priorHighestIndex] : normalizedClearedStageId;
    return {
      currentStage: safeCurrentStage,
      highestStage: safeHighestStage,
      isReplay,
    };
  }

  const highestIndex = Math.max(clearedIndex, priorHighestIndex, 0);
  const nextStage = orderedKeys[clearedIndex + 1] ?? normalizedClearedStageId;

  return {
    currentStage: nextStage,
    highestStage: orderedKeys[highestIndex] ?? normalizedClearedStageId,
    isReplay,
  };
}

function extractChapterNumber(stageKey: string) {
  const match = /world_(\d+)_stage_(\d+)/i.exec(String(stageKey).trim());
  if (!match) return 1;
  return Math.max(1, Number(match[1]) || 1);
}

function resolveCatalogCardType(cardType: string | null, variant: string | null): CardCatalogType {
  const normalizedType = String(cardType ?? "").trim().toUpperCase();
  const normalizedVariant = String(variant ?? "").trim().toLowerCase();
  return normalizedType === "DEFINITIVA" || normalizedVariant === "definitive" ? "DEFINITIVA" : "BASE";
}

function positiveIntFromKeys(source: object, keys: string[], fallback: number) {
  const indexed = source as Record<string, unknown>;
  for (const key of keys) {
    const raw = indexed[key];
    const value = Number(raw);
    if (Number.isFinite(value) && value >= 0) {
      return Math.floor(value);
    }
  }
  return Math.max(0, Math.floor(fallback));
}

async function loadPlayerSave(supabase: SupabaseClient, userId: string) {
  const { data, error } = await supabase
    .from("player_saves")
    .select("save")
    .eq("user_id", userId)
    .maybeSingle<PlayerSaveRow>();
  if (error) throw new Error(error.message);
  return normalizeGameSave(data?.save ?? createInitialGameSave());
}

async function loadPlayerProgressRow(supabase: SupabaseClient, userId: string, save: GameSaveSnapshot) {
  const { data, error } = await supabase
    .from("player_progress")
    .select("player_level, xp, current_stage, highest_stage, total_battles_won")
    .eq("user_id", userId)
    .maybeSingle<PlayerProgressRow>();
  if (error) throw new Error(error.message);
  if (data == null) {
    return {
      player_level: save.playerLevel,
      xp: save.xp,
      current_stage: normalizeStageKey(save.currentStage, save.currentStage),
      highest_stage: normalizeStageKey(save.highestStage, save.highestStage),
      total_battles_won: save.totalBattlesWon,
    };
  }

  const normalizedProgressCurrent = normalizeStageKey(data.current_stage, save.currentStage);
  const normalizedProgressHighest = normalizeStageKey(data.highest_stage, save.highestStage);
  const mergedCurrent =
    compareStageKeys(save.currentStage, normalizedProgressCurrent) > 0
      ? normalizeStageKey(save.currentStage, save.currentStage)
      : normalizedProgressCurrent;
  const mergedHighest =
    compareStageKeys(save.highestStage, normalizedProgressHighest) > 0
      ? normalizeStageKey(save.highestStage, save.highestStage)
      : normalizedProgressHighest;

  return {
    ...data,
    current_stage: mergedCurrent,
    highest_stage: mergedHighest,
  };
}

async function upsertLegacyPlayerSaveMirror(supabase: SupabaseClient, userId: string, save: GameSaveSnapshot) {
  const { error } = await supabase.from("player_saves").upsert(
    {
      user_id: userId,
      save,
      save_version: save.schemaVersion,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  );
  if (error) throw new Error(error.message);
}

async function insertUserInventoryItem(supabase: SupabaseClient, userId: string, item: EquipmentItem) {
  const { error } = await supabase.from("user_inventory").insert({
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
    equipped_to_card_id: null,
    updated_at: new Date().toISOString(),
  });
  if (error) throw new Error(error.message);
}

async function upsertUserMaterialQuantity(supabase: SupabaseClient, userId: string, materialId: string, quantity: number) {
  const { error } = await supabase.from("user_materials").upsert(
    {
      user_id: userId,
      material_id: materialId,
      quantity: Math.max(0, Math.floor(quantity)),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,material_id" },
  );
  if (error) throw new Error(error.message);
}

async function loadPlayerProgressDebugRow(supabase: SupabaseClient, userId: string) {
  const { data, error } = await supabase
    .from("player_progress")
    .select("player_level, xp, current_stage, highest_stage, total_battles_won, updated_at")
    .eq("user_id", userId)
    .maybeSingle<PlayerProgressDebugRow>();
  if (error) {
    return { error: error.message };
  }
  return data;
}

async function loadPlayerSaveDebugRow(supabase: SupabaseClient, userId: string) {
  const { data, error } = await supabase
    .from("player_saves")
    .select("save, updated_at")
    .eq("user_id", userId)
    .maybeSingle<PlayerSaveDebugRow>();
  if (error) {
    return { error: error.message };
  }
  return data;
}

async function beginIdempotentOperation(
  supabase: SupabaseClient,
  userId: string,
  operation: string,
  requestId: string,
) {
  assertRequestId(requestId, "battle_resolve");
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
    throw new HttpModuleError(400, "request_id_reused", "battle_resolve", "requestId already used for another operation.");
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

function assertRequestId(requestId: string, module: "battle_start" | "battle_resolve") {
  const value = requestId.trim();
  if (!/^[a-zA-Z0-9_-]{8,80}$/.test(value)) {
    throw new HttpModuleError(400, "invalid_request_id", module, "Invalid requestId.");
  }
}

function assertUuid(value: string, module: "battle_start" | "battle_resolve") {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value ?? "").trim())) {
    throw new HttpModuleError(400, "invalid_battle_session_id", module, "Invalid battleSessionId.");
  }
}
