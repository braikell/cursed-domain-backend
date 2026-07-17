import type { SupabaseClient } from "@supabase/supabase-js";

import { TEST_INITIAL_GEMS, TEST_INITIAL_GOLD } from "./game-save.js";

export type RewardType = "gold_gems" | "basic_pack" | "epic_pack" | "legendary_pack" | "mythic_pack" | "choice_epic" | "choice_legendary" | "choice_definitiva";

export interface MissionRewardConfig {
  gold: number;
  gems: number;
  points: number;
  rewardType: RewardType;
  packId?: string;
  packCount?: number;
  choiceType?: string;
  choiceCount?: number;
}

export interface MissionDefinition {
  missionId: string;
  eventKey: string;
  rewardGold: number;
  rewardGems: number;
  rewardPoints: number;
  rewardType: RewardType;
  rewardConfig: Record<string, unknown>;
  target: number;
  sortOrder: number;
  isEnabled: boolean;
}

export interface ChestDefinition {
  chestId: string;
  requiredPoints: number;
  rewardGold: number;
  rewardGems: number;
  sortOrder: number;
  isEnabled: boolean;
}

export interface MonetizationConfigLite {
  configVersion: number;
  probabilitiesVersion: number;
  initialCurrencies: {
    gold: number;
    gems: number;
  };
  dailyMissions: MissionDefinition[];
  dailyChests: ChestDefinition[];
  weeklyMissions: MissionDefinition[];
  weeklyChests: ChestDefinition[];
  seasonMissions: MissionDefinition[];
  seasonChests: ChestDefinition[];
}

interface ConfigVersionRow {
  config_version: number;
  probabilities_version: number;
  payload: {
    initialCurrencies?: { gold?: number; gems?: number };
  };
}

interface MissionDefinitionRow {
  mission_id: string;
  event_key: string;
  reward_gold: number;
  reward_gems: number;
  reward_points: number;
  reward_type?: RewardType;
  reward_config?: Record<string, unknown>;
  target: number;
  sort_order: number;
  is_enabled: boolean;
}

interface ChestDefinitionRow {
  chest_id: string;
  required_points: number;
  reward_gold: number;
  reward_gems: number;
  sort_order: number;
  is_enabled: boolean;
}

function m(
  missionId: string, eventKey: string,
  rewardGold: number, rewardGems: number, rewardPoints: number,
  rewardType: RewardType, rewardConfig: Record<string, unknown> = {},
  target: number, sortOrder: number, isEnabled = true,
): MissionDefinition {
  return { missionId, eventKey, rewardGold, rewardGems, rewardPoints, rewardType, rewardConfig, target, sortOrder, isEnabled };
}

const r = (config: Record<string, unknown> = {}) => config;

const SEED_DAILY_MISSIONS: MissionDefinition[] = [
  m("login", "login", 400, 5, 5, "gold_gems", {}, 1, 10),
  m("claim_afk", "claim_afk", 600, 5, 5, "gold_gems", {}, 1, 20),
  m("complete_5_campaign_battles", "campaign_battle_completed", 500, 0, 5, "basic_pack", r({packId: "basicPack", packCount: 1}), 5, 30),
  m("win_3_battles", "battle_won", 700, 5, 5, "gold_gems", {}, 3, 40),
  m("clear_3_tower_floors", "tower_floor_cleared", 800, 5, 5, "epic_pack", r({packId: "epicPack", packCount: 1}), 3, 45),
  m("clear_1_tower_boss", "tower_boss_cleared", 1400, 15, 5, "basic_pack", r({packId: "basicPack", packCount: 1}), 1, 46),
  m("upgrade_1_card", "card_upgraded", 800, 8, 5, "gold_gems", {}, 1, 50),
  m("upgrade_3_cards", "card_upgraded", 600, 5, 5, "choice_epic", r({choiceType: "epic", choiceCount: 1}), 3, 60),
  m("equip_or_upgrade_1_item", "item_equipped_or_upgraded", 700, 8, 5, "gold_gems", {}, 1, 70),
  m("open_1_basic_pack", "basic_pack_opened", 500, 5, 5, "gold_gems", {}, 1, 80),
  m("complete_1_daily_dungeon", "daily_dungeon_completed", 600, 5, 5, "epic_pack", r({packId: "epicPack", packCount: 1}), 1, 90),
  m("defeat_1_daily_boss", "daily_boss_defeated", 1400, 15, 5, "basic_pack", r({packId: "basicPack", packCount: 1}), 1, 100),
  m("play_3_arena_pvp", "arena_pvp_played", 600, 5, 5, "basic_pack", r({packId: "basicPack", packCount: 1}), 3, 110),
  m("use_friend_support", "friend_support_used", 500, 5, 5, "gold_gems", {}, 1, 120),
  m("clan_participation", "clan_participation", 600, 8, 5, "gold_gems", {}, 1, 130),
  m("clear_1_idle_stage", "idle_stage_cleared", 800, 8, 5, "gold_gems", {}, 1, 140),
  m("sell_or_dismantle_1_item", "item_sold_or_dismantled", 600, 6, 5, "gold_gems", {}, 1, 150),
  m("spend_3000_gold", "gold_spent", 500, 5, 5, "basic_pack", r({packId: "basicPack", packCount: 1}), 3000, 160),
  m("claim_free_shop_reward", "free_shop_reward_claimed", 400, 5, 5, "gold_gems", {}, 1, 170),
  m("use_ultimate_20_times", "ultimate_used", 400, 0, 5, "epic_pack", r({packId: "epicPack", packCount: 1}), 20, 180),
  m("complete_1_expedition", "expedition_completed", 800, 8, 5, "basic_pack", r({packId: "basicPack", packCount: 1}), 1, 190),
  m("complete_10_daily_missions", "daily_mission_completed_other", 800, 12, 10, "epic_pack", r({packId: "epicPack", packCount: 1}), 10, 200),
];

const SEED_DAILY_CHESTS: ChestDefinition[] = [
  { chestId: "daily_chest_20", requiredPoints: 20, rewardGold: 1000, rewardGems: 10, sortOrder: 20, isEnabled: true },
  { chestId: "daily_chest_40", requiredPoints: 40, rewardGold: 1200, rewardGems: 15, sortOrder: 40, isEnabled: true },
  { chestId: "daily_chest_60", requiredPoints: 60, rewardGold: 1500, rewardGems: 20, sortOrder: 60, isEnabled: true },
  { chestId: "daily_chest_80", requiredPoints: 80, rewardGold: 1500, rewardGems: 25, sortOrder: 80, isEnabled: true },
  { chestId: "daily_chest_100", requiredPoints: 100, rewardGold: 1800, rewardGems: 30, sortOrder: 100, isEnabled: true },
];

const SEED_WEEKLY_MISSIONS: MissionDefinition[] = [
  m("weekly_complete_20_campaign", "campaign_battle_completed", 2000, 15, 15, "gold_gems", {}, 20, 10),
  m("weekly_win_10_battles", "battle_won", 1800, 20, 15, "epic_pack", r({packId: "epicPack", packCount: 1}), 10, 20),
  m("weekly_clear_10_tower_floors", "tower_floor_cleared", 1500, 10, 15, "legendary_pack", r({packId: "legendaryPack", packCount: 1}), 10, 30),
  m("weekly_clear_3_tower_bosses", "tower_boss_cleared", 2000, 15, 20, "choice_legendary", r({choiceType: "legendary", choiceCount: 1}), 3, 40),
  m("weekly_upgrade_5_cards", "card_upgraded", 1500, 15, 15, "epic_pack", r({packId: "epicPack", packCount: 1}), 5, 50),
  m("weekly_open_5_packs", "basic_pack_opened", 1600, 10, 15, "gold_gems", {}, 5, 60),
  m("weekly_play_10_pvp", "arena_pvp_played", 2500, 25, 15, "gold_gems", {}, 10, 70),
  m("weekly_spend_15000_gold", "gold_spent", 2200, 18, 15, "gold_gems", {}, 15000, 80),
  m("weekly_use_ultimate_60", "ultimate_used", 1600, 10, 15, "gold_gems", {}, 60, 90),
  m("weekly_equip_or_upgrade_5_items", "item_equipped_or_upgraded", 1400, 12, 15, "gold_gems", {}, 5, 100),
  m("weekly_complete_7_daily", "daily_mission_completed_other", 2500, 25, 20, "epic_pack", r({packId: "epicPack", packCount: 1}), 7, 110),
];

const SEED_WEEKLY_CHESTS: ChestDefinition[] = [
  { chestId: "weekly_chest_75", requiredPoints: 75, rewardGold: 3000, rewardGems: 40, sortOrder: 10, isEnabled: true },
  { chestId: "weekly_chest_150", requiredPoints: 150, rewardGold: 4000, rewardGems: 60, sortOrder: 20, isEnabled: true },
];

const SEED_SEASON_MISSIONS: MissionDefinition[] = [
  m("season_complete_100_campaign", "campaign_battle_completed", 3000, 20, 30, "epic_pack", r({packId: "epicPack", packCount: 1}), 100, 10),
  m("season_win_50_battles", "battle_won", 4000, 30, 30, "legendary_pack", r({packId: "legendaryPack", packCount: 1}), 50, 20),
  m("season_clear_30_tower_floors", "tower_floor_cleared", 4000, 30, 30, "mythic_pack", r({packId: "mythicPack", packCount: 1}), 30, 30),
  m("season_upgrade_15_cards", "card_upgraded", 4500, 35, 30, "basic_pack", r({packId: "basicPack", packCount: 1}), 15, 40),
  m("season_open_20_packs", "basic_pack_opened", 2500, 0, 30, "mythic_pack", r({packId: "mythicPack", packCount: 1}), 20, 50),
  m("season_play_30_pvp", "arena_pvp_played", 5000, 45, 30, "basic_pack", r({packId: "basicPack", packCount: 1}), 30, 60),
  m("season_spend_80k_gold", "gold_spent", 2000, 20, 30, "mythic_pack", r({packId: "mythicPack", packCount: 1}), 80000, 70),
  m("season_use_ultimate_200", "ultimate_used", 3000, 0, 30, "legendary_pack", r({packId: "legendaryPack", packCount: 1}), 200, 80),
  m("season_equip_or_upgrade_15_items", "item_equipped_or_upgraded", 3000, 25, 30, "epic_pack", r({packId: "epicPack", packCount: 1}), 15, 90),
  m("season_clear_15_tower_bosses", "tower_boss_cleared", 5000, 40, 30, "choice_legendary", r({choiceType: "legendary", choiceCount: 1}), 15, 100),
  m("season_complete_50_daily", "daily_mission_completed_other", 6000, 50, 40, "mythic_pack", r({packId: "mythicPack", packCount: 1}), 50, 110),
  m("season_complete_all", "season_all_missions_completed", 0, 0, 50, "choice_definitiva", r({choiceType: "definitiva", choiceCount: 1}), 1, 200),
];

const SEED_SEASON_CHESTS: ChestDefinition[] = [
  { chestId: "season_chest_150", requiredPoints: 150, rewardGold: 8000, rewardGems: 100, sortOrder: 10, isEnabled: true },
  { chestId: "season_chest_300", requiredPoints: 300, rewardGold: 12000, rewardGems: 160, sortOrder: 20, isEnabled: true },
];

const SEED_CONFIG: MonetizationConfigLite = {
  configVersion: 1,
  probabilitiesVersion: 1,
  initialCurrencies: {
    gold: TEST_INITIAL_GOLD,
    gems: TEST_INITIAL_GEMS,
  },
  dailyMissions: SEED_DAILY_MISSIONS,
  dailyChests: SEED_DAILY_CHESTS,
  weeklyMissions: SEED_WEEKLY_MISSIONS,
  weeklyChests: SEED_WEEKLY_CHESTS,
  seasonMissions: SEED_SEASON_MISSIONS,
  seasonChests: SEED_SEASON_CHESTS,
};

export async function getBootstrapMonetizationConfig(supabase: SupabaseClient): Promise<MonetizationConfigLite> {
  try {
    const { data: configVersion, error: versionError } = await supabase
      .from("monetization_config_versions")
      .select("config_version, probabilities_version, payload")
      .eq("namespace", "monetization_v1")
      .eq("is_active", true)
      .order("config_version", { ascending: false })
      .limit(1)
      .maybeSingle<ConfigVersionRow>();

    if (versionError) throw new Error(versionError.message);
    if (!configVersion) return SEED_CONFIG;

    const [dailyRes, weeklyRes, seasonRes] = await Promise.all([
      loadDefinitionRows(supabase, configVersion.config_version, "daily"),
      loadDefinitionRows(supabase, configVersion.config_version, "weekly"),
      loadDefinitionRows(supabase, configVersion.config_version, "season"),
    ]);

    if (!dailyRes.missionRows?.length) return SEED_CONFIG;

    const resolveMissions = (rows: MissionDefinitionRow[] | null, seed: MissionDefinition[]): MissionDefinition[] => {
      if (!rows?.length) return seed;
      const seedById = new Map(seed.map((s) => [s.missionId, s]));
      return rows.map((row) => {
        const fallback = seedById.get(row.mission_id);
        return {
          missionId: row.mission_id,
          eventKey: row.event_key,
          rewardGold: row.reward_gold,
          rewardGems: row.reward_gems,
          rewardPoints: row.reward_points,
          rewardType: (row.reward_type && row.reward_type !== "gold_gems" ? row.reward_type : fallback?.rewardType) ?? "gold_gems",
          rewardConfig: (row.reward_config && Object.keys(row.reward_config as object).length > 0 ? row.reward_config : fallback?.rewardConfig) ?? {},
          target: row.target,
          sortOrder: row.sort_order,
          isEnabled: row.is_enabled,
        };
      });
    };

    const resolveChests = (rows: ChestDefinitionRow[] | null, seed: ChestDefinition[]): ChestDefinition[] => {
      if (!rows?.length) return seed;
      return rows.map((row) => ({
        chestId: row.chest_id,
        requiredPoints: row.required_points,
        rewardGold: row.reward_gold,
        rewardGems: row.reward_gems,
        sortOrder: row.sort_order,
        isEnabled: row.is_enabled,
      }));
    };

    return {
      configVersion: configVersion.config_version,
      probabilitiesVersion: configVersion.probabilities_version,
      initialCurrencies: {
        gold: configVersion.payload.initialCurrencies?.gold ?? SEED_CONFIG.initialCurrencies.gold,
        gems: configVersion.payload.initialCurrencies?.gems ?? SEED_CONFIG.initialCurrencies.gems,
      },
      dailyMissions: resolveMissions(dailyRes.missionRows, SEED_DAILY_MISSIONS),
      dailyChests: resolveChests(dailyRes.chestRows, SEED_DAILY_CHESTS),
      weeklyMissions: resolveMissions(weeklyRes.missionRows, SEED_WEEKLY_MISSIONS),
      weeklyChests: resolveChests(weeklyRes.chestRows, SEED_WEEKLY_CHESTS),
      seasonMissions: resolveMissions(seasonRes.missionRows, SEED_SEASON_MISSIONS),
      seasonChests: resolveChests(seasonRes.chestRows, SEED_SEASON_CHESTS),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (
      (message.includes("monetization_config_versions") ||
        message.includes("daily_mission_definitions") ||
        message.includes("daily_chest_definitions") ||
        message.includes("weekly_mission_definitions") ||
        message.includes("season_mission_definitions")) &&
      (message.includes("does not exist") || message.includes("Could not find"))
    ) {
      return SEED_CONFIG;
    }
    throw error;
  }
}

interface DefinitionRowSets {
  missionRows: MissionDefinitionRow[] | null;
  chestRows: ChestDefinitionRow[] | null;
}

async function loadDefinitionRows(
  supabase: SupabaseClient,
  configVersion: number,
  scope: "daily" | "weekly" | "season",
): Promise<DefinitionRowSets> {
  const missionTable = `${scope}_mission_definitions`;
  const chestTable = `${scope}_chest_definitions`;

  const [missionResult, chestResult] = await Promise.all([
    supabase
      .from(missionTable)
      .select("mission_id, event_key, reward_gold, reward_gems, reward_points, reward_type, reward_config, target, sort_order, is_enabled")
      .eq("config_version", configVersion)
      .order("sort_order", { ascending: true })
      .returns<MissionDefinitionRow[]>(),
    supabase
      .from(chestTable)
      .select("chest_id, required_points, reward_gold, reward_gems, sort_order, is_enabled")
      .eq("config_version", configVersion)
      .order("sort_order", { ascending: true })
      .returns<ChestDefinitionRow[]>(),
  ]);

  return {
    missionRows: missionResult.error ? null : missionResult.data,
    chestRows: chestResult.error ? null : chestResult.data,
  };
}

export async function ensureBootstrapMonetizationFoundation(
  supabase: SupabaseClient,
  userId: string,
): Promise<MonetizationConfigLite> {
  const config = await getBootstrapMonetizationConfig(supabase);
  const nowIso = new Date().toISOString();

  const { error: economyError } = await supabase.from("user_economy").upsert(
    {
      user_id: userId,
      gold: config.initialCurrencies.gold,
      gems: config.initialCurrencies.gems,
      updated_at: nowIso,
    },
    { onConflict: "user_id", ignoreDuplicates: true },
  );
  if (economyError) throw new Error(economyError.message);

  const { error: afkError } = await supabase.from("user_afk").upsert(
    {
      user_id: userId,
      last_claimed_at: nowIso,
      accumulated_gold: 0,
      accumulated_gems: 0,
      config_version: config.configVersion,
      updated_at: nowIso,
    },
    { onConflict: "user_id", ignoreDuplicates: true },
  );
  if (afkError) throw new Error(afkError.message);

  const pityRows = ["basicPack", "epicPack", "legendaryPack", "mythicPack"].map((packId) => ({
    user_id: userId,
    pack_id: packId,
    pity_legendary: 0,
    pity_mythic: 0,
    target_counter: 0,
    soft_pity_step: 0,
    config_version: config.configVersion,
    updated_at: nowIso,
  }));
  const { error: pityError } = await supabase.from("user_pity").upsert(pityRows, {
    onConflict: "user_id,pack_id",
    ignoreDuplicates: false,
  });
  if (pityError && !isMissingMonetizationColumnsError(pityError.message)) {
    throw new Error(pityError.message);
  }

  return config;
}

export async function updateLoginMissionProgress(
  supabase: SupabaseClient,
  userId: string,
  config: MonetizationConfigLite,
): Promise<void> {
  await updateDailyMissionProgress(supabase, userId, config, "login", 1);
}

export async function updateDailyMissionProgress(
  supabase: SupabaseClient,
  userId: string,
  config: MonetizationConfigLite,
  eventKey: string,
  amount = 1,
): Promise<void> {
  const resetDate = getUtcResetDate();
  await ensureDailyMissionSnapshotState(supabase, userId, config, resetDate);
  const increment = Math.max(1, Math.floor(amount));
  const matchingDefinitions = config.dailyMissions.filter((mission) => mission.isEnabled && mission.eventKey === eventKey);
  for (const definition of matchingDefinitions) {
    await applyMissionProgress(supabase, userId, definition.missionId, resetDate, "user_daily_mission_state", definition.target, increment, config.configVersion);
  }

  await updateWeeklyMissionProgress(supabase, userId, config, eventKey, amount);
  await updateSeasonMissionProgress(supabase, userId, config, eventKey, amount);
}

export async function updateWeeklyMissionProgress(
  supabase: SupabaseClient,
  userId: string,
  config: MonetizationConfigLite,
  eventKey: string,
  amount = 1,
): Promise<void> {
  const resetDate = getUtcWeeklyResetDate();
  await ensureWeeklyMissionSnapshotState(supabase, userId, config, resetDate);
  const increment = Math.max(1, Math.floor(amount));
  const matchingDefinitions = config.weeklyMissions.filter((mission) => mission.isEnabled && mission.eventKey === eventKey);
  for (const definition of matchingDefinitions) {
    await applyMissionProgress(supabase, userId, definition.missionId, resetDate, "user_weekly_mission_state", definition.target, increment, config.configVersion);
  }
}

export async function updateSeasonMissionProgress(
  supabase: SupabaseClient,
  userId: string,
  config: MonetizationConfigLite,
  eventKey: string,
  amount = 1,
): Promise<void> {
  const resetDate = getUtcSeasonResetDate();
  await ensureSeasonMissionSnapshotState(supabase, userId, config, resetDate);
  const increment = Math.max(1, Math.floor(amount));
  const matchingDefinitions = config.seasonMissions.filter((mission) => mission.isEnabled && mission.eventKey === eventKey);
  for (const definition of matchingDefinitions) {
    await applyMissionProgress(supabase, userId, definition.missionId, resetDate, "user_season_mission_state", definition.target, increment, config.configVersion);
  }
}

async function applyMissionProgress(
  supabase: SupabaseClient,
  userId: string,
  missionId: string,
  resetDate: string,
  tableName: string,
  target: number,
  increment: number,
  configVersion: number,
): Promise<void> {
  const { data, error } = await supabase
    .from(tableName)
    .select("progress, target")
    .eq("user_id", userId)
    .eq("mission_id", missionId)
    .eq("reset_date", resetDate)
    .maybeSingle<{ progress: number; target: number }>();

  if (error) throw new Error(error.message);
  if (!data) return;

  const currentProgress = Number.isFinite(data.progress) ? data.progress : 0;
  const effectiveTarget = Number.isFinite(data.target) ? data.target : target;
  const nextProgress = Math.min(effectiveTarget, Math.max(0, currentProgress) + increment);
  if (nextProgress <= currentProgress) return;

  const { error: updateError } = await supabase
    .from(tableName)
    .update({
      progress: nextProgress,
      config_version: configVersion,
    })
    .eq("user_id", userId)
    .eq("mission_id", missionId)
    .eq("reset_date", resetDate);
  if (updateError) throw new Error(updateError.message);
}

export async function ensureDailyMissionSnapshotState(
  supabase: SupabaseClient,
  userId: string,
  config: MonetizationConfigLite,
  resetDate: string,
) {
  await ensureMissionSnapshotState(supabase, userId, config.dailyMissions, config.dailyChests, resetDate, "user_daily_mission_state", "user_daily_chest_state", config.configVersion);
}

export async function ensureWeeklyMissionSnapshotState(
  supabase: SupabaseClient,
  userId: string,
  config: MonetizationConfigLite,
  resetDate: string,
) {
  await ensureMissionSnapshotState(supabase, userId, config.weeklyMissions, config.weeklyChests, resetDate, "user_weekly_mission_state", "user_weekly_chest_state", config.configVersion);
}

export async function ensureSeasonMissionSnapshotState(
  supabase: SupabaseClient,
  userId: string,
  config: MonetizationConfigLite,
  resetDate: string,
) {
  await ensureMissionSnapshotState(supabase, userId, config.seasonMissions, config.seasonChests, resetDate, "user_season_mission_state", "user_season_chest_state", config.configVersion);
}

async function ensureMissionSnapshotState(
  supabase: SupabaseClient,
  userId: string,
  missions: MissionDefinition[],
  chests: ChestDefinition[],
  resetDate: string,
  missionTable: string,
  chestTable: string,
  configVersion: number,
) {
  const missionRows = missions
    .filter((mission) => mission.isEnabled)
    .map((mission) => ({
      user_id: userId,
      mission_id: mission.missionId,
      reset_date: resetDate,
      config_version: configVersion,
      progress: 0,
      target: mission.target,
      claimed: false,
      reward_gold_configured: mission.rewardGold,
      reward_gems_configured: mission.rewardGems,
      reward_points_configured: mission.rewardPoints,
      reward_gold_granted: 0,
      reward_gems_granted: 0,
      reward_points_granted: 0,
      reward_capped: false,
      reward_config: mission.rewardConfig ?? {},
      metadata: {},
    }));

  const chestRows = chests
    .filter((chest) => chest.isEnabled)
    .map((chest) => ({
      user_id: userId,
      chest_id: chest.chestId,
      reset_date: resetDate,
      config_version: configVersion,
      required_points: chest.requiredPoints,
      claimed: false,
      reward_gold_configured: chest.rewardGold,
      reward_gems_configured: chest.rewardGems,
      reward_gold_granted: 0,
      reward_gems_granted: 0,
      reward_capped: false,
      metadata: {},
    }));

  if (missionRows.length > 0) {
    const { error } = await supabase.from(missionTable).upsert(missionRows, {
      onConflict: "user_id,mission_id,reset_date",
      ignoreDuplicates: true,
    });
    if (error) throw new Error(error.message);
  }

  if (chestRows.length > 0) {
    const { error } = await supabase.from(chestTable).upsert(chestRows, {
      onConflict: "user_id,chest_id,reset_date",
      ignoreDuplicates: true,
    });
    if (error) throw new Error(error.message);
  }
}

export async function checkSeasonAllMissionsCompleted(
  supabase: SupabaseClient,
  userId: string,
  config: MonetizationConfigLite,
): Promise<boolean> {
  const resetDate = getUtcSeasonResetDate();
  await ensureSeasonMissionSnapshotState(supabase, userId, config, resetDate);

  const enabledMissions = config.seasonMissions.filter((m) => m.isEnabled && m.missionId !== "season_complete_all");
  if (enabledMissions.length === 0) return false;

  const { data, error } = await supabase
    .from("user_season_mission_state")
    .select("mission_id, claimed")
    .eq("user_id", userId)
    .eq("reset_date", resetDate)
    .in("mission_id", enabledMissions.map((m) => m.missionId));

  if (error || !data) return false;

  const allClaimed = enabledMissions.every((m) => data.some((row) => row.mission_id === m.missionId && row.claimed));
  return allClaimed;
}

export function getUtcResetDate() {
  return new Date().toISOString().slice(0, 10);
}

export function getUtcWeeklyResetDate() {
  const now = new Date();
  const dayOfWeek = now.getUTCDay();
  const daysUntilMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - daysUntilMonday));
  return monday.toISOString().slice(0, 10);
}

export function getUtcSeasonResetDate() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString().slice(0, 10);
}

function isMissingMonetizationColumnsError(message: string) {
  return (
    message.includes("target_counter") ||
    message.includes("soft_pity_step") ||
    message.includes("config_version")
  ) && (message.includes("does not exist") || message.includes("column"));
}
