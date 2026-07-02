import type { SupabaseClient } from "@supabase/supabase-js";

import type { ClaimAfkInput, GodotAuthedRequestContext } from "../../contracts.js";
import { HttpModuleError } from "../../errors.js";
import { createInitialGameSave, normalizeGameSave, type GameSaveSnapshot } from "../bootstrap/game-save.js";
import {
  ensureBootstrapMonetizationFoundation,
  getBootstrapMonetizationConfig,
  updateDailyMissionProgress,
} from "../bootstrap/monetization-foundation.js";
import { createServiceSupabaseClient } from "../../supabase.js";
import { buildEquipmentMaterialId } from "../equipment/balance.js";
import { normalizeStageKey, toLegacyStageKey } from "../bootstrap/game-save.js";

const AFK_GOLD_PER_HOUR = 200;
const AFK_GEMS_PER_HOUR = 1;
const AFK_XP_PER_HOUR = 32;
const AFK_MATERIALS_PER_HOUR = 1;
const AFK_MAX_HOURS = 72;
const AFK_PREMIUM_BONUS_MULTIPLIER = 1.5;
const AFK_PREMIUM_ENABLED = false;

interface UserAfkRow {
  last_claimed_at: string | null;
  accumulated_gold: number | null;
  accumulated_gems: number | null;
  config_version: number | null;
  updated_at: string | null;
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
  total_battles_won: number | null;
}

interface PlayerSaveRow {
  save: GameSaveSnapshot;
  save_version: number;
}

interface IdempotencyRow {
  operation: string;
  response: unknown | null;
}

interface AfkRewardPreview {
  gold: number;
  gems: number;
  xp: number;
  materials: number;
  materialId: string;
  hours: number;
  cappedHours: number;
  premiumMultiplier: number;
  premiumActive: boolean;
}

interface AfkOrigin {
  stageKey: string;
  stageLabel: string;
  stageName: string;
  materialId: string;
}

export async function getAfkStatusDedicated(context: GodotAuthedRequestContext): Promise<unknown> {
  const supabase = createServiceSupabaseClient();
  await ensureBootstrapMonetizationFoundation(supabase, context.userId);

  const afkState = await loadUserAfkRow(supabase, context.userId);
  const save = await loadPlayerSave(supabase, context.userId);
  const progress = await loadPlayerProgressRow(supabase, context.userId, save);
  const origin = resolveAfkOrigin(progress.highest_stage ?? progress.current_stage ?? save.highestStage);
  const serverNow = new Date();
  const lastClaimedAt = afkState.last_claimed_at ? new Date(afkState.last_claimed_at) : serverNow;
  const reward = buildAfkRewardPreview(lastClaimedAt, serverNow, origin.materialId);

  return {
    ok: true,
    lastClaimedAt: lastClaimedAt.toISOString(),
    claimableAt: new Date(lastClaimedAt.getTime() + AFK_MAX_HOURS * 60 * 60 * 1000).toISOString(),
    serverNow: serverNow.toISOString(),
    maxHours: AFK_MAX_HOURS,
    premium: {
      active: AFK_PREMIUM_ENABLED,
      multiplier: AFK_PREMIUM_ENABLED ? AFK_PREMIUM_BONUS_MULTIPLIER : 1,
      configuredMultiplier: AFK_PREMIUM_BONUS_MULTIPLIER,
    },
    origin,
    reward,
  };
}

export async function claimAfkDedicated(
  context: GodotAuthedRequestContext,
  input: ClaimAfkInput,
): Promise<unknown> {
  const supabase = createServiceSupabaseClient();
  const operation = "claim_afk_v1";
  const replay = await beginIdempotentOperation(supabase, context.userId, operation, input.requestId);
  if (replay.status === "replayed") {
    if (replay.response == null) {
      throw new HttpModuleError(409, "operation_in_progress", "afk_claim", "El claim AFK todavia esta procesandose. Intenta otra vez en unos segundos.");
    }
    return replay.response;
  }

  await ensureBootstrapMonetizationFoundation(supabase, context.userId);
  const config = await getBootstrapMonetizationConfig(supabase);
  const afkState = await loadUserAfkRow(supabase, context.userId);
  const economy = await loadUserEconomyRow(supabase, context.userId);
  const saveBefore = await loadPlayerSave(supabase, context.userId);
  const progress = await loadPlayerProgressRow(supabase, context.userId, saveBefore);
  const origin = resolveAfkOrigin(progress.highest_stage ?? progress.current_stage ?? saveBefore.highestStage);
  const now = new Date();
  const lastClaimedAt = afkState.last_claimed_at ? new Date(afkState.last_claimed_at) : now;
  const reward = buildAfkRewardPreview(lastClaimedAt, now, origin.materialId);

  const nextGold = economy.gold + reward.gold;
  const nextGems = economy.gems + reward.gems;
  const nextXp = Math.max(0, Math.floor(progress.xp || saveBefore.xp || 0)) + reward.xp;
  const nextPlayerLevel = resolvePlayerLevel(nextXp, progress.player_level || saveBefore.playerLevel);
  const nowIso = now.toISOString();
  const nextFragments = { ...saveBefore.fragments };
  if (reward.materials > 0) {
    nextFragments[reward.materialId] = Math.max(0, Math.floor(nextFragments[reward.materialId] ?? 0)) + reward.materials;
  }

  const { error: economyError } = await supabase
    .from("user_economy")
    .update({
      gold: nextGold,
      gems: nextGems,
      updated_at: nowIso,
    })
    .eq("user_id", context.userId);
  if (economyError) throw new Error(economyError.message);

  const { error: afkError } = await supabase
    .from("user_afk")
    .update({
      last_claimed_at: nowIso,
      accumulated_gold: 0,
      accumulated_gems: 0,
      config_version: afkState.config_version ?? config.configVersion,
      updated_at: nowIso,
    })
    .eq("user_id", context.userId);
  if (afkError) throw new Error(afkError.message);

  const { error: progressError } = await supabase.from("player_progress").upsert(
    {
      user_id: context.userId,
      player_level: nextPlayerLevel,
      xp: nextXp,
      current_stage: toLegacyStageKey(progress.current_stage ?? saveBefore.currentStage),
      highest_stage: toLegacyStageKey(progress.highest_stage ?? saveBefore.highestStage),
      total_battles_won: Math.max(0, Math.floor(progress.total_battles_won ?? saveBefore.totalBattlesWon ?? 0)),
      unlocked_slots: saveBefore.unlockedSlots,
      total_summons: saveBefore.totalSummons,
      updated_at: nowIso,
    },
    { onConflict: "user_id" },
  );
  if (progressError) throw new Error(progressError.message);

  if (reward.materials > 0) {
    await upsertUserMaterialQuantity(supabase, context.userId, reward.materialId, nextFragments[reward.materialId] ?? reward.materials, nowIso);
  }

  await updateDailyMissionProgress(supabase, context.userId, config, "claim_afk", 1);

  const save = await updateLegacyPlayerSaveMirror(supabase, context.userId, {
    gold: nextGold,
    gems: nextGems,
    xp: nextXp,
    playerLevel: nextPlayerLevel,
    fragments: nextFragments,
    lastAfkAt: now.getTime(),
  });

  const response = {
    ok: true,
    requestId: input.requestId,
    reward,
    origin,
    lastClaimedAt: nowIso,
    save: {
      gold: save.gold,
      gems: save.gems,
      xp: save.xp,
      playerLevel: save.playerLevel,
      fragments: save.fragments,
      lastAfkAt: save.lastAfkAt,
      schemaVersion: save.schemaVersion,
    },
  };

  await completeIdempotentOperation(supabase, context.userId, input.requestId, response);
  return response;
}

async function loadUserAfkRow(supabase: SupabaseClient, userId: string) {
  const { data, error } = await supabase
    .from("user_afk")
    .select("last_claimed_at, accumulated_gold, accumulated_gems, config_version, updated_at")
    .eq("user_id", userId)
    .maybeSingle<UserAfkRow>();
  if (error) throw new Error(error.message);
  return data ?? {
    last_claimed_at: null,
    accumulated_gold: 0,
    accumulated_gems: 0,
    config_version: null,
    updated_at: null,
  };
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

function buildAfkRewardPreview(lastClaimedAt: Date, serverNow: Date, materialId: string): AfkRewardPreview {
  const elapsedMs = Math.max(0, serverNow.getTime() - lastClaimedAt.getTime());
  const elapsedHours = elapsedMs / (60 * 60 * 1000);
  const cappedHours = Math.min(AFK_MAX_HOURS, elapsedHours);
  const rewardHours = cappedHours * (AFK_PREMIUM_ENABLED ? AFK_PREMIUM_BONUS_MULTIPLIER : 1);

  return {
    gold: Math.max(0, Math.floor(rewardHours * AFK_GOLD_PER_HOUR)),
    gems: Math.max(0, Math.floor(rewardHours * AFK_GEMS_PER_HOUR)),
    xp: Math.max(0, Math.floor(rewardHours * AFK_XP_PER_HOUR)),
    materials: Math.max(0, Math.floor(rewardHours * AFK_MATERIALS_PER_HOUR)),
    materialId,
    hours: roundAfkHours(elapsedHours),
    cappedHours: roundAfkHours(cappedHours),
    premiumMultiplier: AFK_PREMIUM_ENABLED ? AFK_PREMIUM_BONUS_MULTIPLIER : 1,
    premiumActive: AFK_PREMIUM_ENABLED,
  };
}

function roundAfkHours(value: number) {
  return Math.round(value * 1_000_000) / 1_000_000;
}

async function updateLegacyPlayerSaveMirror(
  supabase: SupabaseClient,
  userId: string,
  patch: Pick<GameSaveSnapshot, "gold" | "gems" | "xp" | "playerLevel" | "fragments" | "lastAfkAt">,
) {
  const { data, error } = await supabase
    .from("player_saves")
    .select("save, save_version")
    .eq("user_id", userId)
    .maybeSingle<PlayerSaveRow>();
  if (error) throw new Error(error.message);

  const current = data?.save ? normalizeGameSave(data.save) : createInitialGameSave();
  const nextSave: GameSaveSnapshot = {
    ...current,
    gold: patch.gold,
    gems: patch.gems,
    xp: patch.xp,
    playerLevel: patch.playerLevel,
    fragments: patch.fragments,
    lastAfkAt: patch.lastAfkAt,
  };

  const { error: upsertError } = await supabase.from("player_saves").upsert(
    {
      user_id: userId,
      save: nextSave,
      save_version: nextSave.schemaVersion,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  );
  if (upsertError) throw new Error(upsertError.message);

  return nextSave;
}

async function loadPlayerSave(supabase: SupabaseClient, userId: string) {
  const { data, error } = await supabase
    .from("player_saves")
    .select("save, save_version")
    .eq("user_id", userId)
    .maybeSingle<PlayerSaveRow>();
  if (error) throw new Error(error.message);
  return data?.save ? normalizeGameSave(data.save) : createInitialGameSave();
}

async function loadPlayerProgressRow(supabase: SupabaseClient, userId: string, save: GameSaveSnapshot) {
  const { data, error } = await supabase
    .from("player_progress")
    .select("player_level, xp, current_stage, highest_stage, total_battles_won")
    .eq("user_id", userId)
    .maybeSingle<PlayerProgressRow>();
  if (error) throw new Error(error.message);
  return data ?? {
    player_level: save.playerLevel,
    xp: save.xp,
    current_stage: save.currentStage,
    highest_stage: save.highestStage,
    total_battles_won: save.totalBattlesWon,
  };
}

async function upsertUserMaterialQuantity(
  supabase: SupabaseClient,
  userId: string,
  materialId: string,
  quantity: number,
  nowIso: string,
) {
  const { error } = await supabase.from("user_materials").upsert(
    {
      user_id: userId,
      material_id: materialId,
      quantity: Math.max(0, Math.floor(quantity)),
      updated_at: nowIso,
    },
    { onConflict: "user_id,material_id" },
  );
  if (error) throw new Error(error.message);
}

function resolveAfkOrigin(rawStageKey: unknown): AfkOrigin {
  const stageKey = normalizeStageKey(rawStageKey, "world_1_stage_1");
  const match = /^world_(\d+)_stage_(\d+)$/i.exec(stageKey);
  const chapter = match ? Math.max(1, Number(match[1]) || 1) : 1;
  const stage = match ? Math.max(1, Number(match[2]) || 1) : 1;
  return {
    stageKey,
    stageLabel: `${chapter}-${stage}`,
    stageName: resolveAfkStageName(chapter),
    materialId: resolveAfkMaterialId(chapter),
  };
}

function resolveAfkStageName(chapter: number) {
  if (chapter >= 10) return "Dominio del Eclipse";
  if (chapter >= 7) return "Abismo Carmesi";
  if (chapter >= 4) return "Ruinas del Vacio";
  return "Santuario de la Caida";
}

function resolveAfkMaterialId(chapter: number) {
  const slots = ["weapon", "helmet", "armor", "boots", "accessory"] as const;
  return buildEquipmentMaterialId(slots[(Math.max(1, chapter) - 1) % slots.length]);
}

function resolvePlayerLevel(totalXp: number, startingLevel: number) {
  let level = Math.max(1, Math.floor(startingLevel || 1));
  while (totalXp >= xpRequiredForLevel(level + 1)) {
    level += 1;
  }
  return level;
}

function xpRequiredForLevel(level: number) {
  return Math.max(0, (level - 1) * 100);
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

  const { data, error: existingError } = await supabase
    .from("idempotency_keys")
    .select("operation, response")
    .eq("user_id", userId)
    .eq("request_id", requestId)
    .maybeSingle<IdempotencyRow>();
  if (existingError || !data) throw new Error(insertError.message);
  if (data.operation !== operation) {
    throw new HttpModuleError(400, "request_id_reused", "afk_claim", "requestId already used for another operation.");
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
    throw new HttpModuleError(400, "invalid_request_id", "afk_claim", "Invalid requestId.");
  }
}
