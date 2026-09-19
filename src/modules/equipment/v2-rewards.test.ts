import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { V2Catalog } from "./v2-balance.js";
import {
  distributeAfkV2Materials,
  planCampaignV2Reward,
  planTowerV2Reward,
  towerRarityFloor,
  type CampaignV2RewardState,
  type CampaignV2Rules,
} from "./v2-rewards.js";

const catalog = JSON.parse(readFileSync(new URL("../../../../../config/equipment/equipment_v2_stats.json", import.meta.url), "utf8")) as V2Catalog;
const rules = JSON.parse(readFileSync(new URL("../../../../../config/equipment/equipment_v2_rules.json", import.meta.url), "utf8")) as CampaignV2Rules;
const emptyState: CampaignV2RewardState = { utcDate: "", replayWinsToday: 0, replayItemsToday: 0, mythicDryItems: 0 };
const campaign = (stageKey: string, isReplay: boolean, state = emptyState, dropRoll = 9999, rarityRoll = 9999) =>
  planCampaignV2Reward({ stageKey, isReplay, state, utcDate: "2026-09-18", dropRoll, rarityRoll, itemRoll: 0 }, rules, catalog);

describe("equipment V2 reward planning", () => {
  it("guarantees the approved Tower bosses and reserves 95/100", () => {
    const samples = [
      [5, "basic"],
      [30, "epic"],
      [55, "legendary"],
      [80, "mythic"],
    ] as const;
    for (const [floor, rarity] of samples) {
      expect(planTowerV2Reward(floor, true, "2026-W38", { weeklyRewardKey: "" }, null, 0, rules, catalog).item)
        .toMatchObject({ rarity, level: 1 });
    }
    expect(planTowerV2Reward(95, true, "2026-W38", { weeklyRewardKey: "" }, null, 0, rules, catalog).reason).toBe("future_definitive_reserved");
    expect(planTowerV2Reward(100, true, "2026-W38", { weeklyRewardKey: "" }, null, 0, rules, catalog).reason).toBe("future_definitive_reserved");
  });

  it("guarantees the first replay item daily, caps at three and applies the 20 percent roll", () => {
    const first = campaign("world_1_stage_1", true);
    expect(first.item).not.toBeNull();
    expect(first.nextState).toMatchObject({ replayWinsToday: 1, replayItemsToday: 1 });
    const miss = campaign("world_1_stage_1", true, first.nextState, 2000);
    expect(miss.item).toBeNull();
    const hit = campaign("world_1_stage_1", true, miss.nextState, 1999);
    expect(hit.item).not.toBeNull();
    const cap = campaign("world_1_stage_1", true, { ...hit.nextState, replayItemsToday: 3 }, 0);
    expect(cap).toMatchObject({ item: null, reason: "daily_replay_limit" });
  });

  it("guarantees mythic after twenty qualifying non-mythic items", () => {
    const state = { ...emptyState, mythicDryItems: 20 };
    const result = campaign("world_10_stage_1", true, state);
    expect(result.item?.rarity).toBe("mythic");
    expect(result.nextState.mythicDryItems).toBe(0);
  });

  it("requires a choice on weekly Tower repeats and limits them to one", () => {
    expect(towerRarityFloor(5)).toBe("basic");
    expect(towerRarityFloor(30)).toBe("epic");
    expect(towerRarityFloor(55)).toBe("legendary");
    expect(towerRarityFloor(80)).toBe("mythic");
    const state = { weeklyRewardKey: "" };
    expect(planTowerV2Reward(5, false, "2026-W38", state, null, 0, rules, catalog).reason).toBe("choice_required");
    const choice = { slot: "weapon" as const, archetype: "offense" as const };
    const reward = planTowerV2Reward(80, false, "2026-W38", state, choice, 0, rules, catalog);
    expect(reward.item).toMatchObject({ key: "weapon_filo_de_la_ruptura", rarity: "mythic", level: 1 });
    expect(planTowerV2Reward(80, false, "2026-W38", reward.nextState, choice, 0, rules, catalog).reason).toBe("weekly_claimed");
    expect(planTowerV2Reward(80, true, "2026-W38", state, null, 0, rules, catalog).item).not.toBeNull();
  });

  it("distributes AFK materials fairly across all five item slots", () => {
    const first = distributeAfkV2Materials(13, { materialCursor: 0 });
    expect(first.stacks.map((entry) => entry.quantity)).toEqual([3, 3, 3, 2, 2]);
    expect(first.stacks.every((entry) => entry.materialId.startsWith("item_materials:"))).toBe(true);
    const second = distributeAfkV2Materials(2, first.nextState);
    expect(second.stacks.map((entry) => entry.materialId)).toEqual(["item_materials:accessory", "item_materials:boots"]);
    expect(first.stacks.reduce((sum, entry) => sum + entry.quantity, 0) + second.stacks.reduce((sum, entry) => sum + entry.quantity, 0)).toBe(15);
  });
});
