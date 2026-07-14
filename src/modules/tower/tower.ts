import type { SupabaseClient } from "@supabase/supabase-js";

import type { CompleteTowerFloorInput, GodotAuthedRequestContext } from "../../contracts.js";
import { HttpModuleError } from "../../errors.js";
import { createServiceSupabaseClient } from "../../supabase.js";
import {
  ensureBootstrapMonetizationFoundation,
  getBootstrapMonetizationConfig,
  updateDailyMissionProgress,
} from "../bootstrap/monetization-foundation.js";
import { grantPlayerXpReward } from "../progression/player-progression.js";

interface TowerFloorDefinitionRow {
  floor_number: number;
  floor_key: string;
  display_name: string;
  is_boss: boolean;
  enemy_count: number;
  enemy_grade_floor: string;
  enemy_grade_ceiling: string;
  target_pm: number;
  reward_gold: number;
  reward_gems: number;
  reward_xp: number;
  reward_equipment_guaranteed: boolean;
  replay_gold: number;
  replay_gems: number;
  replay_xp: number;
  sort_order: number;
}

interface UserTowerProgressRow {
  highest_floor: number;
  current_floor: number;
  total_clears: number;
  last_completed_floor: number;
}

interface UserTowerFloorClearRow {
  floor_number: number;
  clear_count: number;
  first_cleared_at: string | null;
  best_clear_seconds: number | null;
}

interface IdempotencyRow {
  operation: string;
  response: unknown | null;
}

export async function getTowerStatusDedicated(context: GodotAuthedRequestContext): Promise<unknown> {
  const supabase = createServiceSupabaseClient();
  await ensureBootstrapMonetizationFoundation(supabase, context.userId);
  const [floors, progress, clears] = await Promise.all([
    loadTowerFloors(supabase),
    ensureTowerProgress(supabase, context.userId),
    loadTowerClears(supabase, context.userId),
  ]);

  return buildTowerStatusResponse(floors, progress, clears);
}

export async function completeTowerFloorDedicated(
  context: GodotAuthedRequestContext,
  input: CompleteTowerFloorInput,
): Promise<unknown> {
  if (input.result !== "win") {
    throw new HttpModuleError(400, "unsupported_tower_result", "tower_complete_floor", "Only win result is supported.");
  }

  const supabase = createServiceSupabaseClient();
  const operation = `complete_tower_floor_v1:${input.floorNumber}:${input.result}`;
  const replay = await beginIdempotentOperation(supabase, context.userId, operation, input.requestId);
  if (replay.status === "replayed") {
    if (replay.response == null) {
      throw new HttpModuleError(409, "operation_in_progress", "tower_complete_floor", "La torre todavia esta procesandose. Intenta otra vez en unos segundos.");
    }
    return replay.response;
  }

  await ensureBootstrapMonetizationFoundation(supabase, context.userId);
  const [floors, progress, existingClear] = await Promise.all([
    loadTowerFloors(supabase),
    ensureTowerProgress(supabase, context.userId),
    loadTowerClear(supabase, context.userId, input.floorNumber),
  ]);

  const floor = floors.find((entry) => entry.floor_number === input.floorNumber);
  if (floor == null) {
    throw new HttpModuleError(404, "tower_floor_not_found", "tower_complete_floor", "Tower floor not found.");
  }

  const unlockedFloor = Math.max(1, progress.highest_floor + 1);
  if (floor.floor_number > unlockedFloor) {
    throw new HttpModuleError(409, "tower_floor_locked", "tower_complete_floor", "Este piso de la Torre Infinita aun esta bloqueado.");
  }

  const isFirstClear = existingClear == null || existingClear.clear_count <= 0;
  const rewardGold = isFirstClear ? floor.reward_gold : floor.replay_gold;
  const rewardGems = isFirstClear ? floor.reward_gems : floor.replay_gems;
  const rewardXp = isFirstClear ? floor.reward_xp : floor.replay_xp;
  const progressionReward = await grantPlayerXpReward(supabase, {
    userId: context.userId,
    source: "tower_floor",
    sourceId: floor.floor_key,
    requestId: input.requestId,
    xpAmount: rewardXp,
    economyReward: {
      gold: rewardGold,
      gems: rewardGems,
    },
  });
  const previousHighestFloor = progress.highest_floor;
  const highestFloor = Math.max(progress.highest_floor, floor.floor_number);
  const maxFloor = floors.reduce((max, entry) => Math.max(max, entry.floor_number), 0);
  const currentFloor = Math.min(maxFloor, Math.max(1, highestFloor + 1));
  const totalClears = progress.total_clears + 1;
  const now = new Date().toISOString();

  const { error: progressError } = await supabase.from("user_tower_progress").upsert(
    {
      user_id: context.userId,
      highest_floor: highestFloor,
      current_floor: currentFloor,
      total_clears: totalClears,
      last_completed_floor: floor.floor_number,
      updated_at: now,
    },
    { onConflict: "user_id" },
  );
  if (progressError) throw new Error(progressError.message);

  const { error: clearError } = await supabase.from("user_tower_floor_clears").upsert(
    {
      user_id: context.userId,
      floor_number: floor.floor_number,
      first_cleared_at: existingClear?.first_cleared_at ?? now,
      last_cleared_at: now,
      clear_count: Math.max(0, existingClear?.clear_count ?? 0) + 1,
      best_clear_seconds: existingClear?.best_clear_seconds ?? null,
    },
    { onConflict: "user_id,floor_number" },
  );
  if (clearError) throw new Error(clearError.message);

  const config = await getBootstrapMonetizationConfig(supabase);
  await updateDailyMissionProgress(supabase, context.userId, config, "tower_floor_cleared", 1);
  if (floor.is_boss) {
    await updateDailyMissionProgress(supabase, context.userId, config, "tower_boss_cleared", 1);
  }

  const response = {
    ok: true as const,
    floorNumber: floor.floor_number,
    floorKey: floor.floor_key,
    isFirstClear,
    isBoss: floor.is_boss,
    reward: {
      gold: rewardGold,
      gems: rewardGems,
      xp: rewardXp,
      equipmentItems: [] as unknown[],
    },
    progressionReward,
    progression: {
      previousHighestFloor,
      highestFloor,
      currentFloor,
      totalClears,
      currentXp: progressionReward.xpAfter,
      currentPlayerLevel: progressionReward.levelAfter,
      levelUpRewards: progressionReward.levelUpRewards,
      gemsGranted: progressionReward.gemsGranted,
    },
    save: {
      gold: progressionReward.save.gold,
      gems: progressionReward.save.gems,
      xp: progressionReward.save.xp,
      playerLevel: progressionReward.save.playerLevel,
      schemaVersion: progressionReward.save.schemaVersion,
    },
  };

  await completeIdempotentOperation(supabase, context.userId, input.requestId, response);
  return response;
}

async function loadTowerFloors(supabase: SupabaseClient) {
  const { data, error } = await supabase
    .from("tower_floor_definitions")
    .select([
      "floor_number",
      "floor_key",
      "display_name",
      "is_boss",
      "enemy_count",
      "enemy_grade_floor",
      "enemy_grade_ceiling",
      "target_pm",
      "reward_gold",
      "reward_gems",
      "reward_xp",
      "reward_equipment_guaranteed",
      "replay_gold",
      "replay_gems",
      "replay_xp",
      "sort_order",
    ].join(","))
    .eq("is_enabled", true)
    .order("sort_order", { ascending: true })
    .returns<TowerFloorDefinitionRow[]>();
  if (error) throw new Error(error.message);
  return data ?? [];
}

async function ensureTowerProgress(supabase: SupabaseClient, userId: string) {
  const { data, error } = await supabase
    .from("user_tower_progress")
    .select("highest_floor,current_floor,total_clears,last_completed_floor")
    .eq("user_id", userId)
    .maybeSingle<UserTowerProgressRow>();
  if (error) throw new Error(error.message);
  if (data != null) return data;

  const initial = {
    user_id: userId,
    highest_floor: 0,
    current_floor: 1,
    total_clears: 0,
    last_completed_floor: 0,
    updated_at: new Date().toISOString(),
  };
  const { error: insertError } = await supabase
    .from("user_tower_progress")
    .upsert(initial, { onConflict: "user_id" });
  if (insertError) throw new Error(insertError.message);
  return {
    highest_floor: initial.highest_floor,
    current_floor: initial.current_floor,
    total_clears: initial.total_clears,
    last_completed_floor: initial.last_completed_floor,
  };
}

async function loadTowerClears(supabase: SupabaseClient, userId: string) {
  const { data, error } = await supabase
    .from("user_tower_floor_clears")
    .select("floor_number,clear_count,first_cleared_at,best_clear_seconds")
    .eq("user_id", userId)
    .returns<UserTowerFloorClearRow[]>();
  if (error) throw new Error(error.message);
  return data ?? [];
}

async function loadTowerClear(supabase: SupabaseClient, userId: string, floorNumber: number) {
  const { data, error } = await supabase
    .from("user_tower_floor_clears")
    .select("floor_number,clear_count,first_cleared_at,best_clear_seconds")
    .eq("user_id", userId)
    .eq("floor_number", floorNumber)
    .maybeSingle<UserTowerFloorClearRow>();
  if (error) throw new Error(error.message);
  return data;
}

function buildTowerStatusResponse(
  floors: TowerFloorDefinitionRow[],
  progress: UserTowerProgressRow,
  clears: UserTowerFloorClearRow[],
) {
  const clearsByFloor = new Map(clears.map((row) => [row.floor_number, row] as const));
  const maxFloor = floors.reduce((max, floor) => Math.max(max, floor.floor_number), 0);
  const unlockedFloor = Math.max(1, progress.highest_floor + 1);
  return {
    ok: true as const,
    highestFloor: progress.highest_floor,
    currentFloor: Math.min(maxFloor, Math.max(1, progress.current_floor || unlockedFloor)),
    maxFloor,
    totalClears: progress.total_clears,
    floors: floors.map((floor) => {
      const clear = clearsByFloor.get(floor.floor_number);
      return {
        floorNumber: floor.floor_number,
        floorKey: floor.floor_key,
        displayName: floor.display_name,
        isBoss: floor.is_boss,
        enemyCount: floor.enemy_count,
        enemyGradeFloor: floor.enemy_grade_floor,
        enemyGradeCeiling: floor.enemy_grade_ceiling,
        targetPm: floor.target_pm,
        rewardGold: floor.reward_gold,
        rewardGems: floor.reward_gems,
        rewardXp: floor.reward_xp,
        rewardEquipmentGuaranteed: floor.reward_equipment_guaranteed,
        replayGold: floor.replay_gold,
        replayGems: floor.replay_gems,
        replayXp: floor.replay_xp,
        isUnlocked: floor.floor_number <= unlockedFloor,
        isCleared: (clear?.clear_count ?? 0) > 0,
        clearCount: clear?.clear_count ?? 0,
        bestClearSeconds: clear?.best_clear_seconds ?? null,
      };
    }),
  };
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
    .select("operation,response")
    .eq("user_id", userId)
    .eq("request_id", requestId)
    .maybeSingle<IdempotencyRow>();
  if (readError || !data) throw new Error(insertError.message);
  if (data.operation !== operation) {
    throw new HttpModuleError(400, "request_id_reused", "tower_complete_floor", "requestId already used for another operation.");
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
    throw new HttpModuleError(400, "invalid_request_id", "tower_complete_floor", "Invalid requestId.");
  }
}
