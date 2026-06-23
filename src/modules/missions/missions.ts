import type { SupabaseClient } from "@supabase/supabase-js";

import type { ClaimMissionInput, GodotAuthedRequestContext } from "../../contracts.js";
import { HttpModuleError } from "../../errors.js";
import { createInitialGameSave, normalizeGameSave, type GameSaveSnapshot } from "../bootstrap/game-save.js";
import {
  ensureBootstrapMonetizationFoundation,
  ensureDailyMissionSnapshotState,
  getBootstrapMonetizationConfig,
  getUtcResetDate,
  type MonetizationConfigLite,
  updateDailyMissionProgress,
} from "../bootstrap/monetization-foundation.js";
import { createServiceSupabaseClient } from "../../supabase.js";

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

export async function getMissionsDedicated(context: GodotAuthedRequestContext): Promise<unknown> {
  const supabase = createServiceSupabaseClient();
  await ensureBootstrapMonetizationFoundation(supabase, context.userId);
  const config = await getBootstrapMonetizationConfig(supabase);
  const resetDate = getUtcResetDate();
  await ensureDailyMissionSnapshotState(supabase, context.userId, config, resetDate);

  return await buildMissionSnapshotResponse(supabase, context.userId, config, resetDate);
}

export async function claimMissionDedicated(
  context: GodotAuthedRequestContext,
  input: ClaimMissionInput,
): Promise<unknown> {
  const supabase = createServiceSupabaseClient();
  const operation = "claim_mission_v1:%s".replace("%s", input.missionId);
  const replay = await beginIdempotentOperation(supabase, context.userId, operation, input.requestId);
  if (replay.status === "replayed") {
    if (replay.response == null) {
      throw new HttpModuleError(409, "operation_in_progress", "mission_claim", "El claim de mision todavia esta procesandose. Intenta otra vez en unos segundos.");
    }
    return replay.response;
  }

  await ensureBootstrapMonetizationFoundation(supabase, context.userId);
  const config = await getBootstrapMonetizationConfig(supabase);
  const resetDate = getUtcResetDate();
  await ensureDailyMissionSnapshotState(supabase, context.userId, config, resetDate);

  const definition = config.dailyMissions.find((mission) => mission.missionId === input.missionId && mission.isEnabled);
  if (!definition) {
    throw new HttpModuleError(404, "mission_not_found", "mission_claim", "Mission not found.");
  }

  const state = await loadMissionState(supabase, context.userId, input.missionId, resetDate);
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

  const { error: economyError } = await supabase
    .from("user_economy")
    .update({
      gold: nextGold,
      gems: nextGems,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", context.userId);
  if (economyError) throw new Error(economyError.message);

  const { error: missionError } = await supabase
    .from("user_daily_mission_state")
    .update({
      claimed: true,
      reward_gold_granted: grantedGold,
      reward_gems_granted: grantedGems,
      reward_points_granted: grantedPoints,
      reward_capped: false,
    })
    .eq("user_id", context.userId)
    .eq("mission_id", input.missionId)
    .eq("reset_date", resetDate);
  if (missionError) throw new Error(missionError.message);

  if (input.missionId !== "complete_10_daily_missions") {
    await updateDailyMissionProgress(supabase, context.userId, config, "daily_mission_completed_other", 1);
  }

  const save = await updateLegacyPlayerSaveMirror(supabase, context.userId, {
    gold: nextGold,
    gems: nextGems,
  });

  const snapshot = await buildMissionSnapshotResponse(supabase, context.userId, config, resetDate);
  const response = {
    ok: true,
    missionId: input.missionId,
    reward: {
      gold: grantedGold,
      gems: grantedGems,
      points: grantedPoints,
    },
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

async function buildMissionSnapshotResponse(
  supabase: SupabaseClient,
  userId: string,
  config: MonetizationConfigLite,
  resetDate: string,
) {
  const rows = await loadMissionStateRows(supabase, userId, resetDate);
  const rowsById = new Map(rows.map((row) => [row.mission_id, row]));

  const missions = config.dailyMissions
    .filter((mission) => mission.isEnabled)
    .map((mission) => {
      const row = rowsById.get(mission.missionId);
      const progress = row?.progress ?? 0;
      const target = row?.target ?? mission.target;
      return {
        missionId: mission.missionId,
        eventKey: mission.eventKey,
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
        sortOrder: mission.sortOrder,
      };
    })
    .sort((left, right) => left.sortOrder - right.sortOrder);

  return {
    ok: true,
    resetDate,
    missions,
  };
}

async function loadMissionStateRows(supabase: SupabaseClient, userId: string, resetDate: string) {
  const { data, error } = await supabase
    .from("user_daily_mission_state")
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
  if (error) throw new Error(error.message);
  return data ?? [];
}

async function loadMissionState(supabase: SupabaseClient, userId: string, missionId: string, resetDate: string) {
  const { data, error } = await supabase
    .from("user_daily_mission_state")
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
  if (error) throw new Error(error.message);
  return data;
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
  if (error) throw new Error(error.message);

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
  if (upsertError) throw new Error(upsertError.message);

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
  if (readError || !data) throw new Error(insertError.message);
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
  if (error) throw new Error(error.message);
}

function assertRequestId(requestId: string) {
  const value = requestId.trim();
  if (!/^[a-zA-Z0-9_-]{8,80}$/.test(value)) {
    throw new HttpModuleError(400, "invalid_request_id", "mission_claim", "Invalid requestId.");
  }
}
