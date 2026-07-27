import type { CompleteIncursionInput, GodotAuthedRequestContext, StartIncursionInput } from "../../contracts.js";
import { HttpModuleError } from "../../errors.js";
import { logger } from "../../safe-logger.js";
import { createServiceSupabaseClient } from "../../supabase.js";
import {
  beginIdempotentOperation,
  completeIdempotentOperation,
} from "../battle/battle.js";
import {
  grantPlayerXpReward,
  type PlayerProgressionRewardResult,
} from "../progression/player-progression.js";
import {
  calculateIncursionRewards,
  INCURSION_ENTRY_COSTS,
  INCURSION_MAX_WAVES,
  INCURSION_SESSION_TTL_SECONDS,
  INCURSION_WAVE_DURATION_SECONDS,
} from "./balance.js";

const MAX_POSSIBLE_KILLS_PER_WAVE = 56;

interface IncursionSessionRow {
  id: string;
  user_id: string;
  mode: string;
  started_at: string;
  expires_at: string;
  consumed_at: string | null;
  min_duration_seconds: number;
  wave_limit: number | null;
}

function assertRequestId(requestId: string): void {
  if (!/^[a-zA-Z0-9_-]{8,80}$/.test(requestId.trim())) {
    throw new HttpModuleError(400, "invalid_request_id", "incursion_entry", "Invalid requestId.");
  }
}

function assertUuid(value: string, code: string): void {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new HttpModuleError(400, code, "incursion_complete", "Invalid incursion session.");
  }
}

export async function startIncursionDedicated(
  context: GodotAuthedRequestContext,
  input: StartIncursionInput,
): Promise<unknown> {
  assertRequestId(input.requestId);
  const cost = INCURSION_ENTRY_COSTS[input.currency];
  const supabase = createServiceSupabaseClient();
  const { data, error } = await supabase.rpc("start_incursion_session", {
    target_user_id: context.userId,
    target_request_id: input.requestId,
    target_currency: input.currency,
    target_cost: cost,
    session_ttl_seconds: INCURSION_SESSION_TTL_SECONDS,
    target_wave_limit: INCURSION_MAX_WAVES,
  });
  if (error) {
    const message = error.message.toLowerCase();
    if (message.includes("insufficient_funds")) {
      throw new HttpModuleError(400, "insufficient_funds", "incursion_entry", "No tienes recursos suficientes.");
    }
    if (message.includes("incursion_session_active")) {
      throw new HttpModuleError(409, "incursion_session_active", "incursion_entry", "Ya tienes una incursión activa.");
    }
    throw new Error(error.message);
  }
  const row = Array.isArray(data) ? data[0] : data;
  if (row == null || typeof row.session_id !== "string") {
    throw new Error("Incursion session RPC returned no session.");
  }
  return {
    ok: true,
    data: {
      incursionSessionId: row.session_id,
      startedAt: row.started_at,
      expiresAt: row.expires_at,
      currency: row.currency,
      cost: Number(row.cost),
      save: { gold: Number(row.gold), gems: Number(row.gems) },
      replay: row.replay === true,
    },
  };
}

function validateInput(waveReached: number, kills: number): void {
  if (waveReached < 0 || waveReached > 10) {
    throw new HttpModuleError(400, "invalid_wave", "incursion_complete", "Invalid wave number.");
  }
  if (kills < 0) {
    throw new HttpModuleError(400, "invalid_kills", "incursion_complete", "Invalid kill count.");
  }
  const maxKills = (waveReached + 1) * MAX_POSSIBLE_KILLS_PER_WAVE;
  if (kills > maxKills) {
    logger.warn("suspicious_kill_count", { waveReached, kills, maxKills });
  }
}

function validateResultType(resultType: CompleteIncursionInput["resultType"], waveReached: number): void {
  const normalized = resultType ?? "defeat";
  if (normalized === "victory" && waveReached < INCURSION_MAX_WAVES) {
    throw new HttpModuleError(400, "invalid_incursion_result", "incursion_complete", "La victoria requiere completar todas las oleadas.");
  }
  if (normalized === "extraction" && waveReached <= 0) {
    throw new HttpModuleError(400, "invalid_incursion_result", "incursion_complete", "La extraccion requiere avanzar en la incursión.");
  }
}

export async function completeIncursionDedicated(
  context: GodotAuthedRequestContext,
  input: CompleteIncursionInput,
): Promise<unknown> {
  const supabase = createServiceSupabaseClient();
  const userId = context.userId;
  const requestId = input.requestId;
  assertRequestId(requestId);
  assertUuid(input.incursionSessionId, "invalid_incursion_session");

  try {
    const idempotent = await beginIdempotentOperation(
      supabase,
      userId,
      `incursion_complete:${requestId}`,
      requestId,
    );
    if (idempotent.status === "replayed") {
      logger.info("incursion_idempotent_replay", { userId, requestId });
      return idempotent.response ?? { ok: true, replay: true };
    }

    const session = await loadIncursionSession(supabase, userId, input.incursionSessionId);
    validateIncursionSession(session, input.waveReached, input.kills, input.survivalTime);

    const waveReached = Math.max(0, Math.min(input.waveReached, INCURSION_MAX_WAVES));
    const kills = Math.max(0, input.kills ?? 0);

    validateInput(waveReached, kills);
    validateResultType(input.resultType, waveReached);

    await consumeIncursionSession(supabase, userId, input.incursionSessionId);

    const rewards = calculateIncursionRewards(waveReached);
    const gold = rewards.gold;
    const gems = rewards.gems;
    const xp = rewards.xp;

    if (gold === 0 && gems === 0 && xp === 0) {
      const empty = { ok: true, resultType: input.resultType ?? "defeat", waveReached, kills, save: null };
      await completeIdempotentOperation(supabase, userId, requestId, empty);
      return empty;
    }

    const xpResult: PlayerProgressionRewardResult = await grantPlayerXpReward(supabase, {
      userId,
      source: "incursion",
      sourceId: `wave_${waveReached}`,
      requestId,
      xpAmount: xp,
      economyReward: { gold, gems },
    });

    const response = {
      ok: true,
      resultType: input.resultType ?? "defeat",
      waveReached,
      kills,
      rewards: { gold, gems, xp },
      progression: {
        previousPlayerLevel: xpResult.levelBefore,
        currentPlayerLevel: xpResult.levelAfter,
        currentXp: xpResult.xpAfter,
        levelUpRewards: xpResult.levelUpRewards,
        gemsGranted: xpResult.gemsGranted,
      },
      save: xpResult.save,
    };

    await completeIdempotentOperation(supabase, userId, requestId, response);
    return response;
  } catch (error) {
    if (error instanceof HttpModuleError) throw error;
    logger.error("incursion_complete_failed", {
      userId,
      requestId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw new HttpModuleError(500, "incursion_complete_failed", "incursion_complete", "Failed to complete incursion.");
  }
}

async function loadIncursionSession(
  supabase: ReturnType<typeof createServiceSupabaseClient>,
  userId: string,
  sessionId: string,
): Promise<IncursionSessionRow> {
  const { data, error } = await supabase
    .from("battle_sessions")
    .select("id,user_id,mode,started_at,expires_at,consumed_at,min_duration_seconds,wave_limit")
    .eq("id", sessionId)
    .eq("user_id", userId)
    .maybeSingle<IncursionSessionRow>();
  if (error) throw new Error(error.message);
  if (data == null) {
    throw new HttpModuleError(404, "incursion_session_not_found", "incursion_complete", "Sesion de incursión no encontrada.");
  }
  return data;
}

function validateIncursionSession(
  session: IncursionSessionRow,
  waveReached: number,
  kills: number,
  survivalTime: number | undefined,
): void {
  if (session.mode !== "incursion") {
    throw new HttpModuleError(400, "incursion_session_mode_mismatch", "incursion_complete", "Sesion de incursión invalida.");
  }
  if (session.consumed_at != null) {
    throw new HttpModuleError(409, "incursion_session_consumed", "incursion_complete", "Esta incursión ya fue cerrada.");
  }
  const now = Date.now();
  const startedAt = new Date(session.started_at).getTime();
  const expiresAt = new Date(session.expires_at).getTime();
  const elapsed = Math.max(0, (now - startedAt) / 1000);
  if (!Number.isFinite(startedAt) || now >= expiresAt) {
    throw new HttpModuleError(409, "incursion_session_expired", "incursion_complete", "La sesión de incursión expiró.");
  }
  if (elapsed + 0.75 < Math.max(0, session.min_duration_seconds)) {
    throw new HttpModuleError(409, "incursion_duration_too_short", "incursion_complete", "La incursión terminó demasiado rápido.");
  }
  if (Number.isFinite(survivalTime) && Number(survivalTime) > elapsed + 10) {
    throw new HttpModuleError(400, "invalid_survival_time", "incursion_complete", "Tiempo de supervivencia inválido.");
  }
  const maxWaveByTime = Math.min(INCURSION_MAX_WAVES, Math.max(1, Math.floor(Math.max(0, elapsed - 3) / INCURSION_WAVE_DURATION_SECONDS) + 1));
  const maxWave = Math.min(session.wave_limit ?? INCURSION_MAX_WAVES, maxWaveByTime);
  if (waveReached < 0 || waveReached > maxWave) {
    throw new HttpModuleError(400, "invalid_wave_progress", "incursion_complete", "La oleada no coincide con el tiempo de la sesión.");
  }
  const maxKills = (Math.max(0, waveReached) + 1) * MAX_POSSIBLE_KILLS_PER_WAVE;
  if (kills < 0 || kills > maxKills) {
    throw new HttpModuleError(400, "invalid_kill_count", "incursion_complete", "La cantidad de kills no es válida.");
  }
}

async function consumeIncursionSession(
  supabase: ReturnType<typeof createServiceSupabaseClient>,
  userId: string,
  sessionId: string,
): Promise<void> {
  const { data, error } = await supabase
    .from("battle_sessions")
    .update({ consumed_at: new Date().toISOString() })
    .eq("id", sessionId)
    .eq("user_id", userId)
    .eq("mode", "incursion")
    .is("consumed_at", null)
    .select("id")
    .maybeSingle<{ id: string }>();
  if (error) throw new Error(error.message);
  if (data == null) {
    throw new HttpModuleError(409, "incursion_session_consume_failed", "incursion_complete", "No se pudo cerrar la sesión de incursión.");
  }
}
