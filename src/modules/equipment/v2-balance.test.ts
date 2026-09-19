import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CARD_BALANCE_DEFINITIONS, calculateCardFinalStats } from "../cards/balance.js";
import { buildV2CardEquipmentBonus, buildV2InventoryItem } from "./v2-runtime.js";
import {
  calculateV2EquipmentBonus,
  calculateV2ItemStats,
  getV2DismantleMaterials,
  getV2UpgradeCost,
  type V2Catalog,
  type V2Rarity,
  type V2Rules,
} from "./v2-balance.js";

const catalog = JSON.parse(readFileSync(new URL("../../../../../config/equipment/equipment_v2_stats.json", import.meta.url), "utf8")) as V2Catalog;
const rules = JSON.parse(readFileSync(new URL("../../../../../config/equipment/equipment_v2_rules.json", import.meta.url), "utf8")) as V2Rules;
const rarities: V2Rarity[] = ["basic", "epic", "legendary", "mythic"];
const expectedCosts = {
  basic: { materials: 23, gold: 70_000, gems: 5 },
  epic: { materials: 45, gold: 140_000, gems: 15 },
  legendary: { materials: 80, gold: 350_000, gems: 75 },
  mythic: { materials: 130, gold: 700_000, gems: 150 },
};

describe("equipment V2 balance", () => {
  it("derives all 160 item/rarity/level stats from the approved set totals", () => {
    expect(catalog.statsByItem).toHaveLength(10);
    for (const rarity of rarities) {
      const targets = rules.itemLevels.approvedSetTotalsByRarity[rarity];
      for (let level = 1; level <= 4; level++) {
        const calculated = catalog.statsByItem.map((item) => ({
          ...item,
          stats: calculateV2ItemStats(catalog, rules, item.key, rarity, level),
        }));
        expect(calculated.filter((item) => item.archetype === "offense")
          .reduce((sum, item) => sum + item.stats.adaptivePower, 0)).toBe(targets.offenseAdaptivePower[level - 1]);
        expect(calculated.filter((item) => item.archetype === "defense")
          .reduce((sum, item) => sum + item.stats.hp, 0)).toBe(targets.defenseHp[level - 1]);
        for (const item of calculated) {
          const stat = item.archetype === "offense" ? item.stats.adaptivePower : item.stats.hp;
          const previous = level === 1 ? 0 : calculateV2ItemStats(catalog, rules, item.key, rarity, level - 1)[item.archetype === "offense" ? "adaptivePower" : "hp"];
          expect(stat).toBeGreaterThan(previous);
          expect(item.archetype === "offense" ? item.stats.hp : item.stats.adaptivePower).toBe(0);
        }
      }
    }
  });

  it("matches approved upgrade totals and dismantle yield without refund", () => {
    for (const rarity of rarities) {
      const costs = [1, 2, 3].map((level) => getV2UpgradeCost(rules, rarity, level)!);
      expect(costs.reduce((sum, cost) => sum + cost.materials, 0)).toBe(expectedCosts[rarity].materials);
      expect(costs.reduce((sum, cost) => sum + cost.gold, 0)).toBe(expectedCosts[rarity].gold);
      expect(costs.reduce((sum, cost) => sum + cost.gems, 0)).toBe(expectedCosts[rarity].gems);
      expect(getV2UpgradeCost(rules, rarity, 4)).toBeNull();
      expect(getV2DismantleMaterials(rules, rarity)).toBe(rarities.indexOf(rarity) + 1);
    }
  });

  it("converts power once and computes the same PM for all card scalings", () => {
    const offense = catalog.statsByItem.filter((item) => item.archetype === "offense")
      .map((item) => ({ key: item.key, rarity: "mythic", level: 4 }));
    const physical = calculateV2EquipmentBonus(offense, catalog, rules, "PHYSICAL");
    const magical = calculateV2EquipmentBonus(offense, catalog, rules, "MAGICAL");
    const hybrid = calculateV2EquipmentBonus(offense, catalog, rules, "HYBRID");
    const support = calculateV2EquipmentBonus(offense, catalog, rules, "SUPPORT");
    expect(physical).toMatchObject({ adaptivePower: 123, hp: 0, ad: 123, ap: 0, pm: 185 });
    expect(magical).toMatchObject({ ad: 0, ap: 123, pm: 185 });
    expect(hybrid).toMatchObject({ ad: 123, ap: 123, pm: 185 });
    expect(support).toMatchObject({ ad: 0, ap: 123, pm: 185 });
  });

  it("applies the universal equipment PM once to real cards of every scaling", () => {
    const offensiveItems = catalog.statsByItem.filter((item) => item.archetype === "offense")
      .map((item) => buildV2InventoryItem(item.key, "mythic", 4));
    const defensiveItems = catalog.statsByItem.filter((item) => item.archetype === "defense")
      .map((item) => buildV2InventoryItem(item.key, "mythic", 4));
    for (const scaling of ["PHYSICAL", "MAGICAL", "HYBRID", "SUPPORT"]) {
      const definition = CARD_BALANCE_DEFINITIONS.find((card) => card.scaling === scaling && card.cardType === "BASE");
      expect(definition).toBeDefined();
      const base = calculateCardFinalStats(definition!, 1, 0);
      const offense = buildV2CardEquipmentBonus(offensiveItems, scaling);
      const equipped = calculateCardFinalStats(definition!, 1, 0, offense);
      expect(equipped.pm_v2 - base.pm_v2).toBe(185);
      expect(equipped.ad - base.ad).toBe(offense.ad);
      expect(equipped.ap - base.ap).toBe(offense.ap);
      const defense = buildV2CardEquipmentBonus(defensiveItems, scaling);
      const protectedCard = calculateCardFinalStats(definition!, 1, 0, defense);
      expect(protectedCard.hp - base.hp).toBe(1344);
      expect(protectedCard.pm_v2 - base.pm_v2).toBe(185);
    }
  });

  it("rejects invalid item, rarity, level and duplicate equipped slots", () => {
    expect(() => calculateV2ItemStats(catalog, rules, "legacy_item", "basic", 1)).toThrow();
    expect(() => calculateV2ItemStats(catalog, rules, catalog.statsByItem[0]!.key, "unknown", 1)).toThrow();
    expect(() => calculateV2ItemStats(catalog, rules, catalog.statsByItem[0]!.key, "basic", 5)).toThrow();
    const weapons = catalog.statsByItem.filter((item) => item.slot === "weapon")
      .map((item) => ({ key: item.key, rarity: "basic", level: 1 }));
    expect(() => calculateV2EquipmentBonus(weapons, catalog, rules, "PHYSICAL")).toThrow();
  });
});
