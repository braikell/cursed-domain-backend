import type { V2Catalog, V2Rarity } from "./v2-balance.js";

export interface CampaignV2RewardState {
  utcDate: string;
  replayWinsToday: number;
  replayItemsToday: number;
  mythicDryItems: number;
}
export interface CampaignV2Rules {
  afk: { materialPeriodHours: number; materialCaps: { basic: number; epic: number }; materialPremiumMultiplier: number };
  campaign: {
    firstClearGuaranteedItemStagesPerChapter: { minimum: number; maximum: number };
    replay: { firstItemOfDayGuaranteed: boolean; subsequentWinItemChanceBasisPoints: number; dailyItemLimit: number };
    rarityChanceBasisPointsByChapter: Array<{ chapters: [number, number | null] } & Record<V2Rarity, number>>;
    mythicProtection: { minimumChapter: number; itemsWithoutMythicBeforeGuarantee: number; nextItemGuaranteedMythic: boolean };
  };
  tower: {
    bossFirstClearItemEveryFloors: number;
    guaranteedBossRewards: Record<V2Rarity, number[]>;
    reservedForFutureDefinitive: number[];
    grantReservedRewardNow: boolean;
    rewardSelection: "uniform_random_catalog";
    repeatBossRewards: false;
  };
}
export interface CampaignV2RewardInput {
  stageKey: string;
  isReplay: boolean;
  utcDate: string;
  state: CampaignV2RewardState;
  dropRoll: number;
  rarityRoll: number;
  itemRoll: number;
}
export interface PlannedV2Item {
  key: string;
  rarity: V2Rarity;
  level: 1;
  source: "campaign" | "tower";
}

const RARITIES: V2Rarity[] = ["basic", "epic", "legendary", "mythic"];

function requireRoll(value: number, max: number): void {
  if (!Number.isSafeInteger(value) || value < 0 || value >= max) throw new RangeError("Invalid equipment reward roll");
}

function stageParts(stageKey: string): { chapter: number; stage: number } {
  const match = /^world_(\d+)_stage_(\d+)$/i.exec(stageKey);
  if (match == null) throw new RangeError(`Invalid campaign stage: ${stageKey}`);
  const chapter = Number(match[1]);
  const stage = Number(match[2]);
  if (!Number.isSafeInteger(chapter) || chapter < 1 || !Number.isSafeInteger(stage) || stage < 1 || stage > 17) {
    throw new RangeError(`Invalid campaign stage: ${stageKey}`);
  }
  return { chapter, stage };
}

function stableHash(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function firstClearDropStage(chapter: number, stage: number, rules: CampaignV2Rules): boolean {
  const limits = rules.campaign.firstClearGuaranteedItemStagesPerChapter;
  const count = limits.minimum + stableHash(`chapter:${chapter}:drop_count`) % (limits.maximum - limits.minimum + 1);
  const selected = new Set<number>();
  for (let salt = 0; selected.size < count && salt < 64; salt++) {
    selected.add((stableHash(`chapter:${chapter}:drop_stage:${salt}`) % 17) + 1);
  }
  return selected.has(stage);
}

function rarityForChapter(chapter: number, roll: number, rules: CampaignV2Rules): V2Rarity {
  const band = rules.campaign.rarityChanceBasisPointsByChapter.find((entry) =>
    chapter >= entry.chapters[0] && (entry.chapters[1] == null || chapter <= entry.chapters[1]));
  if (band == null) throw new Error(`Missing V2 rarity band for chapter ${chapter}`);
  let cursor = 0;
  for (const rarity of RARITIES) {
    cursor += band[rarity];
    if (roll < cursor) return rarity;
  }
  throw new Error("Invalid V2 rarity chances");
}

export function towerBossRewardRarity(floor: number, rules: CampaignV2Rules): V2Rarity | null {
  for (const rarity of RARITIES) {
    if (rules.tower.guaranteedBossRewards[rarity].includes(floor)) return rarity;
  }
  return null;
}

export function planCampaignV2Reward(input: CampaignV2RewardInput, rules: CampaignV2Rules, catalog: V2Catalog): {
  item: PlannedV2Item | null;
  nextState: CampaignV2RewardState;
  reason: string;
} {
  requireRoll(input.dropRoll, 10_000);
  requireRoll(input.rarityRoll, 10_000);
  requireRoll(input.itemRoll, catalog.statsByItem.length);
  const { chapter, stage } = stageParts(input.stageKey);
  const previous = input.state;
  const nextState: CampaignV2RewardState = {
    utcDate: input.utcDate,
    replayWinsToday: previous.utcDate === input.utcDate ? Math.max(0, previous.replayWinsToday) : 0,
    replayItemsToday: previous.utcDate === input.utcDate ? Math.max(0, previous.replayItemsToday) : 0,
    mythicDryItems: Math.max(0, previous.mythicDryItems),
  };
  let shouldDrop = false;
  if (input.isReplay) {
    nextState.replayWinsToday++;
    if (nextState.replayItemsToday >= rules.campaign.replay.dailyItemLimit) {
      return { item: null, nextState, reason: "daily_replay_limit" };
    }
    shouldDrop = (rules.campaign.replay.firstItemOfDayGuaranteed && nextState.replayWinsToday === 1)
      || input.dropRoll < rules.campaign.replay.subsequentWinItemChanceBasisPoints;
  } else {
    shouldDrop = firstClearDropStage(chapter, stage, rules);
  }
  if (!shouldDrop) return { item: null, nextState, reason: "no_drop" };
  let rarity = rarityForChapter(chapter, input.rarityRoll, rules);
  const protection = rules.campaign.mythicProtection;
  if (chapter >= protection.minimumChapter && protection.nextItemGuaranteedMythic
    && nextState.mythicDryItems >= protection.itemsWithoutMythicBeforeGuarantee) {
    rarity = "mythic";
  }
  if (chapter >= protection.minimumChapter) {
    nextState.mythicDryItems = rarity === "mythic" ? 0 : nextState.mythicDryItems + 1;
  }
  if (input.isReplay) nextState.replayItemsToday++;
  const definition = catalog.statsByItem[input.itemRoll];
  if (definition == null) throw new Error("Missing V2 item definition");
  return { item: { key: definition.key, rarity, level: 1, source: "campaign" }, nextState, reason: input.isReplay ? "replay" : "first_clear" };
}

export function towerRarityFloor(floor: number): V2Rarity {
  if (!Number.isSafeInteger(floor) || floor < 1) throw new RangeError("Invalid tower floor");
  if (floor >= 80) return "mythic";
  if (floor >= 55) return "legendary";
  if (floor >= 30) return "epic";
  return "basic";
}

export function planTowerV2Reward(
  floor: number,
  firstClear: boolean,
  itemRoll: number,
  rules: CampaignV2Rules,
  catalog: V2Catalog,
): { item: PlannedV2Item | null; reason: string } {
  requireRoll(itemRoll, catalog.statsByItem.length);
  if (!Number.isSafeInteger(floor) || floor < 1) throw new RangeError("Invalid tower floor");
  if (floor % rules.tower.bossFirstClearItemEveryFloors !== 0) return { item: null, reason: "not_boss" };
  if (!firstClear) return { item: null, reason: "already_claimed" };
  if (rules.tower.reservedForFutureDefinitive.includes(floor) && !rules.tower.grantReservedRewardNow) {
    return { item: null, reason: "future_definitive_reserved" };
  }
  const guaranteedRarity = towerBossRewardRarity(floor, rules);
  if (guaranteedRarity == null) return { item: null, reason: "boss_reward_not_configured" };
  const definition = catalog.statsByItem[itemRoll];
  if (definition == null) throw new Error("Missing V2 item definition");
  return {
    item: { key: definition.key, rarity: guaranteedRarity, level: 1, source: "tower" },
    reason: "boss_first_clear_random",
  };
}

