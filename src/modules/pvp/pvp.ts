import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  GodotAuthedRequestContext,
  PvpCompleteMatchInput,
  PvpStartMatchInput,
  PvpUpsertDefenseInput,
} from "../../contracts.js";
import { HttpModuleError } from "../../errors.js";
import { createServiceSupabaseClient } from "../../supabase.js";

type PvpLeague = "bronze" | "silver" | "gold";

interface PvpProfileRow {
  user_id: string;
  display_name: string;
  league: PvpLeague;
  rating: number;
  current_season_id?: string | null;
  season_rating?: number | null;
  season_best_rating?: number | null;
  wins: number;
  losses: number;
  defense_power: number;
  defense_snapshot: unknown;
  defense_updated_at: string | null;
  updated_at: string;
}

interface ProfileNameRow {
  display_name: string | null;
}

interface IdempotencyRow {
  operation: string;
  response: unknown | null;
}

interface PvpMatchRow {
  id: string;
  attacker_user_id: string;
  defender_user_id: string;
  status: "started" | "completed" | "expired";
  defender_snapshot: unknown;
  expires_at: string;
  created_at: string;
}

const DEFAULT_RATING = 1000;
const MATCHMAKING_LIMIT = 20;
const LEADERBOARD_LIMIT = 5;
const DAILY_SCORING_LIMIT = 30;
const DAILY_SAME_DEFENDER_LIMIT = 5;
const ACTIVE_MATCH_LIMIT = 2;
const MATCH_TTL_MINUTES = 20;
const PVP_PROFILE_SELECT =
  "user_id,display_name,league,rating,current_season_id,season_rating,season_best_rating,wins,losses,defense_power,defense_snapshot,defense_updated_at,updated_at";

export async function getPvpStatusDedicated(context: GodotAuthedRequestContext): Promise<unknown> {
  const supabase = createServiceSupabaseClient();
  const self = await ensurePvpProfile(supabase, context.userId);
  const [rivals, leaderboard] = await Promise.all([
    loadRivals(supabase, context.userId, self),
    loadLeaderboard(supabase),
  ]);

  return {
    ok: true as const,
    profile: toClientProfile(self),
    rivals: rivals.map((rival) => toClientRival(rival, context.userId)),
    leaderboard: leaderboard.map(toClientProfile),
    leagues: buildLeagueDefinitions(),
  };
}

export async function upsertPvpDefenseDedicated(
  context: GodotAuthedRequestContext,
  input: PvpUpsertDefenseInput,
): Promise<unknown> {
  assertRequestId(input.requestId, "pvp_upsert_defense");
  const snapshot = normalizeDefenseSnapshot(input.defenseSnapshot);
  const defensePower = Math.max(1, Math.trunc(input.defensePower));
  const snapshotPower = Math.max(1, Math.trunc(Number((snapshot as Record<string, unknown>).totalPm ?? defensePower)));
  const finalPower = Math.max(defensePower, snapshotPower);
  const supabase = createServiceSupabaseClient();
  const displayName = await resolveDisplayName(supabase, context.userId);
  const now = new Date().toISOString();

  const { data, error } = await supabase
    .from("user_pvp_profiles")
    .upsert(
      {
        user_id: context.userId,
        display_name: displayName,
        defense_power: finalPower,
        defense_snapshot: snapshot,
        defense_updated_at: now,
        updated_at: now,
      },
      { onConflict: "user_id" },
    )
    .select(PVP_PROFILE_SELECT)
    .single<PvpProfileRow>();
  if (error) throw new Error(error.message);

  return {
    ok: true as const,
    profile: toClientProfile(data),
  };
}

export async function startPvpMatchDedicated(
  context: GodotAuthedRequestContext,
  input: PvpStartMatchInput,
): Promise<unknown> {
  if (input.defenderUserId === context.userId) {
    throw new HttpModuleError(400, "pvp_self_match", "pvp_start_match", "No puedes combatir contra tu propia defensa.");
  }
  assertRequestId(input.requestId, "pvp_start_match");
  const supabase = createServiceSupabaseClient();
  const operation = `pvp_start_match_v1:${input.defenderUserId}`;
  const replay = await beginIdempotentOperation(supabase, context.userId, operation, input.requestId, "pvp_start_match");
  if (replay.status === "replayed") {
    if (replay.response == null) {
      throw new HttpModuleError(409, "operation_in_progress", "pvp_start_match", "El match PvP todavia se esta preparando.");
    }
    return replay.response;
  }

  await expireOldStartedMatches(supabase, context.userId);
  await pruneOldPvpMatches(supabase);
  const [attacker, defender] = await Promise.all([
    ensurePvpProfile(supabase, context.userId),
    loadPvpProfile(supabase, input.defenderUserId),
  ]);
  if (defender == null || defender.defense_power <= 0) {
    throw new HttpModuleError(404, "pvp_defender_not_found", "pvp_start_match", "El rival ya no tiene defensa PvP disponible.");
  }

  await assertPvpMatchLimits(supabase, context.userId, input.defenderUserId);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + MATCH_TTL_MINUTES * 60_000).toISOString();
  const { data, error } = await supabase
    .from("user_pvp_matches")
    .insert({
      attacker_user_id: context.userId,
      defender_user_id: input.defenderUserId,
      status: "started",
      season_id: currentSeasonId(now),
      defender_snapshot: defender.defense_snapshot,
      attacker_rating_before: attacker.rating,
      defender_rating_before: defender.rating,
      defender_power: defender.defense_power,
      created_at: now.toISOString(),
      expires_at: expiresAt,
    })
    .select("id,attacker_user_id,defender_user_id,status,defender_snapshot,expires_at,created_at")
    .single<PvpMatchRow>();
  if (error) throw new Error(error.message);

  const rival = toClientRival({ ...defender, defense_snapshot: data.defender_snapshot });
  const response = {
    ok: true as const,
    matchId: data.id,
    expiresAt: data.expires_at,
    rival: {
      ...rival,
      matchId: data.id,
      matchExpiresAt: data.expires_at,
    },
  };
  await completeIdempotentOperation(supabase, context.userId, input.requestId, response);
  return response;
}

export async function completePvpMatchDedicated(
  context: GodotAuthedRequestContext,
  input: PvpCompleteMatchInput,
): Promise<unknown> {
  assertRequestId(input.requestId, "pvp_complete_match");
  const supabase = createServiceSupabaseClient();
  const operation = `pvp_complete_match_v2:${input.matchId}:${input.result}`;
  const replay = await beginIdempotentOperation(supabase, context.userId, operation, input.requestId, "pvp_complete_match");
  if (replay.status === "replayed") {
    if (replay.response == null) {
      throw new HttpModuleError(409, "operation_in_progress", "pvp_complete_match", "El resultado PvP todavia se esta procesando.");
    }
    return replay.response;
  }

  const { data: rpcData, error: rpcError } = await supabase.rpc("complete_pvp_match_lite", {
    p_match_id: input.matchId,
    p_attacker_user_id: context.userId,
    p_result: input.result,
    p_attacker_power: Math.max(0, Math.trunc(input.attackerPower)),
    p_defender_power: Math.max(0, Math.trunc(input.defenderPower)),
  });
  if (rpcError) throw mapPvpRpcError(rpcError.message, "pvp_complete_match");

  const resultData = normalizeRpcObject(rpcData);
  const defenderUserId = strFromUnknown(resultData.defenderUserId);
  const [attackerData, defenderData] = await Promise.all([
    ensurePvpProfile(supabase, context.userId),
    defenderUserId ? loadPvpProfile(supabase, defenderUserId) : Promise.resolve(null),
  ]);
  const response = {
    ok: true as const,
    result: input.result,
    ratingDelta: intFromUnknown(resultData.ratingDelta, 0),
    ratingBefore: intFromUnknown(resultData.ratingBefore, attackerData.rating),
    ratingAfter: intFromUnknown(resultData.ratingAfter, attackerData.rating),
    seasonId: strFromUnknown(resultData.seasonId) || currentSeasonId(),
    seasonRatingBefore: intFromUnknown(resultData.seasonRatingBefore, attackerData.season_rating ?? attackerData.rating),
    seasonRatingAfter: intFromUnknown(resultData.seasonRatingAfter, attackerData.season_rating ?? attackerData.rating),
    seasonBestRating: intFromUnknown(resultData.seasonBestRating, attackerData.season_best_rating ?? attackerData.rating),
    profile: toClientProfile(attackerData),
    defender: defenderData == null ? null : toClientProfile(defenderData),
  };
  await completeIdempotentOperation(supabase, context.userId, input.requestId, response);
  return response;
}

async function ensurePvpProfile(supabase: SupabaseClient, userId: string) {
  const existing = await loadPvpProfile(supabase, userId);
  if (existing != null) return existing;

  const now = new Date().toISOString();
  const displayName = await resolveDisplayName(supabase, userId);
  const { data, error } = await supabase
    .from("user_pvp_profiles")
    .upsert(
      {
        user_id: userId,
        display_name: displayName,
        rating: DEFAULT_RATING,
        league: leagueForRating(DEFAULT_RATING),
        current_season_id: currentSeasonId(),
        season_rating: DEFAULT_RATING,
        season_best_rating: DEFAULT_RATING,
        wins: 0,
        losses: 0,
        defense_power: 0,
        defense_snapshot: {},
        updated_at: now,
      },
      { onConflict: "user_id" },
    )
    .select(PVP_PROFILE_SELECT)
    .single<PvpProfileRow>();
  if (error) throw new Error(error.message);
  return data;
}

async function loadPvpProfile(supabase: SupabaseClient, userId: string) {
  const { data, error } = await supabase
    .from("user_pvp_profiles")
    .select(PVP_PROFILE_SELECT)
    .eq("user_id", userId)
    .maybeSingle<PvpProfileRow>();
  if (error) throw new Error(error.message);
  return data;
}

async function loadRivals(supabase: SupabaseClient, userId: string, self: PvpProfileRow) {
  const { data, error } = await supabase
    .from("user_pvp_profiles")
    .select(PVP_PROFILE_SELECT)
    .gt("defense_power", 0)
    .order("rating", { ascending: false })
    .order("defense_power", { ascending: false })
    .order("updated_at", { ascending: false })
    .limit(MATCHMAKING_LIMIT)
    .returns<PvpProfileRow[]>();
  if (error) throw new Error(error.message);
  const rows = data ?? [];
  if (rows.some((row) => row.user_id === userId) || self.defense_power <= 0) return rows;
  return [self, ...rows].slice(0, MATCHMAKING_LIMIT);
}

async function loadLeaderboard(supabase: SupabaseClient) {
  const { data, error } = await supabase
    .from("user_pvp_profiles")
    .select(PVP_PROFILE_SELECT)
    .gt("defense_power", 0)
    .order("rating", { ascending: false })
    .limit(LEADERBOARD_LIMIT)
    .returns<PvpProfileRow[]>();
  if (error) throw new Error(error.message);
  return data ?? [];
}

async function expireOldStartedMatches(supabase: SupabaseClient, userId: string) {
  const { error } = await supabase
    .from("user_pvp_matches")
    .update({ status: "expired" })
    .eq("attacker_user_id", userId)
    .eq("status", "started")
    .lte("expires_at", new Date().toISOString());
  if (error) throw new Error(error.message);
}

async function pruneOldPvpMatches(supabase: SupabaseClient) {
  const { error } = await supabase.rpc("prune_pvp_matches_lite", { p_limit: 200 });
  if (error) {
    // Match start must stay available even if a database has not applied this optional pruning helper yet.
    return;
  }
}

async function assertPvpMatchLimits(supabase: SupabaseClient, attackerUserId: string, defenderUserId: string) {
  const now = new Date();
  const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
  const [active, daily, sameDefender] = await Promise.all([
    countMatches(supabase, {
      attackerUserId,
      status: "started",
      expiresAfter: now.toISOString(),
    }),
    countMatches(supabase, {
      attackerUserId,
      status: "completed",
      createdAfter: dayStart,
    }),
    countMatches(supabase, {
      attackerUserId,
      defenderUserId,
      status: "completed",
      createdAfter: dayStart,
    }),
  ]);
  if (active >= ACTIVE_MATCH_LIMIT) {
    throw new HttpModuleError(429, "pvp_active_match_limit", "pvp_start_match", "Ya tienes 2 combates PvP pendientes.");
  }
  if (daily >= DAILY_SCORING_LIMIT) {
    throw new HttpModuleError(429, "pvp_daily_limit", "pvp_start_match", "Alcanzaste el limite de 30 combates PvP puntuables de hoy.");
  }
  if (sameDefender >= DAILY_SAME_DEFENDER_LIMIT) {
    throw new HttpModuleError(429, "pvp_same_defender_limit", "pvp_start_match", "Ya puntuaste 5 veces contra este rival hoy.");
  }
}

async function countMatches(
  supabase: SupabaseClient,
  filters: {
    attackerUserId: string;
    defenderUserId?: string;
    status: "started" | "completed" | "expired";
    createdAfter?: string;
    expiresAfter?: string;
  },
) {
  let query = supabase
    .from("user_pvp_matches")
    .select("id", { count: "exact", head: true })
    .eq("attacker_user_id", filters.attackerUserId)
    .eq("status", filters.status);
  if (filters.defenderUserId != null) query = query.eq("defender_user_id", filters.defenderUserId);
  if (filters.createdAfter != null) query = query.gte("created_at", filters.createdAfter);
  if (filters.expiresAfter != null) query = query.gt("expires_at", filters.expiresAfter);
  const { count, error } = await query;
  if (error) throw new Error(error.message);
  return count ?? 0;
}

async function resolveDisplayName(supabase: SupabaseClient, userId: string) {
  const { data, error } = await supabase
    .from("profiles")
    .select("display_name")
    .eq("id", userId)
    .maybeSingle<ProfileNameRow>();
  if (error) return "Jugador";
  const displayName = data?.display_name?.trim();
  return displayName && displayName.length > 0 ? displayName.slice(0, 40) : "Jugador";
}

function normalizeDefenseSnapshot(value: unknown) {
  if (typeof value !== "object" || value == null || Array.isArray(value)) {
    throw new HttpModuleError(400, "invalid_defense_snapshot", "pvp_upsert_defense", "Defense snapshot invalido.");
  }
  const snapshot = value as Record<string, unknown>;
  const units = Array.isArray(snapshot.units) ? snapshot.units : [];
  if (units.length !== 3) {
    throw new HttpModuleError(400, "invalid_defense_snapshot", "pvp_upsert_defense", "La defensa PvP necesita exactamente 3 cartas.");
  }
  return snapshot;
}

function toClientProfile(row: PvpProfileRow) {
  const seasonId = row.current_season_id ?? currentSeasonId();
  const seasonRating = row.season_rating ?? row.rating;
  const seasonBestRating = row.season_best_rating ?? seasonRating;
  return {
    userId: row.user_id,
    displayName: row.display_name,
    league: row.league,
    leagueLabel: leagueLabel(row.league),
    rating: row.rating,
    currentSeasonId: seasonId,
    seasonRating,
    seasonBestRating,
    seasonLabel: seasonLabel(seasonId),
    wins: row.wins,
    losses: row.losses,
    defensePower: row.defense_power,
    defenseSnapshot: row.defense_snapshot,
    defenseUpdatedAt: row.defense_updated_at,
    updatedAt: row.updated_at,
  };
}

function toClientRival(row: PvpProfileRow, viewerUserId?: string) {
  return {
    ...toClientProfile(row),
    opponentUserId: row.user_id,
    isSelf: viewerUserId != null && row.user_id === viewerUserId,
  };
}

function leagueForRating(rating: number): PvpLeague {
  if (rating >= 1500) return "gold";
  if (rating >= 1200) return "silver";
  return "bronze";
}

function leagueLabel(league: string) {
  if (league === "gold") return "ORO";
  if (league === "silver") return "PLATA";
  return "BRONCE";
}

function buildLeagueDefinitions() {
  return [
    { key: "bronze", label: "BRONCE", minRating: 0 },
    { key: "silver", label: "PLATA", minRating: 1200 },
    { key: "gold", label: "ORO", minRating: 1500 },
  ];
}

function currentSeasonId(date = new Date()) {
  const utcDate = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = utcDate.getUTCDay() || 7;
  utcDate.setUTCDate(utcDate.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(utcDate.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((utcDate.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return `S${utcDate.getUTCFullYear()}-${String(week).padStart(2, "0")}`;
}

function seasonLabel(seasonId: string) {
  return `Temporada ${seasonId.replace(/^S/, "")}`;
}

async function beginIdempotentOperation(
  supabase: SupabaseClient,
  userId: string,
  operation: string,
  requestId: string,
  module: "pvp_start_match" | "pvp_complete_match",
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
    .select("operation,response")
    .eq("user_id", userId)
    .eq("request_id", requestId)
    .maybeSingle<IdempotencyRow>();
  if (readError || !data) throw new Error(insertError.message);
  if (data.operation !== operation) {
    throw new HttpModuleError(400, "request_id_reused", module, "requestId ya fue usado en otra operacion.");
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

function normalizeRpcObject(value: unknown) {
  return typeof value === "object" && value != null && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function strFromUnknown(value: unknown) {
  return typeof value === "string" ? value : "";
}

function intFromUnknown(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
}

function mapPvpRpcError(message: string, module: "pvp_complete_match") {
  const normalized = message.toLowerCase();
  if (normalized.includes("pvp_match_not_found")) {
    return new HttpModuleError(404, "pvp_match_not_found", module, "Match PvP no encontrado.");
  }
  if (normalized.includes("pvp_match_already_closed")) {
    return new HttpModuleError(409, "pvp_match_already_closed", module, "Este match PvP ya fue cerrado.");
  }
  if (normalized.includes("pvp_match_expired")) {
    return new HttpModuleError(409, "pvp_match_expired", module, "Este match PvP expiro. Busca rival de nuevo.");
  }
  if (normalized.includes("invalid_pvp_result")) {
    return new HttpModuleError(400, "invalid_pvp_result", module, "Resultado PvP invalido.");
  }
  if (normalized.includes("pvp_profile_not_found")) {
    return new HttpModuleError(404, "pvp_profile_not_found", module, "Perfil PvP no disponible.");
  }
  return new Error(message);
}

function assertRequestId(requestId: string, module: "pvp_upsert_defense" | "pvp_start_match" | "pvp_complete_match") {
  const value = requestId.trim();
  if (!/^[a-zA-Z0-9_-]{8,80}$/.test(value)) {
    throw new HttpModuleError(400, "invalid_request_id", module, "Invalid requestId.");
  }
}
