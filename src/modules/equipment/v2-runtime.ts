import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import type { EquipmentItem } from "../bootstrap/game-save.js";
import { calculateV2EquipmentBonus, calculateV2ItemStats, type V2Catalog, type V2Rarity, type V2Rules } from "./v2-balance.js";
import type { CampaignV2Rules } from "./v2-rewards.js";

interface V2Bundle {
  schemaVersion: number;
  catalog: V2Catalog & { status: string };
  rules: V2Rules & CampaignV2Rules & { status: string; activationAllowed: boolean };
}

let cachedBundle: V2Bundle | undefined;

export function getV2Bundle(): V2Bundle {
  if (cachedBundle != null) return cachedBundle;
  const bundle = JSON.parse(readFileSync(new URL("../../../data/equipment_v2_bundle.json", import.meta.url), "utf8")) as V2Bundle;
  if (bundle.schemaVersion !== 1 || bundle.catalog.status !== "active"
    || bundle.rules.status !== "active" || bundle.rules.activationAllowed !== true
    || bundle.catalog.statsByItem.length !== 10) {
    throw new Error("Invalid equipment V2 deployment bundle");
  }
  cachedBundle = bundle;
  return bundle;
}

export function buildV2InventoryItem(key: string, rarity: V2Rarity, level = 1, id: string = randomUUID()): EquipmentItem {
  const { catalog, rules } = getV2Bundle();
  const definition = catalog.statsByItem.find((item) => item.key === key);
  if (definition == null) throw new RangeError(`Unknown V2 item: ${key}`);
  const stats = calculateV2ItemStats(catalog, rules, key, rarity, level);
  return {
    id,
    slot: definition.slot,
    rarity,
    name: definition.name,
    equipmentKey: definition.key,
    adaptivePower: stats.adaptivePower,
    tier: level,
    equippedToCharacterId: null,
    ad: 0,
    ap: 0,
    hp: stats.hp,
    atk: 0,
    def: 0,
  };
}

export function buildV2CardEquipmentBonus(items: EquipmentItem[], canonicalScaling: string) {
  const { catalog, rules } = getV2Bundle();
  const bonus = calculateV2EquipmentBonus(items.map((item) => ({
    key: item.equipmentKey ?? "",
    rarity: item.rarity,
    level: item.tier ?? 1,
  })), catalog, rules, canonicalScaling);
  return { ad: bonus.ad, ap: bonus.ap, hp: bonus.hp, adaptivePower: bonus.adaptivePower, equipmentV2: true };
}
