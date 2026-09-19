import { calculateEquipmentV2PmBonus } from "./equipment-pm-v2.js";
import { convertAdaptivePower } from "./adaptive-power.js";

export type V2Rarity = "basic" | "epic" | "legendary" | "mythic";
export type V2Archetype = "offense" | "defense";
export type V2Slot = "weapon" | "helmet" | "armor" | "accessory" | "boots";
export interface V2Stats { adaptivePower: number; hp: number }
export interface V2ItemDefinition {
  key: string;
  name: string;
  slot: V2Slot;
  archetype: V2Archetype;
  artPath: string;
  level1: Record<V2Rarity, V2Stats>;
}
export interface V2Catalog {
  statsByItem: V2ItemDefinition[];
}
export interface V2UpgradeCost {
  fromLevel: number;
  toLevel: number;
  materials: number;
  gold: number;
  gems: number;
}
export interface V2Rules {
  itemLevels: {
    minimum: number;
    allocationRule: string;
    maximumByRarity: Record<V2Rarity, number>;
    approvedSetTotalsByRarity: Record<V2Rarity, { offenseAdaptivePower: number[]; defenseHp: number[] }>;
  };
  upgrades: { costsByRarity: Record<V2Rarity, V2UpgradeCost[]> };
  dismantle: { materialsByRarity: Record<V2Rarity, number> };
}

const RARITIES: V2Rarity[] = ["basic", "epic", "legendary", "mythic"];
const SLOTS: V2Slot[] = ["weapon", "helmet", "armor", "accessory", "boots"];
const ALLOCATION_RULE = "one_point_per_item_then_largest_remainder_proportional_to_level1";

function requireRarity(value: string): V2Rarity {
  if (!RARITIES.includes(value as V2Rarity)) throw new RangeError(`Invalid V2 rarity: ${value}`);
  return value as V2Rarity;
}

function requireDefinition(catalog: V2Catalog, key: string): V2ItemDefinition {
  const definition = catalog.statsByItem.find((item) => item.key === key);
  if (definition == null) throw new RangeError(`Unknown V2 item: ${key}`);
  return definition;
}

function allocateStep(definitions: V2ItemDefinition[], rarity: V2Rarity, stepTotal: number, archetype: V2Archetype): Map<string, number> {
  if (definitions.length !== SLOTS.length || new Set(definitions.map((item) => item.slot)).size !== SLOTS.length) {
    throw new Error(`V2 ${archetype} set must contain one item per slot`);
  }
  if (!Number.isSafeInteger(stepTotal) || stepTotal < definitions.length) {
    throw new Error(`V2 ${archetype} level step must improve every item`);
  }
  const field = archetype === "offense" ? "adaptivePower" : "hp";
  const baseTotal = definitions.reduce((sum, item) => sum + item.level1[rarity][field], 0);
  if (baseTotal <= 0) throw new Error("V2 level-one set total must be positive");
  const residual = stepTotal - definitions.length;
  const rows = definitions.map((item) => {
    const weight = item.level1[rarity][field];
    const numerator = residual * weight;
    return { key: item.key, value: 1 + Math.floor(numerator / baseTotal), remainder: numerator % baseTotal, weight };
  });
  let undistributed = stepTotal - rows.reduce((sum, row) => sum + row.value, 0);
  rows.sort((a, b) => b.remainder - a.remainder || b.weight - a.weight || a.key.localeCompare(b.key));
  for (const row of rows) {
    if (undistributed <= 0) break;
    row.value++;
    undistributed--;
  }
  if (undistributed !== 0) throw new Error("V2 level allocation failed");
  return new Map(rows.map((row) => [row.key, row.value]));
}

export function calculateV2ItemStats(catalog: V2Catalog, rules: V2Rules, key: string, rarityValue: string, level: number): V2Stats {
  const rarity = requireRarity(rarityValue);
  const definition = requireDefinition(catalog, key);
  if (rules.itemLevels.allocationRule !== ALLOCATION_RULE) throw new Error("Unsupported V2 allocation rule");
  const maximum = rules.itemLevels.maximumByRarity[rarity];
  if (!Number.isSafeInteger(level) || level < 1 || level > maximum) throw new RangeError(`Invalid V2 item level: ${level}`);
  const set = catalog.statsByItem.filter((item) => item.archetype === definition.archetype);
  const targets = rules.itemLevels.approvedSetTotalsByRarity[rarity];
  const series = definition.archetype === "offense" ? targets.offenseAdaptivePower : targets.defenseHp;
  if (series.length !== maximum) throw new Error("Incomplete V2 set progression");
  const field = definition.archetype === "offense" ? "adaptivePower" : "hp";
  const levelOneTotal = set.reduce((sum, item) => sum + item.level1[rarity][field], 0);
  if (series[0] !== levelOneTotal) throw new Error("V2 level-one set mismatch");
  let value = definition.level1[rarity][field];
  for (let step = 1; step < level; step++) {
    const allocation = allocateStep(set, rarity, series[step] - series[step - 1], definition.archetype);
    value += allocation.get(key) ?? 0;
  }
  return definition.archetype === "offense" ? { adaptivePower: value, hp: 0 } : { adaptivePower: 0, hp: value };
}

export function getV2UpgradeCost(rules: V2Rules, rarityValue: string, fromLevel: number): V2UpgradeCost | null {
  const rarity = requireRarity(rarityValue);
  if (!Number.isSafeInteger(fromLevel) || fromLevel < 1) throw new RangeError("Invalid V2 item level");
  return rules.upgrades.costsByRarity[rarity].find((entry) => entry.fromLevel === fromLevel) ?? null;
}

export function getV2DismantleMaterials(rules: V2Rules, rarityValue: string): number {
  const amount = rules.dismantle.materialsByRarity[requireRarity(rarityValue)];
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new Error("Invalid V2 dismantle contract");
  return amount;
}

export function calculateV2EquipmentBonus(
  equipped: Array<{ key: string; rarity: string; level: number }>,
  catalog: V2Catalog,
  rules: V2Rules,
  canonicalScaling: string,
): { adaptivePower: number; hp: number; ad: number; ap: number; pm: number } {
  const usedSlots = new Set<V2Slot>();
  let adaptivePower = 0;
  let hp = 0;
  for (const item of equipped) {
    const definition = requireDefinition(catalog, item.key);
    if (usedSlots.has(definition.slot)) throw new RangeError(`Duplicate V2 equipment slot: ${definition.slot}`);
    usedSlots.add(definition.slot);
    const stats = calculateV2ItemStats(catalog, rules, item.key, item.rarity, item.level);
    adaptivePower += stats.adaptivePower;
    hp += stats.hp;
  }
  const converted = convertAdaptivePower(adaptivePower, canonicalScaling);
  return { adaptivePower, hp, ...converted, pm: calculateEquipmentV2PmBonus({ adaptivePower, hp }) };
}
