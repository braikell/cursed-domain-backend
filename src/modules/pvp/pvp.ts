import type { SupabaseClient } from "@supabase/supabase-js";

import type { GodotAuthedRequestContext, PvpCompleteMatchInput, PvpUpsertDefenseInput } from "../../contracts.js";
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

const DEFAULT_RATING = 1000;
const MATCHMAKING_LIMIT = 5;
const LEADERBOARD_LIMIT = 20;
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
    rivals: rivals.map(toClientRival),
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

export async function completePvpMatchDedicated(
  context: GodotAuthedRequestContext,
  input: PvpCompleteMatchInput,
): Promise<unknown> {
  if (input.defenderUserId === context.userId) {
    throw new HttpModuleError(400, "pvp_self_match", "pvp_complete_match", "No puedes combatir contra tu propia defensa.");
  }
  assertRequestId(input.requestId, "pvp_complete_match");
  const supabase = createServiceSupabaseClient();
  const operation = `pvp_complete_match_v1:${input.defenderUserId}:${input.result}`;
  const replay = await beginIdempotentOperation(supabase, context.userId, operation, input.requestId);
  if (replay.status === "replayed") {
    if (replay.response == null) {
      throw new HttpModuleError(409, "operation_in_progress", "pvp_complete_match", "El resultado PvP todavia se esta procesando.");
    }
    return replay.response;
  }

  const [attacker, defender] = await Promise.all([
    ensurePvpProfile(supabase, context.userId),
    loadPvpProfile(supabase, input.defenderUserId),
  ]);
  if (defender == null || defender.defense_power <= 0) {
    throw new HttpModuleError(404, "pvp_defender_not_found", "pvp_complete_match", "El rival ya no tiene defensa PvP disponible.");
  }

  const attackerWon = input.result === "win";
  const ratingDelta = calculateRatingDelta(attacker.rating, defender.rating, attackerWon);
  const attackerNextRating = Math.max(0, attacker.rating + ratingDelta);
  const defenderNextRating = Math.max(0, defender.rating - ratingDelta);
  const seasonId = currentSeasonId();
  const attackerSeason = normalizeSeason(attacker, seasonId);
  const defenderSeason = normalizeSeason(defender, seasonId);
  const attackerNextSeasonRating = Math.max(0, attackerSeason.rating + ratingDelta);
  const defenderNextSeasonRating = Math.max(0, defenderSeason.rating - ratingDelta);
  const now = new Date().toISOString();

  const { data: attackerData, error: attackerError } = await supabase
    .from("user_pvp_profiles")
    .update({
      rating: attackerNextRating,
      current_season_id: seasonId,
      season_rating: attackerNextSeasonRating,
      season_best_rating: Math.max(attackerSeason.bestRating, attackerNextSeasonRating),
      wins: attacker.wins + (attackerWon ? 1 : 0),
      losses: attacker.losses + (attackerWon ? 0 : 1),
      last_match_at: now,
      updated_at: now,
    })
    .eq("user_id", context.userId)
    .select(PVP_PROFILE_SELECT)
    .single<PvpProfileRow>();
  if (attackerError) throw new Error(attackerError.message);

  const { data: defenderData, error: defenderError } = await supabase
    .from("user_pvp_profiles")
    .update({
      rating: defenderNextRating,
      current_season_id: seasonId,
      season_rating: defenderNextSeasonRating,
      season_best_rating: Math.max(defenderSeason.bestRating, defenderNextSeasonRating),
      wins: defender.wins + (attackerWon ? 0 : 1),
      losses: defender.losses + (attackerWon ? 1 : 0),
      updated_at: now,
    })
    .eq("user_id", input.defenderUserId)
    .select(PVP_PROFILE_SELECT)
    .single<PvpProfileRow>();
  if (defenderError) throw new Error(defenderError.message);

  const { error: logError } = await supabase.from("user_pvp_battle_logs").insert({
    season_id: seasonId,
    attacker_user_id: context.userId,
    defender_user_id: input.defenderUserId,
    result: input.result,
    rating_delta: ratingDelta,
    attacker_rating_before: attacker.rating,
    attacker_rating_after: attackerNextRating,
    defender_rating_before: defender.rating,
    defender_rating_after: defenderNextRating,
    attacker_power: Math.max(0, Math.trunc(input.attackerPower)),
    defender_power: Math.max(0, Math.trunc(input.defenderPower)),
    created_at: now,
  });
  if (logError) throw new Error(logError.message);

  const response = {
    ok: true as const,
    result: input.result,
    ratingDelta,
    ratingBefore: attacker.rating,
    ratingAfter: attackerNextRating,
    seasonId,
    seasonRatingBefore: attackerSeason.rating,
    seasonRatingAfter: attackerNextSeasonRating,
    seasonBestRating: Math.max(attackerSeason.bestRating, attackerNextSeasonRating),
    profile: toClientProfile(attackerData),
    defender: toClientProfile(defenderData),
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
  const minPower = Math.max(1, Math.floor(Math.max(self.defense_power, 1) * 0.65));
  const maxPower = Math.max(minPower + 1, Math.ceil(Math.max(self.defense_power, 1) * 1.45));
  const { data, error } = await supabase
    .from("user_pvp_profiles")
    .select(PVP_PROFILE_SELECT)
    .neq("user_id", userId)
    .gt("defense_power", 0)
    .gte("defense_power", minPower)
    .lte("defense_power", maxPower)
    .order("rating", { ascending: false })
    .limit(MATCHMAKING_LIMIT)
    .returns<PvpProfileRow[]>();
  if (error) throw new Error(error.message);
  if ((data ?? []).length >= 3) return data ?? [];

  const fallback = await supabase
    .from("user_pvp_profiles")
    .select(PVP_PROFILE_SELECT)
    .neq("user_id", userId)
    .gt("defense_power", 0)
    .order("rating", { ascending: false })
    .limit(MATCHMAKING_LIMIT)
    .returns<PvpProfileRow[]>();
  if (fallback.error) throw new Error(fallback.error.message);
  return fallback.data ?? [];
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

function toClientRival(row: PvpProfileRow) {
  return {
    ...toClientProfile(row),
    opponentUserId: row.user_id,
  };
}

function calculateRatingDelta(attackerRating: number, defenderRating: number, attackerWon: boolean) {
  const difficultyBonus = Math.max(-6, Math.min(10, Math.round((defenderRating - attackerRating) / 80)));
  if (attackerWon) return Math.max(12, Math.min(34, 22 + difficultyBonus));
  return -Math.max(6, Math.min(18, 10 - difficultyBonus));
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

function normalizeSeason(row: PvpProfileRow, seasonId: string) {
  if ((row.current_season_id ?? "") !== seasonId) {
    return { rating: DEFAULT_RATING, bestRating: DEFAULT_RATING };
  }
  const rating = Math.max(0, Math.trunc(row.season_rating ?? row.rating));
  return {
    rating,
    bestRating: Math.max(rating, Math.trunc(row.season_best_rating ?? rating)),
  };
}

async function beginIdempotentOperation(
  supabase: SupabaseClient,
  userId: string,
  operation: string,
  requestId: string,
) {
  assertRequestId(requestId, "pvp_complete_match");
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
    throw new HttpModuleError(400, "request_id_reused", "pvp_complete_match", "requestId ya fue usado en otra operacion.");
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

function assertRequestId(requestId: string, module: "pvp_upsert_defense" | "pvp_complete_match") {
  const value = requestId.trim();
  if (!/^[a-zA-Z0-9_-]{8,80}$/.test(value)) {
    throw new HttpModuleError(400, "invalid_request_id", module, "Invalid requestId.");
  }
}
