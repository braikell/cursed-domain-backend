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

const AFK_GOLD_PER_HOUR = 200;
const AFK_GEMS_PER_HOUR = 1;
const AFK_MAX_HOURS = 8;

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
  hours: number;
  cappedHours: number;
}

export async function getAfkStatusDedicated(context: GodotAuthedRequestContext): Promise<unknown> {
  const supabase = createServiceSupabaseClient();
  await ensureBootstrapMonetizationFoundation(supabase, context.userId);

  const afkState = await loadUserAfkRow(supabase, context.userId);
  const serverNow = new Date();
  const lastClaimedAt = afkState.last_claimed_at ? new Date(afkState.last_claimed_at) : serverNow;
  const reward = buildAfkRewardPreview(lastClaimedAt, serverNow);

  return {
    ok: true,
    lastClaimedAt: lastClaimedAt.toISOString(),
    claimableAt: new Date(lastClaimedAt.getTime() + AFK_MAX_HOURS * 60 * 60 * 1000).toISOString(),
    serverNow: serverNow.toISOString(),
    maxHours: AFK_MAX_HOURS,
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
  const now = new Date();
  const lastClaimedAt = afkState.last_claimed_at ? new Date(afkState.last_claimed_at) : now;
  const reward = buildAfkRewardPreview(lastClaimedAt, now);

  const nextGold = economy.gold + reward.gold;
  const nextGems = economy.gems + reward.gems;
  const nowIso = now.toISOString();

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

  await updateDailyMissionProgress(supabase, context.userId, config, "claim_afk", 1);

  const save = await updateLegacyPlayerSaveMirror(supabase, context.userId, {
    gold: nextGold,
    gems: nextGems,
    lastAfkAt: now.getTime(),
  });

  const response = {
    ok: true,
    requestId: input.requestId,
    reward,
    lastClaimedAt: nowIso,
    save: {
      gold: save.gold,
      gems: save.gems,
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

function buildAfkRewardPreview(lastClaimedAt: Date, serverNow: Date): AfkRewardPreview {
  const elapsedMs = Math.max(0, serverNow.getTime() - lastClaimedAt.getTime());
  const elapsedHours = elapsedMs / (60 * 60 * 1000);
  const cappedHours = Math.min(AFK_MAX_HOURS, elapsedHours);

  return {
    gold: Math.max(0, Math.floor(cappedHours * AFK_GOLD_PER_HOUR)),
    gems: Math.max(0, Math.floor(cappedHours * AFK_GEMS_PER_HOUR)),
    hours: roundAfkHours(elapsedHours),
    cappedHours: roundAfkHours(cappedHours),
  };
}

function roundAfkHours(value: number) {
  return Math.round(value * 1_000_000) / 1_000_000;
}

async function updateLegacyPlayerSaveMirror(
  supabase: SupabaseClient,
  userId: string,
  patch: Pick<GameSaveSnapshot, "gold" | "gems" | "lastAfkAt">,
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
