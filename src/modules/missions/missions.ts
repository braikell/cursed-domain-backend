import type { SupabaseClient } from "@supabase/supabase-js";

import type { ClaimMissionInput, GodotAuthedRequestContext } from "../../contracts.js";
import { HttpModuleError } from "../../errors.js";
import { createInitialGameSave, normalizeGameSave, type GameSaveSnapshot } from "../bootstrap/game-save.js";
import {
  checkSeasonAllMissionsCompleted,
  ensureBootstrapMonetizationFoundation,
  ensureDailyMissionSnapshotState,
  ensureWeeklyMissionSnapshotState,
  ensureSeasonMissionSnapshotState,
  getBootstrapMonetizationConfig,
  getUtcResetDate,
  getUtcWeeklyResetDate,
  getUtcSeasonResetDate,
  type MissionDefinition,
  type MonetizationConfigLite,
  updateDailyMissionProgress,
} from "../bootstrap/monetization-foundation.js";
import { createServiceSupabaseClient } from "../../supabase.js";
import { getRewardLabel, addPackToken, addChoiceToken, getPackTokens, getChoiceTokens, consumePackToken, consumeChoiceToken, grantSpecificCard, getChoiceCardOptions } from "./mission-rewards.js";

interface MissionStateRow {
  mission_id: string;
  progress: number;
  target: number;
  claimed: boolean;
  reward_gold_configured: number;
  reward_gems_configured: number;
  reward_points_configured: number;
  reward_gold_granted: number;
  reward_gems_granted: number;
  reward_points_granted: number;
  reward_capped: boolean;
}

interface ChestStateRow {
  chest_id: string;
  required_points: number;
  claimed: boolean;
  reward_gold_configured: number;
  reward_gems_configured: number;
  reward_gold_granted: number;
  reward_gems_granted: number;
  reward_capped: boolean;
}

interface UserEconomyRow {
  gold: number;
  gems: number;
}

interface PlayerSaveRow {
  save: GameSaveSnapshot;
}

interface IdempotencyRow {
  operation: string;
  response: unknown | null;
}

type MissionScope = "daily" | "weekly" | "season";

interface MissionTableNames {
  missionTable: string;
  chestTable: string;
}

const SCOPE_TABLES: Record<MissionScope, MissionTableNames> = {
  daily: { missionTable: "user_daily_mission_state", chestTable: "user_daily_chest_state" },
  weekly: { missionTable: "user_weekly_mission_state", chestTable: "user_weekly_chest_state" },
  season: { missionTable: "user_season_mission_state", chestTable: "user_season_chest_state" },
};

function getResetDateForScope(scope: MissionScope): string {
  switch (scope) {
    case "daily": return getUtcResetDate();
    case "weekly": return getUtcWeeklyResetDate();
    case "season": return getUtcSeasonResetDate();
  }
}

function getMissionsForScope(config: MonetizationConfigLite, scope: MissionScope) {
  switch (scope) {
    case "daily": return config.dailyMissions;
    case "weekly": return config.weeklyMissions;
    case "season": return config.seasonMissions;
  }
}

function getChestsForScope(config: MonetizationConfigLite, scope: MissionScope) {
  switch (scope) {
    case "daily": return config.dailyChests;
    case "weekly": return config.weeklyChests;
    case "season": return config.seasonChests;
  }
}

async function ensureSnapshotForScope(supabase: SupabaseClient, userId: string, config: MonetizationConfigLite, resetDate: string, scope: MissionScope) {
  switch (scope) {
    case "daily": return ensureDailyMissionSnapshotState(supabase, userId, config, resetDate);
    case "weekly": return ensureWeeklyMissionSnapshotState(supabase, userId, config, resetDate);
    case "season": return ensureSeasonMissionSnapshotState(supabase, userId, config, resetDate);
  }
}

export async function getMissionsDedicated(context: GodotAuthedRequestContext): Promise<unknown> {
  const supabase = createServiceSupabaseClient();
  const config = await getBootstrapMonetizationConfig(supabase);

  const dailyDate = getUtcResetDate();
  const weeklyDate = getUtcWeeklyResetDate();
  const seasonDate = getUtcSeasonResetDate();

  await Promise.all([
    ensureDailyMissionSnapshotState(supabase, context.userId, config, dailyDate),
    ensureWeeklyMissionSnapshotState(supabase, context.userId, config, weeklyDate),
    ensureSeasonMissionSnapshotState(supabase, context.userId, config, seasonDate),
  ]);

  const [daily, weekly, season] = await Promise.all([
    buildMissionSnapshotResponse(supabase, context.userId, config, "daily"),
    buildMissionSnapshotResponse(supabase, context.userId, config, "weekly"),
    buildMissionSnapshotResponse(supabase, context.userId, config, "season"),
  ]);

  if (daily.missions.length > 0) {
    const tickets = daily.missions.filter((m: any) => m.rewardType !== "gold_gems");
    console.log("[MISSIONS] daily total:", daily.missions.length, "with tickets:", tickets.length);
    tickets.forEach((m: any) => console.log("[MISSIONS]   ticket:", m.missionId, "->", m.rewardType));
  }

  return {
    ok: true,
    daily,
    weekly,
    season,
  };
}

export async function claimMissionDedicated(
  context: GodotAuthedRequestContext,
  input: ClaimMissionInput & { scope?: MissionScope },
): Promise<unknown> {
  const scope: MissionScope = input.scope ?? "daily";
  const supabase = createServiceSupabaseClient();
  const operation = `claim_mission_${scope}_v1:%s`.replace("%s", input.missionId);
  const replay = await beginIdempotentOperation(supabase, context.userId, operation, input.requestId);
  if (replay.status === "replayed") {
    if (replay.response == null) {
      throw new HttpModuleError(409, "operation_in_progress", "mission_claim", "La mision todavia se esta procesando. Intenta de nuevo en unos segundos.");
    }
    return replay.response;
  }

  await ensureBootstrapMonetizationFoundation(supabase, context.userId);
  const config = await getBootstrapMonetizationConfig(supabase);
  const resetDate = getResetDateForScope(scope);
  await ensureSnapshotForScope(supabase, context.userId, config, resetDate, scope);

  const missions = getMissionsForScope(config, scope);
  const definition = missions.find((mission) => mission.missionId === input.missionId && mission.isEnabled);
  if (!definition) {
    throw new HttpModuleError(404, "mission_not_found", "mission_claim", "Mission not found.");
  }

  if (definition.missionId === "season_complete_all") {
    const allCompleted = await checkSeasonAllMissionsCompleted(supabase, context.userId, config);
    if (!allCompleted) {
      throw new HttpModuleError(409, "season_not_all_completed", "mission_claim", "No has completado todas las misiones de temporada.");
    }
  }

  const tables = SCOPE_TABLES[scope];
  const state = await loadMissionState(supabase, context.userId, input.missionId, resetDate, tables.missionTable);
  if (state == null) {
    throw new HttpModuleError(404, "mission_state_missing", "mission_claim", "Mission state not found.");
  }
  if (state.claimed) {
    throw new HttpModuleError(409, "mission_already_claimed", "mission_claim", "La mision ya fue reclamada.");
  }
  if (state.progress < state.target) {
    throw new HttpModuleError(409, "mission_not_completed", "mission_claim", "La mision todavia no esta completada.");
  }

  const economy = await loadUserEconomyRow(supabase, context.userId);
  const grantedGold = Math.max(0, state.reward_gold_configured);
  const grantedGems = Math.max(0, state.reward_gems_configured);
  const grantedPoints = Math.max(0, state.reward_points_configured);
  const nextGold = economy.gold + grantedGold;
  const nextGems = economy.gems + grantedGems;

  const rewardType = (definition as MissionDefinition).rewardType ?? "gold_gems";
  const rewardConfig = (definition as MissionDefinition).rewardConfig ?? {};

  let specialReward: unknown = null;
  let choiceOptions: unknown = null;

  if (rewardType.endsWith("_pack")) {
    const packId = (rewardConfig.packId as string) ?? "basicPack";
    await addPackToken(context.userId, packId, 1);
    specialReward = { type: "pack_token", packId, added: true };
  } else if (rewardType.startsWith("choice_")) {
    const choiceType = (rewardConfig.choiceType as string) ?? "legendary";
    const cardOptions = getChoiceCardOptions(choiceType);
    await addChoiceToken(context.userId, input.missionId, choiceType, cardOptions);
    choiceOptions = { choiceType, count: (rewardConfig.choiceCount as number) ?? 1, options: cardOptions };
    specialReward = { type: "choice_token", choiceType, pending: true };
  }

  const { error: economyError } = await supabase
    .from("user_economy")
    .update({
      gold: nextGold,
      gems: nextGems,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", context.userId);
  if (economyError) throw new HttpModuleError(500, "economy_update_failed", "mission_claim", economyError.message);

  const stateUpdate: Record<string, unknown> = {
    claimed: true,
    reward_gold_granted: grantedGold,
    reward_gems_granted: grantedGems,
    reward_points_granted: grantedPoints,
    reward_capped: false,
    reward_config: { rewardType, rewardConfig, grantedAt: new Date().toISOString() },
  };
  const { error: missionError } = await supabase
    .from(tables.missionTable)
    .update(stateUpdate)
    .eq("user_id", context.userId)
    .eq("mission_id", input.missionId)
    .eq("reset_date", resetDate);
  if (missionError) throw new HttpModuleError(500, "mission_state_update_failed", "mission_claim", missionError.message);

  if (scope === "daily" && input.missionId !== "complete_10_daily_missions") {
    await updateDailyMissionProgress(supabase, context.userId, config, "daily_mission_completed_other", 1);
  }

  if (scope === "season") {
    const seasonAllCompleted = await checkSeasonAllMissionsCompleted(supabase, context.userId, config);
    if (seasonAllCompleted && input.missionId !== "season_complete_all") {
      await updateDailyMissionProgress(supabase, context.userId, config, "season_all_missions_completed", 1);
    }
  }

  const save = await updateLegacyPlayerSaveMirror(supabase, context.userId, {
    gold: nextGold,
    gems: nextGems,
  });

  const snapshot = await buildMissionSnapshotResponse(supabase, context.userId, config, scope);
  const response = {
    ok: true,
    missionId: input.missionId,
    scope,
    rewardType,
    rewardLabel: getRewardLabel(rewardType),
    reward: {
      gold: grantedGold,
      gems: grantedGems,
      points: grantedPoints,
    },
    specialReward,
    choiceOptions,
    save: {
      gold: save.gold,
      gems: save.gems,
      schemaVersion: save.schemaVersion,
    },
    snapshot,
  };

  await completeIdempotentOperation(supabase, context.userId, input.requestId, response);
  return response;
}

export async function getChestsDedicated(context: GodotAuthedRequestContext, scope: MissionScope = "daily"): Promise<unknown> {
  const supabase = createServiceSupabaseClient();
  await ensureBootstrapMonetizationFoundation(supabase, context.userId);
  const config = await getBootstrapMonetizationConfig(supabase);
  const resetDate = getResetDateForScope(scope);
  await ensureSnapshotForScope(supabase, context.userId, config, resetDate, scope);

  return await buildChestSnapshotResponse(supabase, context.userId, config, scope);
}

export async function claimChestDedicated(
  context: GodotAuthedRequestContext,
  input: { requestId: string; chestId: string; scope?: MissionScope },
): Promise<unknown> {
  const scope: MissionScope = input.scope ?? "daily";
  const supabase = createServiceSupabaseClient();
  const operation = `claim_chest_${scope}_v1:%s`.replace("%s", input.chestId);
  const replay = await beginIdempotentOperation(supabase, context.userId, operation, input.requestId);
  if (replay.status === "replayed") {
    if (replay.response == null) {
      throw new HttpModuleError(409, "operation_in_progress", "chest_claim", "El claim del cofre todavia esta procesandose.");
    }
    return replay.response;
  }

  await ensureBootstrapMonetizationFoundation(supabase, context.userId);
  const config = await getBootstrapMonetizationConfig(supabase);
  const resetDate = getResetDateForScope(scope);
  await ensureSnapshotForScope(supabase, context.userId, config, resetDate, scope);

  const chests = getChestsForScope(config, scope);
  const definition = chests.find((chest) => chest.chestId === input.chestId && chest.isEnabled);
  if (!definition) {
    throw new HttpModuleError(404, "chest_not_found", "chest_claim", "Chest not found.");
  }

  const tables = SCOPE_TABLES[scope];
  const state = await loadChestState(supabase, context.userId, input.chestId, resetDate, tables.chestTable);
  if (state == null) {
    throw new HttpModuleError(404, "chest_state_missing", "chest_claim", "Chest state not found.");
  }
  if (state.claimed) {
    throw new HttpModuleError(409, "chest_already_claimed", "chest_claim", "El cofre ya fue reclamado.");
  }

  const missions = getMissionsForScope(config, scope);
  const totalPoints = await computeTotalPoints(supabase, context.userId, missions, resetDate, tables.missionTable);
  if (totalPoints < state.required_points) {
    throw new HttpModuleError(409, "chest_not_reachable", "chest_claim", "No tienes suficientes puntos para reclamar este cofre.");
  }

  const economy = await loadUserEconomyRow(supabase, context.userId);
  const grantedGold = Math.max(0, state.reward_gold_configured);
  const grantedGems = Math.max(0, state.reward_gems_configured);
  const nextGold = economy.gold + grantedGold;
  const nextGems = economy.gems + grantedGems;

  const { error: economyError } = await supabase
    .from("user_economy")
    .update({ gold: nextGold, gems: nextGems, updated_at: new Date().toISOString() })
    .eq("user_id", context.userId);
  if (economyError) throw new HttpModuleError(500, "economy_update_failed", "chest_claim", economyError.message);

  const { error: chestError } = await supabase
    .from(tables.chestTable)
    .update({
      claimed: true,
      reward_gold_granted: grantedGold,
      reward_gems_granted: grantedGems,
      reward_capped: false,
    })
    .eq("user_id", context.userId)
    .eq("chest_id", input.chestId)
    .eq("reset_date", resetDate);
  if (chestError) throw new HttpModuleError(500, "chest_state_update_failed", "chest_claim", chestError.message);

  const save = await updateLegacyPlayerSaveMirror(supabase, context.userId, { gold: nextGold, gems: nextGems });
  const snapshot = await buildChestSnapshotResponse(supabase, context.userId, config, scope);

  const response = {
    ok: true,
    chestId: input.chestId,
    scope,
    reward: { gold: grantedGold, gems: grantedGems },
    save: { gold: save.gold, gems: save.gems, schemaVersion: save.schemaVersion },
    snapshot,
  };

  await completeIdempotentOperation(supabase, context.userId, input.requestId, response);
  return response;
}

export async function claimAllMissionsDedicated(
  context: GodotAuthedRequestContext,
  input: { requestId: string; scope?: MissionScope },
): Promise<unknown> {
  const scope: MissionScope = input.scope ?? "daily";
  const supabase = createServiceSupabaseClient();
  const operation = `claim_all_missions_${scope}_v1:%s`.replace("%s", context.requestId ?? input.requestId);
  const replay = await beginIdempotentOperation(supabase, context.userId, operation, input.requestId);
  if (replay.status === "replayed") {
    if (replay.response == null) {
      throw new HttpModuleError(409, "operation_in_progress", "claim_all_missions", "El claim de todas las misiones todavia esta procesandose.");
    }
    return replay.response;
  }

  await ensureBootstrapMonetizationFoundation(supabase, context.userId);
  const config = await getBootstrapMonetizationConfig(supabase);
  const resetDate = getResetDateForScope(scope);
  await ensureSnapshotForScope(supabase, context.userId, config, resetDate, scope);

  const tables = SCOPE_TABLES[scope];
  const missions = getMissionsForScope(config, scope);
  const rows = await loadMissionStateRows(supabase, context.userId, resetDate, tables.missionTable);

  const completableRows = rows.filter(
    (row: MissionStateRow) => !row.claimed && row.progress >= row.target,
  );

  if (completableRows.length === 0) {
    const snapshot = await buildMissionSnapshotResponse(supabase, context.userId, config, scope);
    const response = { ok: true, claimedCount: 0, totalGold: 0, totalGems: 0, totalPoints: 0, snapshot };
    await completeIdempotentOperation(supabase, context.userId, input.requestId, response);
    return response;
  }

  let totalGold = 0;
  let totalGems = 0;
  let totalPoints = 0;

  for (const row of completableRows) {
    totalGold += Math.max(0, row.reward_gold_configured);
    totalGems += Math.max(0, row.reward_gems_configured);
    totalPoints += Math.max(0, row.reward_points_configured);
  }

  const economy = await loadUserEconomyRow(supabase, context.userId);
  const nextGold = economy.gold + totalGold;
  const nextGems = economy.gems + totalGems;

  const { error: economyError } = await supabase
    .from("user_economy")
    .update({ gold: nextGold, gems: nextGems, updated_at: new Date().toISOString() })
    .eq("user_id", context.userId);
  if (economyError) throw new HttpModuleError(500, "economy_update_failed", "claim_all_missions", economyError.message);

  const updatePromises = completableRows.map((row) =>
    supabase
      .from(tables.missionTable)
      .update({
        claimed: true,
        reward_gold_granted: Math.max(0, row.reward_gold_configured),
        reward_gems_granted: Math.max(0, row.reward_gems_configured),
        reward_points_granted: Math.max(0, row.reward_points_configured),
        reward_capped: false,
      })
      .eq("user_id", context.userId)
      .eq("mission_id", row.mission_id)
      .eq("reset_date", resetDate)
  );

  const batchResults = await Promise.all(updatePromises);
  for (const result of batchResults) {
    if (result.error) {
      throw new HttpModuleError(500, "mission_state_update_failed", "claim_all_missions", result.error.message);
    }
  }

  if (scope === "daily") {
    const nonChainCount = completableRows.filter((r: MissionStateRow) => r.mission_id !== "complete_10_daily_missions").length;
    if (nonChainCount > 0) {
      await updateDailyMissionProgress(supabase, context.userId, config, "daily_mission_completed_other", nonChainCount);
    }
  }

  const save = await updateLegacyPlayerSaveMirror(supabase, context.userId, { gold: nextGold, gems: nextGems });
  const snapshot = await buildMissionSnapshotResponse(supabase, context.userId, config, scope);

  const response = {
    ok: true,
    claimedCount: completableRows.length,
    totalGold,
    totalGems,
    totalPoints,
    save: { gold: save.gold, gems: save.gems, schemaVersion: save.schemaVersion },
    snapshot,
  };

  await completeIdempotentOperation(supabase, context.userId, input.requestId, response);
  return response;
}

async function buildMissionSnapshotResponse(
  supabase: SupabaseClient,
  userId: string,
  config: MonetizationConfigLite,
  scope: MissionScope,
) {
  const resetDate = getResetDateForScope(scope);
  const tables = SCOPE_TABLES[scope];
  const missions = getMissionsForScope(config, scope);
  const rows = await loadMissionStateRows(supabase, userId, resetDate, tables.missionTable);
  const rowsById = new Map<string, MissionStateRow>(
    rows.map((row: MissionStateRow) => [row.mission_id, row] as const),
  );

  const missionList = missions
    .filter((mission) => mission.isEnabled)
    .map((mission) => {
      const row = rowsById.get(mission.missionId);
      const progress = row?.progress ?? 0;
      const target = row?.target ?? mission.target;
      return {
        missionId: mission.missionId,
        eventKey: mission.eventKey,
        displayName: mission.displayName ?? mission.missionId,
        displayDescription: mission.displayDescription ?? "",
        progress,
        target,
        claimed: row?.claimed ?? false,
        completed: progress >= target,
        rewardGoldConfigured: row?.reward_gold_configured ?? mission.rewardGold,
        rewardGemsConfigured: row?.reward_gems_configured ?? mission.rewardGems,
        rewardPointsConfigured: row?.reward_points_configured ?? mission.rewardPoints,
        rewardGoldGranted: row?.reward_gold_granted ?? 0,
        rewardGemsGranted: row?.reward_gems_granted ?? 0,
        rewardPointsGranted: row?.reward_points_granted ?? 0,
        rewardCapped: row?.reward_capped ?? false,
        rewardType: mission.rewardType ?? "gold_gems",
        rewardConfig: mission.rewardConfig ?? {},
        sortOrder: mission.sortOrder,
      };
    })
    .sort((left, right) => left.sortOrder - right.sortOrder);

  return {
    resetDate,
    missions: missionList,
  };
}

async function buildChestSnapshotResponse(
  supabase: SupabaseClient,
  userId: string,
  config: MonetizationConfigLite,
  scope: MissionScope,
) {
  const resetDate = getResetDateForScope(scope);
  const tables = SCOPE_TABLES[scope];
  const chests = getChestsForScope(config, scope);
  const missions = getMissionsForScope(config, scope);
  const [chestRows, totalPoints] = await Promise.all([
    loadChestStateRows(supabase, userId, resetDate, tables.chestTable),
    computeTotalPoints(supabase, userId, missions, resetDate, tables.missionTable),
  ]);

  const rowsById = new Map<string, ChestStateRow>(
    chestRows.map((row: ChestStateRow) => [row.chest_id, row] as const),
  );

  const chestList = chests
    .filter((chest) => chest.isEnabled)
    .map((chest) => {
      const row = rowsById.get(chest.chestId);
      const requiredPoints = row?.required_points ?? chest.requiredPoints;
      const reachable = totalPoints >= requiredPoints;
      return {
        chestId: chest.chestId,
        requiredPoints,
        currentPoints: totalPoints,
        claimed: row?.claimed ?? false,
        reachable,
        rewardGoldConfigured: row?.reward_gold_configured ?? chest.rewardGold,
        rewardGemsConfigured: row?.reward_gems_configured ?? chest.rewardGems,
        rewardGoldGranted: row?.reward_gold_granted ?? 0,
        rewardGemsGranted: row?.reward_gems_granted ?? 0,
        rewardCapped: row?.reward_capped ?? false,
        sortOrder: chest.sortOrder,
      };
    })
    .sort((left, right) => left.sortOrder - right.sortOrder);

  return {
    resetDate,
    totalPoints,
    chests: chestList,
  };
}

async function computeTotalPoints(
  supabase: SupabaseClient,
  userId: string,
  missions: Array<{ missionId: string; eventKey: string; rewardPoints: number; target: number; sortOrder: number; isEnabled: boolean }>,
  resetDate: string,
  missionTable: string,
): Promise<number> {
  const rows = await loadMissionStateRows(supabase, userId, resetDate, missionTable);
  let total = 0;
  for (const row of rows) {
    if (row.progress >= row.target) {
      total += Math.max(0, row.reward_points_configured);
    }
  }
  return total;
}

async function loadMissionStateRows(supabase: SupabaseClient, userId: string, resetDate: string, tableName: string = "user_daily_mission_state") {
  const { data, error } = await supabase
    .from(tableName)
    .select([
      "mission_id",
      "progress",
      "target",
      "claimed",
      "reward_gold_configured",
      "reward_gems_configured",
      "reward_points_configured",
      "reward_gold_granted",
      "reward_gems_granted",
      "reward_points_granted",
      "reward_capped",
    ].join(","))
    .eq("user_id", userId)
    .eq("reset_date", resetDate)
    .returns<MissionStateRow[]>();
  if (error) throw new HttpModuleError(500, "mission_state_load_failed", "missions_status", error.message);
  return data ?? [];
}

async function loadChestStateRows(supabase: SupabaseClient, userId: string, resetDate: string, tableName: string) {
  const { data, error } = await supabase
    .from(tableName)
    .select("chest_id, required_points, claimed, reward_gold_configured, reward_gems_configured, reward_gold_granted, reward_gems_granted, reward_capped")
    .eq("user_id", userId)
    .eq("reset_date", resetDate)
    .returns<ChestStateRow[]>();
  if (error) throw new HttpModuleError(500, "chest_state_load_failed", "chests_status", error.message);
  return data ?? [];
}

async function loadMissionState(supabase: SupabaseClient, userId: string, missionId: string, resetDate: string, tableName: string = "user_daily_mission_state") {
  const { data, error } = await supabase
    .from(tableName)
    .select([
      "mission_id",
      "progress",
      "target",
      "claimed",
      "reward_gold_configured",
      "reward_gems_configured",
      "reward_points_configured",
      "reward_gold_granted",
      "reward_gems_granted",
      "reward_points_granted",
      "reward_capped",
    ].join(","))
    .eq("user_id", userId)
    .eq("mission_id", missionId)
    .eq("reset_date", resetDate)
    .maybeSingle<MissionStateRow>();
  if (error) throw new HttpModuleError(500, "mission_state_load_failed", "mission_claim", error.message);
  return data;
}

async function loadChestState(supabase: SupabaseClient, userId: string, chestId: string, resetDate: string, tableName: string) {
  const { data, error } = await supabase
    .from(tableName)
    .select("chest_id, required_points, claimed, reward_gold_configured, reward_gems_configured, reward_gold_granted, reward_gems_granted, reward_capped")
    .eq("user_id", userId)
    .eq("chest_id", chestId)
    .eq("reset_date", resetDate)
    .maybeSingle<ChestStateRow>();
  if (error) throw new HttpModuleError(500, "chest_state_load_failed", "chest_claim", error.message);
  return data;
}

async function loadUserEconomyRow(supabase: SupabaseClient, userId: string) {
  const { data, error } = await supabase
    .from("user_economy")
    .select("gold, gems")
    .eq("user_id", userId)
    .maybeSingle<UserEconomyRow>();
  if (error) throw new HttpModuleError(500, "economy_load_failed", "mission_claim", error.message);
  return data ?? { gold: 0, gems: 0 };
}

async function updateLegacyPlayerSaveMirror(
  supabase: SupabaseClient,
  userId: string,
  patch: Pick<GameSaveSnapshot, "gold" | "gems">,
) {
  const { data, error } = await supabase
    .from("player_saves")
    .select("save")
    .eq("user_id", userId)
    .maybeSingle<PlayerSaveRow>();
  if (error) throw new HttpModuleError(500, "player_save_load_failed", "mission_claim", error.message);

  const current = data?.save ? normalizeGameSave(data.save) : createInitialGameSave();
  const nextSave: GameSaveSnapshot = {
    ...current,
    gold: patch.gold,
    gems: patch.gems,
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
  if (upsertError) throw new HttpModuleError(500, "player_save_update_failed", "mission_claim", upsertError.message);

  return nextSave;
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
  if (readError || !data) throw new HttpModuleError(500, "idempotency_check_failed", "mission_claim", insertError.message);
  if (data.operation !== operation) {
    throw new HttpModuleError(400, "request_id_reused", "mission_claim", "requestId already used for another operation.");
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
  if (error) throw new HttpModuleError(500, "idempotency_complete_failed", "mission_claim", error.message);
}

function assertRequestId(requestId: string) {
  const value = requestId.trim();
  if (!/^[a-zA-Z0-9_-]{8,80}$/.test(value)) {
    throw new HttpModuleError(400, "invalid_request_id", "mission_claim", "Invalid requestId.");
  }
}

export async function getMissionTokensDedicated(context: GodotAuthedRequestContext): Promise<unknown> {
  const [packTokens, choiceTokens] = await Promise.all([
    getPackTokens(context.userId),
    getChoiceTokens(context.userId),
  ]);

  return {
    ok: true,
    packTokens,
    choiceTokens,
  };
}

export async function redeemPackTokenDedicated(
  context: GodotAuthedRequestContext,
  input: { requestId: string; packId: string },
): Promise<unknown> {
  const supabase = createServiceSupabaseClient();
  const consumed = await consumePackToken(context.userId, input.packId);
  if (!consumed) {
    throw new HttpModuleError(409, "no_pack_token", "mission_claim", "No tienes tokens de este sobre disponibles.");
  }

  return {
    ok: true,
    packId: input.packId,
    redeemed: true,
    message: "Token de sobre canjeado. Abre el sobre en la vista de invocacion.",
  };
}

export async function redeemChoiceTokenDedicated(
  context: GodotAuthedRequestContext,
  input: { requestId: string; tokenId: string; characterId: string; cardType: string },
): Promise<unknown> {
  const supabase = createServiceSupabaseClient();
  const token = await consumeChoiceToken(context.userId, input.tokenId);

  if (!token) {
    throw new HttpModuleError(404, "choice_token_not_found", "mission_claim", "Token de eleccion no encontrado.");
  }

  const result = await grantSpecificCard(supabase, context.userId, input.characterId, input.cardType as "base" | "definitiva");

  return {
    ok: true,
    tokenId: input.tokenId,
    card: result.card,
    message: "Carta concedida exitosamente.",
  };
}

export async function ultimateUsedDedicated(
  context: GodotAuthedRequestContext,
  input: { requestId: string; count?: number },
): Promise<unknown> {
  const supabase = createServiceSupabaseClient();
  const config = await getBootstrapMonetizationConfig(supabase);
  await ensureDailyMissionSnapshotState(supabase, context.userId, config, getUtcResetDate());

  const increment = Math.max(1, Math.floor(input.count ?? 1));
  await updateDailyMissionProgress(supabase, context.userId, config, "ultimate_used", increment);

  return { ok: true, tracked: true, count: increment };
}
