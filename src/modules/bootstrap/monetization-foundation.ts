import type { SupabaseClient } from "@supabase/supabase-js";

import { TEST_INITIAL_GEMS, TEST_INITIAL_GOLD } from "./game-save.js";

export interface MonetizationConfigLite {
  configVersion: number;
  probabilitiesVersion: number;
  initialCurrencies: {
    gold: number;
    gems: number;
  };
  dailyMissions: Array<{
    missionId: string;
    eventKey: string;
    rewardGold: number;
    rewardGems: number;
    rewardPoints: number;
    target: number;
    sortOrder: number;
    isEnabled: boolean;
  }>;
  dailyChests: Array<{
    chestId: string;
    requiredPoints: number;
    rewardGold: number;
    rewardGems: number;
    sortOrder: number;
    isEnabled: boolean;
  }>;
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

const SEED_CONFIG: MonetizationConfigLite = {
  configVersion: 1,
  probabilitiesVersion: 1,
  initialCurrencies: {
    gold: TEST_INITIAL_GOLD,
    gems: TEST_INITIAL_GEMS,
  },
  dailyMissions: [
    { missionId: "login", eventKey: "login", rewardGold: 400, rewardGems: 5, rewardPoints: 5, target: 1, sortOrder: 10, isEnabled: true },
    { missionId: "claim_afk", eventKey: "claim_afk", rewardGold: 600, rewardGems: 5, rewardPoints: 5, target: 1, sortOrder: 20, isEnabled: true },
    { missionId: "complete_5_campaign_battles", eventKey: "campaign_battle_completed", rewardGold: 700, rewardGems: 5, rewardPoints: 5, target: 5, sortOrder: 30, isEnabled: true },
    { missionId: "win_3_battles", eventKey: "battle_won", rewardGold: 700, rewardGems: 5, rewardPoints: 5, target: 3, sortOrder: 40, isEnabled: true },
    { missionId: "clear_3_tower_floors", eventKey: "tower_floor_cleared", rewardGold: 1200, rewardGems: 12, rewardPoints: 5, target: 3, sortOrder: 45, isEnabled: true },
    { missionId: "clear_1_tower_boss", eventKey: "tower_boss_cleared", rewardGold: 1800, rewardGems: 18, rewardPoints: 5, target: 1, sortOrder: 46, isEnabled: true },
    { missionId: "upgrade_1_card", eventKey: "card_upgraded", rewardGold: 800, rewardGems: 8, rewardPoints: 5, target: 1, sortOrder: 50, isEnabled: true },
    { missionId: "upgrade_3_cards", eventKey: "card_upgraded", rewardGold: 900, rewardGems: 8, rewardPoints: 5, target: 3, sortOrder: 60, isEnabled: true },
    { missionId: "equip_or_upgrade_1_item", eventKey: "item_equipped_or_upgraded", rewardGold: 700, rewardGems: 8, rewardPoints: 5, target: 1, sortOrder: 70, isEnabled: true },
    { missionId: "open_1_basic_pack", eventKey: "basic_pack_opened", rewardGold: 500, rewardGems: 5, rewardPoints: 5, target: 1, sortOrder: 80, isEnabled: true },
    { missionId: "complete_1_daily_dungeon", eventKey: "daily_dungeon_completed", rewardGold: 800, rewardGems: 10, rewardPoints: 5, target: 1, sortOrder: 90, isEnabled: true },
    { missionId: "defeat_1_daily_boss", eventKey: "daily_boss_defeated", rewardGold: 1000, rewardGems: 12, rewardPoints: 5, target: 1, sortOrder: 100, isEnabled: true },
    { missionId: "play_3_arena_pvp", eventKey: "arena_pvp_played", rewardGold: 700, rewardGems: 10, rewardPoints: 5, target: 3, sortOrder: 110, isEnabled: true },
    { missionId: "use_friend_support", eventKey: "friend_support_used", rewardGold: 500, rewardGems: 5, rewardPoints: 5, target: 1, sortOrder: 120, isEnabled: true },
    { missionId: "clan_participation", eventKey: "clan_participation", rewardGold: 600, rewardGems: 8, rewardPoints: 5, target: 1, sortOrder: 130, isEnabled: true },
    { missionId: "clear_1_idle_stage", eventKey: "idle_stage_cleared", rewardGold: 800, rewardGems: 8, rewardPoints: 5, target: 1, sortOrder: 140, isEnabled: true },
    { missionId: "sell_or_dismantle_1_item", eventKey: "item_sold_or_dismantled", rewardGold: 600, rewardGems: 6, rewardPoints: 5, target: 1, sortOrder: 150, isEnabled: true },
    { missionId: "spend_3000_gold", eventKey: "gold_spent", rewardGold: 500, rewardGems: 5, rewardPoints: 5, target: 3000, sortOrder: 160, isEnabled: true },
    { missionId: "claim_free_shop_reward", eventKey: "free_shop_reward_claimed", rewardGold: 400, rewardGems: 5, rewardPoints: 5, target: 1, sortOrder: 170, isEnabled: true },
    { missionId: "use_ultimate_20_times", eventKey: "ultimate_used", rewardGold: 400, rewardGems: 10, rewardPoints: 5, target: 20, sortOrder: 180, isEnabled: true },
    { missionId: "complete_1_expedition", eventKey: "expedition_completed", rewardGold: 400, rewardGems: 10, rewardPoints: 5, target: 1, sortOrder: 190, isEnabled: true },
    { missionId: "complete_10_daily_missions", eventKey: "daily_mission_completed_other", rewardGold: 1000, rewardGems: 12, rewardPoints: 5, target: 10, sortOrder: 200, isEnabled: true },
  ],
  dailyChests: [
    { chestId: "daily_chest_20", requiredPoints: 20, rewardGold: 1000, rewardGems: 10, sortOrder: 20, isEnabled: true },
    { chestId: "daily_chest_40", requiredPoints: 40, rewardGold: 1200, rewardGems: 15, sortOrder: 40, isEnabled: true },
    { chestId: "daily_chest_60", requiredPoints: 60, rewardGold: 1500, rewardGems: 20, sortOrder: 60, isEnabled: true },
    { chestId: "daily_chest_80", requiredPoints: 80, rewardGold: 1500, rewardGems: 25, sortOrder: 80, isEnabled: true },
    { chestId: "daily_chest_100", requiredPoints: 100, rewardGold: 1800, rewardGems: 30, sortOrder: 100, isEnabled: true },
  ],
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

    const [{ data: missionRows, error: missionError }, { data: chestRows, error: chestError }] = await Promise.all([
      supabase
        .from("daily_mission_definitions")
        .select("mission_id, event_key, reward_gold, reward_gems, reward_points, target, sort_order, is_enabled")
        .eq("config_version", configVersion.config_version)
        .order("sort_order", { ascending: true })
        .returns<MissionDefinitionRow[]>(),
      supabase
        .from("daily_chest_definitions")
        .select("chest_id, required_points, reward_gold, reward_gems, sort_order, is_enabled")
        .eq("config_version", configVersion.config_version)
        .order("sort_order", { ascending: true })
        .returns<ChestDefinitionRow[]>(),
    ]);

    if (missionError) throw new Error(missionError.message);
    if (chestError) throw new Error(chestError.message);
    if (!missionRows?.length || !chestRows?.length) return SEED_CONFIG;

    return {
      configVersion: configVersion.config_version,
      probabilitiesVersion: configVersion.probabilities_version,
      initialCurrencies: {
        gold: configVersion.payload.initialCurrencies?.gold ?? SEED_CONFIG.initialCurrencies.gold,
        gems: configVersion.payload.initialCurrencies?.gems ?? SEED_CONFIG.initialCurrencies.gems,
      },
      dailyMissions: missionRows.map((row: MissionDefinitionRow) => ({
        missionId: row.mission_id,
        eventKey: row.event_key,
        rewardGold: row.reward_gold,
        rewardGems: row.reward_gems,
        rewardPoints: row.reward_points,
        target: row.target,
        sortOrder: row.sort_order,
        isEnabled: row.is_enabled,
      })),
      dailyChests: chestRows.map((row: ChestDefinitionRow) => ({
        chestId: row.chest_id,
        requiredPoints: row.required_points,
        rewardGold: row.reward_gold,
        rewardGems: row.reward_gems,
        sortOrder: row.sort_order,
        isEnabled: row.is_enabled,
      })),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (
      (message.includes("monetization_config_versions") ||
        message.includes("daily_mission_definitions") ||
        message.includes("daily_chest_definitions")) &&
      (message.includes("does not exist") || message.includes("Could not find"))
    ) {
      return SEED_CONFIG;
    }
    throw error;
  }
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
    const { data, error } = await supabase
      .from("user_daily_mission_state")
      .select("progress, target")
      .eq("user_id", userId)
      .eq("mission_id", definition.missionId)
      .eq("reset_date", resetDate)
      .maybeSingle<{ progress: number; target: number }>();

    if (error) throw new Error(error.message);
    if (!data) continue;

    const currentProgress = Number.isFinite(data.progress) ? data.progress : 0;
    const effectiveTarget = Number.isFinite(data.target) ? data.target : definition.target;
    const nextProgress = Math.min(effectiveTarget, Math.max(0, currentProgress) + increment);
    if (nextProgress <= currentProgress) continue;

    const { error: updateError } = await supabase
      .from("user_daily_mission_state")
      .update({
        progress: nextProgress,
        config_version: config.configVersion,
      })
      .eq("user_id", userId)
      .eq("mission_id", definition.missionId)
      .eq("reset_date", resetDate);
    if (updateError) throw new Error(updateError.message);
  }
}

export async function ensureDailyMissionSnapshotState(
  supabase: SupabaseClient,
  userId: string,
  config: MonetizationConfigLite,
  resetDate: string,
) {
  const missionRows = config.dailyMissions
    .filter((mission) => mission.isEnabled)
    .map((mission) => ({
      user_id: userId,
      mission_id: mission.missionId,
      reset_date: resetDate,
      config_version: config.configVersion,
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
      metadata: {},
    }));

  const chestRows = config.dailyChests
    .filter((chest) => chest.isEnabled)
    .map((chest) => ({
      user_id: userId,
      chest_id: chest.chestId,
      reset_date: resetDate,
      config_version: config.configVersion,
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
    const { error } = await supabase.from("user_daily_mission_state").upsert(missionRows, {
      onConflict: "user_id,mission_id,reset_date",
      ignoreDuplicates: true,
    });
    if (error) throw new Error(error.message);
  }

  if (chestRows.length > 0) {
    const { error } = await supabase.from("user_daily_chest_state").upsert(chestRows, {
      onConflict: "user_id,chest_id,reset_date",
      ignoreDuplicates: true,
    });
    if (error) throw new Error(error.message);
  }
}

export function getUtcResetDate() {
  return new Date().toISOString().slice(0, 10);
}

function isMissingMonetizationColumnsError(message: string) {
  return (
    message.includes("target_counter") ||
    message.includes("soft_pity_step") ||
    message.includes("config_version")
  ) && (message.includes("does not exist") || message.includes("column"));
}
