import type { SupabaseClient } from "@supabase/supabase-js";

import {
  createInitialGameSave,
  normalizeGameSave,
  toLegacyStageKey,
  type GameSaveSnapshot,
} from "../bootstrap/game-save.js";

export const PLAYER_LEVEL_UP_GEMS = 100;

export type PlayerXpRewardSource =
  | "campaign_battle"
  | "afk_claim"
  | "tower_floor"
  | "pvp_win"
  | "admin_adjustment";

export interface GrantPlayerXpRewardInput {
  userId: string;
  source: PlayerXpRewardSource;
  sourceId: string;
  requestId: string;
  xpAmount: number;
  economyReward?: {
    gold?: number;
    gems?: number;
  };
  now?: Date;
}

export interface PlayerLevelUpReward {
  level: number;
  gems: number;
}

export interface PlayerProgressionRewardResult {
  source: PlayerXpRewardSource;
  sourceId: string;
  requestId: string;
  xpAdded: number;
  xpBefore: number;
  xpAfter: number;
  levelBefore: number;
  levelAfter: number;
  levelsGained: number;
  gemsGranted: number;
  levelUpRewards: PlayerLevelUpReward[];
  save: {
    gold: number;
    gems: number;
    xp: number;
    playerLevel: number;
    schemaVersion: number;
  };
}

interface PlayerSaveRow {
  save: GameSaveSnapshot;
  save_version?: number | null;
}

interface PlayerProgressRow {
  player_level: number | null;
  xp: number | null;
  current_stage: string | null;
  highest_stage: string | null;
  unlocked_slots: number | null;
  total_summons: number | null;
  total_battles_won: number | null;
}

interface UserEconomyRow {
  gold: number | null;
  gems: number | null;
}

interface PlayerXpGrantLedgerRow {
  user_id: string;
  source: PlayerXpRewardSource;
  source_id: string;
  request_id: string;
  status: "pending" | "applied";
  xp_amount: number;
  xp_before: number;
  xp_after: number;
  level_before: number;
  level_after: number;
  reward_gold: number;
  reward_gems: number;
  gems_granted: number;
  applied_at: string | null;
}

export function xpRequiredForPlayerLevel(level: number) {
  const normalizedLevel = Math.max(1, Math.floor(Number(level) || 1));
  const n = normalizedLevel - 1;
  return Math.max(0, Math.floor(120 * n + 18 * n * n + 0.85 * n * n * n));
}

export function resolvePlayerLevelFromXp(totalXp: number) {
  const xp = Math.max(0, Math.floor(Number(totalXp) || 0));
  let level = 1;
  while (xp >= xpRequiredForPlayerLevel(level + 1)) {
    level += 1;
  }
  return level;
}

export function buildPlayerLevelUpRewards(levelBefore: number, levelAfter: number): PlayerLevelUpReward[] {
  const before = Math.max(1, Math.floor(Number(levelBefore) || 1));
  const after = Math.max(before, Math.floor(Number(levelAfter) || before));
  const rewards: PlayerLevelUpReward[] = [];
  for (let level = before + 1; level <= after; level += 1) {
    rewards.push({ level, gems: PLAYER_LEVEL_UP_GEMS });
  }
  return rewards;
}

export async function grantPlayerXpReward(
  supabase: SupabaseClient,
  input: GrantPlayerXpRewardInput,
): Promise<PlayerProgressionRewardResult> {
  const now = input.now ?? new Date();
  const nowIso = now.toISOString();
  const xpAdded = Math.max(0, Math.floor(Number(input.xpAmount) || 0));
  const rewardGold = Math.max(0, Math.floor(Number(input.economyReward?.gold) || 0));
  const rewardGems = Math.max(0, Math.floor(Number(input.economyReward?.gems) || 0));
  const saveBefore = await loadPlayerSave(supabase, input.userId);
  const [progressBefore, economyBefore] = await Promise.all([
    loadPlayerProgress(supabase, input.userId, saveBefore),
    loadUserEconomy(supabase, input.userId, saveBefore),
  ]);

  const xpBefore = Math.max(0, Math.floor(Number(progressBefore.xp ?? saveBefore.xp) || 0));
  const levelBefore = resolvePlayerLevelFromXp(xpBefore);
  const xpAfter = xpBefore + xpAdded;
  const levelAfter = resolvePlayerLevelFromXp(xpAfter);
  const levelUpRewards = buildPlayerLevelUpRewards(levelBefore, levelAfter);
  const gemsGranted = levelUpRewards.reduce((total, reward) => total + reward.gems, 0);
  const nextGold = Math.max(0, Math.floor(Number(economyBefore.gold) || 0)) + rewardGold;
  const nextGems = Math.max(0, Math.floor(Number(economyBefore.gems) || 0)) + rewardGems + gemsGranted;
  const ledger = await beginPlayerXpGrantLedger(supabase, input, {
    xpAdded,
    rewardGold,
    rewardGems,
    xpBefore,
    xpAfter,
    levelBefore,
    levelAfter,
    gemsGranted,
    nowIso,
  });
  if (ledger.status === "replayed") {
    return buildResultFromLedger(input, ledger.row, saveBefore);
  }

  await Promise.all([
    upsertPlayerProgress(supabase, input.userId, progressBefore, saveBefore, {
      playerLevel: levelAfter,
      xp: xpAfter,
      nowIso,
    }),
    upsertUserEconomy(supabase, input.userId, {
      gold: nextGold,
      gems: nextGems,
      nowIso,
    }),
  ]);

  const saveAfter = await upsertLegacyPlayerSaveMirror(supabase, input.userId, saveBefore, {
    gold: nextGold,
    gems: nextGems,
    xp: xpAfter,
    playerLevel: levelAfter,
    nowIso,
  });
  await markPlayerXpGrantApplied(supabase, input, nowIso);

  return {
    source: input.source,
    sourceId: input.sourceId,
    requestId: input.requestId,
    xpAdded,
    xpBefore,
    xpAfter,
    levelBefore,
    levelAfter,
    levelsGained: Math.max(0, levelAfter - levelBefore),
    gemsGranted,
    levelUpRewards,
    save: {
      gold: saveAfter.gold,
      gems: saveAfter.gems,
      xp: saveAfter.xp,
      playerLevel: saveAfter.playerLevel,
      schemaVersion: saveAfter.schemaVersion,
    },
  };
}

async function beginPlayerXpGrantLedger(
  supabase: SupabaseClient,
  input: GrantPlayerXpRewardInput,
  values: {
    xpAdded: number;
    rewardGold: number;
    rewardGems: number;
    xpBefore: number;
    xpAfter: number;
    levelBefore: number;
    levelAfter: number;
    gemsGranted: number;
    nowIso: string;
  },
) {
  const { error } = await supabase.from("user_player_xp_grants").insert({
    user_id: input.userId,
    source: input.source,
    source_id: input.sourceId,
    request_id: input.requestId,
    status: "pending",
    xp_amount: values.xpAdded,
    reward_gold: values.rewardGold,
    reward_gems: values.rewardGems,
    xp_before: values.xpBefore,
    xp_after: values.xpAfter,
    level_before: values.levelBefore,
    level_after: values.levelAfter,
    gems_granted: values.gemsGranted,
    created_at: values.nowIso,
    updated_at: values.nowIso,
  });

  if (!error) {
    return { status: "started" as const, row: null };
  }
  if (!isDuplicateKeyError(error)) {
    throw new Error(error.message);
  }

  const existing = await loadPlayerXpGrantLedgerRow(supabase, input);
  if (existing == null) {
    throw new Error(error.message);
  }
  if (existing.status !== "applied") {
    throw new Error("player_xp_grant_in_progress");
  }
  return { status: "replayed" as const, row: existing };
}

async function loadPlayerXpGrantLedgerRow(
  supabase: SupabaseClient,
  input: Pick<GrantPlayerXpRewardInput, "userId" | "source" | "sourceId" | "requestId">,
) {
  const { data, error } = await supabase
    .from("user_player_xp_grants")
    .select("user_id,source,source_id,request_id,status,xp_amount,xp_before,xp_after,level_before,level_after,reward_gold,reward_gems,gems_granted,applied_at")
    .eq("user_id", input.userId)
    .eq("source", input.source)
    .eq("source_id", input.sourceId)
    .eq("request_id", input.requestId)
    .maybeSingle<PlayerXpGrantLedgerRow>();
  if (error) throw new Error(error.message);
  return data;
}

async function markPlayerXpGrantApplied(
  supabase: SupabaseClient,
  input: Pick<GrantPlayerXpRewardInput, "userId" | "source" | "sourceId" | "requestId">,
  nowIso: string,
) {
  const { error } = await supabase
    .from("user_player_xp_grants")
    .update({
      status: "applied",
      applied_at: nowIso,
      updated_at: nowIso,
    })
    .eq("user_id", input.userId)
    .eq("source", input.source)
    .eq("source_id", input.sourceId)
    .eq("request_id", input.requestId);
  if (error) throw new Error(error.message);
}

function buildResultFromLedger(
  input: GrantPlayerXpRewardInput,
  row: PlayerXpGrantLedgerRow,
  currentSave: GameSaveSnapshot,
): PlayerProgressionRewardResult {
  const levelUpRewards = buildPlayerLevelUpRewards(row.level_before, row.level_after);
  return {
    source: input.source,
    sourceId: input.sourceId,
    requestId: input.requestId,
    xpAdded: Math.max(0, Math.floor(Number(row.xp_amount) || 0)),
    xpBefore: Math.max(0, Math.floor(Number(row.xp_before) || 0)),
    xpAfter: Math.max(0, Math.floor(Number(row.xp_after) || 0)),
    levelBefore: Math.max(1, Math.floor(Number(row.level_before) || 1)),
    levelAfter: Math.max(1, Math.floor(Number(row.level_after) || 1)),
    levelsGained: Math.max(0, Math.floor(Number(row.level_after) || 1) - Math.floor(Number(row.level_before) || 1)),
    gemsGranted: Math.max(0, Math.floor(Number(row.gems_granted) || 0)),
    levelUpRewards,
    save: {
      gold: currentSave.gold,
      gems: currentSave.gems,
      xp: currentSave.xp,
      playerLevel: currentSave.playerLevel,
      schemaVersion: currentSave.schemaVersion,
    },
  };
}

function isDuplicateKeyError(error: { code?: string; message?: string }) {
  return error.code === "23505" || String(error.message ?? "").toLowerCase().includes("duplicate key");
}

async function loadPlayerSave(supabase: SupabaseClient, userId: string) {
  const { data, error } = await supabase
    .from("player_saves")
    .select("save, save_version")
    .eq("user_id", userId)
    .maybeSingle<PlayerSaveRow>();
  if (error) throw new Error(error.message);
  return normalizeGameSave(data?.save ?? createInitialGameSave());
}

async function loadPlayerProgress(
  supabase: SupabaseClient,
  userId: string,
  save: GameSaveSnapshot,
) {
  const { data, error } = await supabase
    .from("player_progress")
    .select("player_level, xp, current_stage, highest_stage, unlocked_slots, total_summons, total_battles_won")
    .eq("user_id", userId)
    .maybeSingle<PlayerProgressRow>();
  if (error) throw new Error(error.message);
  return data ?? {
    player_level: save.playerLevel,
    xp: save.xp,
    current_stage: save.currentStage,
    highest_stage: save.highestStage,
    unlocked_slots: save.unlockedSlots,
    total_summons: save.totalSummons,
    total_battles_won: save.totalBattlesWon,
  };
}

async function loadUserEconomy(
  supabase: SupabaseClient,
  userId: string,
  save: GameSaveSnapshot,
) {
  const { data, error } = await supabase
    .from("user_economy")
    .select("gold, gems")
    .eq("user_id", userId)
    .maybeSingle<UserEconomyRow>();
  if (error) throw new Error(error.message);
  return data ?? { gold: save.gold, gems: save.gems };
}

async function upsertPlayerProgress(
  supabase: SupabaseClient,
  userId: string,
  progress: PlayerProgressRow,
  save: GameSaveSnapshot,
  patch: { playerLevel: number; xp: number; nowIso: string },
) {
  const { error } = await supabase.from("player_progress").upsert(
    {
      user_id: userId,
      player_level: patch.playerLevel,
      xp: patch.xp,
      current_stage: toLegacyStageKey(progress.current_stage ?? save.currentStage),
      highest_stage: toLegacyStageKey(progress.highest_stage ?? save.highestStage),
      unlocked_slots: Math.max(1, Math.floor(Number(progress.unlocked_slots ?? save.unlockedSlots) || 1)),
      total_summons: Math.max(0, Math.floor(Number(progress.total_summons ?? save.totalSummons) || 0)),
      total_battles_won: Math.max(0, Math.floor(Number(progress.total_battles_won ?? save.totalBattlesWon) || 0)),
      updated_at: patch.nowIso,
    },
    { onConflict: "user_id" },
  );
  if (error) throw new Error(error.message);
}

async function upsertUserEconomy(
  supabase: SupabaseClient,
  userId: string,
  patch: { gold: number; gems: number; nowIso: string },
) {
  const { error } = await supabase.from("user_economy").upsert(
    {
      user_id: userId,
      gold: patch.gold,
      gems: patch.gems,
      updated_at: patch.nowIso,
    },
    { onConflict: "user_id" },
  );
  if (error) throw new Error(error.message);
}

async function upsertLegacyPlayerSaveMirror(
  supabase: SupabaseClient,
  userId: string,
  save: GameSaveSnapshot,
  patch: { gold: number; gems: number; xp: number; playerLevel: number; nowIso: string },
) {
  const nextSave: GameSaveSnapshot = {
    ...save,
    gold: patch.gold,
    gems: patch.gems,
    xp: patch.xp,
    playerLevel: patch.playerLevel,
  };

  const { error } = await supabase.from("player_saves").upsert(
    {
      user_id: userId,
      save: nextSave,
      save_version: nextSave.schemaVersion,
      updated_at: patch.nowIso,
    },
    { onConflict: "user_id" },
  );
  if (error) throw new Error(error.message);
  return nextSave;
}
