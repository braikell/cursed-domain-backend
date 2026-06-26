import type { SupabaseClient } from "@supabase/supabase-js";

import type { CompleteBattleInput, GodotAuthedRequestContext } from "../../contracts.js";
import { HttpModuleError } from "../../errors.js";
import {
  compareStageKeys,
  createInitialGameSave,
  normalizeGameSave,
  normalizeStageKey,
  toLegacyStageKey,
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

interface PlayerSaveRow {
  save: GameSaveSnapshot;
}

interface PlayerSaveDebugRow {
  save: Record<string, unknown> | null;
  updated_at?: string | null;
}

interface UserEconomyRow {
  gold: number;
  gems: number;
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

interface BattleReward {
  gold: number;
  gems: number;
  xp: number;
}

export async function completeBattleDedicated(
  context: GodotAuthedRequestContext,
  input: CompleteBattleInput,
): Promise<unknown> {
  if (input.result !== "win") {
    throw new HttpModuleError(400, "unsupported_battle_result", "battle_resolve", "Only win result is supported.");
  }

  const supabase = createServiceSupabaseClient();
  const operation = `complete_battle_v1:${input.stageId}:${input.result}`;
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

  const save = await loadPlayerSave(supabase, context.userId);
  const economy = await loadUserEconomyRow(supabase, context.userId);
  const progress = await loadPlayerProgressRow(supabase, context.userId, save);
  console.info("[battle_resolve] start", {
    userId: context.userId,
    stageId: input.stageId,
    requestId: input.requestId,
    currentStageBefore: progress.current_stage ?? save.currentStage,
    highestStageBefore: progress.highest_stage ?? save.highestStage,
    goldBefore: economy.gold,
    gemsBefore: economy.gems,
    xpBefore: progress.xp,
  });

  const stageFlow = resolveStageFlow(
    stageDefinitions,
    currentStage.stage_key,
    progress.current_stage ?? save.currentStage,
    progress.highest_stage ?? save.highestStage,
  );
  const reward = buildBattleReward(currentStage, stageFlow.isReplay);
  const heroProgress = await applyHeroBattleXp(supabase, context.userId, save, currentStage.stage_key, stageFlow.isReplay);
  const nextXp = progress.xp + reward.xp;
  const leveled = resolveLevelProgress(nextXp, progress.player_level);
  const nextGold = economy.gold + reward.gold;
  const nextGems = economy.gems + reward.gems;
  const nextTotalBattlesWon = Math.max(progress.total_battles_won, save.totalBattlesWon) + 1;
  console.info("[battle_resolve] computed", {
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
  });

  const { error: economyError } = await supabase.from("user_economy").upsert(
    {
      user_id: context.userId,
      gold: nextGold,
      gems: nextGems,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  );
  if (economyError) throw new Error(economyError.message);

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
  const persistedProgress = await loadPlayerProgressDebugRow(supabase, context.userId);
  const persistedSave = await loadPlayerSaveDebugRow(supabase, context.userId);
  console.info("[battle_resolve] persisted", {
    userId: context.userId,
    stageId: input.stageId,
    currentStage: nextSave.currentStage,
    highestStage: nextSave.highestStage,
    gold: nextSave.gold,
    gems: nextSave.gems,
    xp: nextSave.xp,
    playerLevel: nextSave.playerLevel,
    persistedProgress,
    persistedSave: persistedSave == null
      ? null
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
    heroProgress,
    rewards_applied: {
      gold: reward.gold,
      gems: reward.gems,
      xp: reward.xp,
      materials: 0,
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
      previousPlayerLevel: progress.player_level,
      currentPlayerLevel: leveled.playerLevel,
      currentXp: nextXp,
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

function resolveStageDefinition(stageDefinitions: StageDefinitionRow[], stageId: string) {
  const normalizedStageId = normalizeStageKey(stageId);
  return stageDefinitions.find((row) => row.stage_key === normalizedStageId) ?? null;
}

function buildBattleReward(stage: StageDefinitionRow, isReplay: boolean): BattleReward {
  if (isReplay) {
    const clearGold = positiveIntFromKeys(stage, ["gold_reward", "reward_gold", "clear_gold"], 2500);
    return { gold: Math.max(2500, Math.floor(clearGold * 0.35)), gems: 0, xp: 0 };
  }
  const sortOrder = Number.isFinite(stage.sort_order) ? Number(stage.sort_order) : 0;
  const fallbackGold = 22000 + sortOrder * 6000;
  const fallbackXp = 25 + sortOrder * 10;
  return {
    gold: positiveIntFromKeys(stage, ["gold_reward", "reward_gold", "clear_gold"], fallbackGold),
    gems: positiveIntFromKeys(stage, ["gems_reward", "reward_gems", "clear_gems"], 0),
    xp: positiveIntFromKeys(stage, ["xp_reward", "reward_xp", "battle_xp", "clear_xp"], fallbackXp),
  };
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

function resolveLevelProgress(totalXp: number, startingLevel: number) {
  let level = Math.max(1, startingLevel);
  while (totalXp >= xpRequiredForLevel(level + 1)) {
    level += 1;
  }
  return { playerLevel: level };
}

function xpRequiredForLevel(level: number) {
  return Math.max(0, (level - 1) * 100);
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

async function loadUserEconomyRow(supabase: SupabaseClient, userId: string) {
  const { data, error } = await supabase
    .from("user_economy")
    .select("gold, gems")
    .eq("user_id", userId)
    .maybeSingle<UserEconomyRow>();
  if (error) throw new Error(error.message);
  return data ?? { gold: 0, gems: 0 };
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
  assertRequestId(requestId);
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

function assertRequestId(requestId: string) {
  const value = requestId.trim();
  if (!/^[a-zA-Z0-9_-]{8,80}$/.test(value)) {
    throw new HttpModuleError(400, "invalid_request_id", "battle_resolve", "Invalid requestId.");
  }
}
