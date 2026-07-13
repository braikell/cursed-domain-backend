export type EquipmentSlot = "weapon" | "helmet" | "armor" | "boots" | "accessory";
export type EquipmentFamily = "maldito" | "vacio" | "espectral";
export type EquipmentRarity = "basic" | "epic" | "legendary" | "mythic";
export type EquipmentDatabaseRarity = "comun" | "raro" | "epico" | "legendario" | "mitico";

export interface EquipmentStats {
  ad: number;
  hp: number;
  ap: number;
}

export interface EquipmentDefinition {
  key: string;
  name: string;
  slot: EquipmentSlot;
  family: EquipmentFamily;
  baseStats: EquipmentStats;
}

export interface UpgradeCost {
  fromTier: number;
  toTier: number;
  materials: number;
  gold: number;
}

export const EQUIPMENT_MAX_TIER_BY_RARITY: Record<EquipmentRarity, number> = {
  basic: 5,
  epic: 6,
  legendary: 7,
  mythic: 8,
};

export const EQUIPMENT_RARITY_BONUS: Record<EquipmentRarity, EquipmentStats> = {
  basic: { ad: 0, hp: 0, ap: 0 },
  epic: { ad: 1, hp: 1, ap: 1 },
  legendary: { ad: 2, hp: 2, ap: 2 },
  mythic: { ad: 3, hp: 3, ap: 3 },
};

export const EQUIPMENT_DISMANTLE_YIELD_BY_RARITY: Record<EquipmentRarity, number> = {
  basic: 2,
  epic: 4,
  legendary: 7,
  mythic: 10,
};

export const EQUIPMENT_UPGRADE_COSTS: ReadonlyArray<UpgradeCost> = [
  { fromTier: 1, toTier: 2, materials: 4, gold: 250 },
  { fromTier: 2, toTier: 3, materials: 7, gold: 450 },
  { fromTier: 3, toTier: 4, materials: 11, gold: 800 },
  { fromTier: 4, toTier: 5, materials: 17, gold: 1300 },
  { fromTier: 5, toTier: 6, materials: 24, gold: 1900 },
  { fromTier: 6, toTier: 7, materials: 32, gold: 2700 },
  { fromTier: 7, toTier: 8, materials: 41, gold: 3600 },
] as const;

const WEAPON_TIER_BONUS: Record<number, EquipmentStats> = {
  1: { ad: 0, hp: 0, ap: 0 },
  2: { ad: 1, hp: 2, ap: 1 },
  3: { ad: 2, hp: 4, ap: 2 },
  4: { ad: 3, hp: 6, ap: 3 },
  5: { ad: 4, hp: 8, ap: 4 },
  6: { ad: 5, hp: 10, ap: 5 },
  7: { ad: 6, hp: 12, ap: 6 },
  8: { ad: 7, hp: 14, ap: 7 },
};

const HELMET_TIER_BONUS: Record<number, EquipmentStats> = {
  1: { ad: 0, hp: 0, ap: 0 },
  2: { ad: 1, hp: 2, ap: 1 },
  3: { ad: 1, hp: 4, ap: 1 },
  4: { ad: 2, hp: 6, ap: 2 },
  5: { ad: 2, hp: 8, ap: 2 },
  6: { ad: 3, hp: 10, ap: 3 },
  7: { ad: 3, hp: 12, ap: 3 },
  8: { ad: 4, hp: 14, ap: 4 },
};

const ARMOR_TIER_BONUS: Record<number, EquipmentStats> = {
  1: { ad: 0, hp: 0, ap: 0 },
  2: { ad: 1, hp: 4, ap: 1 },
  3: { ad: 1, hp: 8, ap: 1 },
  4: { ad: 2, hp: 12, ap: 2 },
  5: { ad: 2, hp: 16, ap: 2 },
  6: { ad: 3, hp: 20, ap: 3 },
  7: { ad: 3, hp: 24, ap: 3 },
  8: { ad: 4, hp: 28, ap: 4 },
};

const BOOTS_TIER_BONUS: Record<number, EquipmentStats> = {
  1: { ad: 0, hp: 0, ap: 0 },
  2: { ad: 1, hp: 2, ap: 1 },
  3: { ad: 2, hp: 4, ap: 2 },
  4: { ad: 2, hp: 6, ap: 2 },
  5: { ad: 3, hp: 8, ap: 3 },
  6: { ad: 3, hp: 10, ap: 3 },
  7: { ad: 4, hp: 12, ap: 4 },
  8: { ad: 5, hp: 14, ap: 5 },
};

const ACCESSORY_TIER_BONUS: Record<number, EquipmentStats> = {
  1: { ad: 0, hp: 0, ap: 0 },
  2: { ad: 1, hp: 2, ap: 1 },
  3: { ad: 1, hp: 4, ap: 1 },
  4: { ad: 2, hp: 6, ap: 2 },
  5: { ad: 2, hp: 8, ap: 2 },
  6: { ad: 3, hp: 10, ap: 3 },
  7: { ad: 3, hp: 12, ap: 3 },
  8: { ad: 4, hp: 14, ap: 4 },
};

export const EQUIPMENT_ITEMS: ReadonlyArray<EquipmentDefinition> = [
  { key: "weapon_hoja_maldita", name: "Hoja Maldita", slot: "weapon", family: "maldito", baseStats: { ad: 5, hp: 10, ap: 5 } },
  { key: "weapon_daga_vacio", name: "Daga del Vacio", slot: "weapon", family: "vacio", baseStats: { ad: 6, hp: 12, ap: 6 } },
  { key: "weapon_katana_espectral", name: "Katana Espectral", slot: "weapon", family: "espectral", baseStats: { ad: 7, hp: 14, ap: 7 } },

  { key: "helmet_capucha_maldita", name: "Capucha Maldita", slot: "helmet", family: "maldito", baseStats: { ad: 2, hp: 14, ap: 2 } },
  { key: "helmet_casco_vacio", name: "Casco del Vacio", slot: "helmet", family: "vacio", baseStats: { ad: 3, hp: 16, ap: 3 } },
  { key: "helmet_mascara_espectral", name: "Mascara Espectral", slot: "helmet", family: "espectral", baseStats: { ad: 4, hp: 18, ap: 4 } },

  { key: "armor_tunica_maldita", name: "Tunica Maldita", slot: "armor", family: "maldito", baseStats: { ad: 2, hp: 20, ap: 2 } },
  { key: "armor_coraza_vacio", name: "Coraza del Vacio", slot: "armor", family: "vacio", baseStats: { ad: 3, hp: 24, ap: 3 } },
  { key: "armor_manto_espectral", name: "Manto Espectral", slot: "armor", family: "espectral", baseStats: { ad: 4, hp: 28, ap: 4 } },

  { key: "boots_botas_malditas", name: "Botas Malditas", slot: "boots", family: "maldito", baseStats: { ad: 3, hp: 10, ap: 3 } },
  { key: "boots_zapatos_vacio", name: "Zapatos del Vacio", slot: "boots", family: "vacio", baseStats: { ad: 4, hp: 12, ap: 4 } },
  { key: "boots_botas_espectral", name: "Botas Espectral", slot: "boots", family: "espectral", baseStats: { ad: 5, hp: 14, ap: 5 } },

  { key: "accessory_anillo_maldito", name: "Anillo Maldito", slot: "accessory", family: "maldito", baseStats: { ad: 3, hp: 8, ap: 3 } },
  { key: "accessory_collar_vacio", name: "Collar del Vacio", slot: "accessory", family: "vacio", baseStats: { ad: 4, hp: 10, ap: 4 } },
  { key: "accessory_talisman_espectral", name: "Talisman Espectral", slot: "accessory", family: "espectral", baseStats: { ad: 5, hp: 12, ap: 5 } },
] as const;

export function getEquipmentTierBonus(slot: EquipmentSlot, tier: number): EquipmentStats {
  const normalizedTier = Math.max(1, Math.min(8, Math.floor(tier || 1)));
  switch (slot) {
    case "weapon":
      return WEAPON_TIER_BONUS[normalizedTier];
    case "helmet":
      return HELMET_TIER_BONUS[normalizedTier];
    case "armor":
      return ARMOR_TIER_BONUS[normalizedTier];
    case "boots":
      return BOOTS_TIER_BONUS[normalizedTier];
    case "accessory":
      return ACCESSORY_TIER_BONUS[normalizedTier];
  }
}

export function getUpgradeCostForTier(fromTier: number): UpgradeCost | null {
  return EQUIPMENT_UPGRADE_COSTS.find((entry) => entry.fromTier === fromTier) ?? null;
}

export function canUpgradeToTier(rarity: EquipmentRarity, nextTier: number): boolean {
  return nextTier >= 1 && nextTier <= EQUIPMENT_MAX_TIER_BY_RARITY[rarity];
}

export function buildEquipmentStats(
  definition: EquipmentDefinition,
  rarity: EquipmentRarity,
  tier: number,
): EquipmentStats {
  const boundedTier = Math.max(1, Math.min(EQUIPMENT_MAX_TIER_BY_RARITY[rarity], Math.floor(tier || 1)));
  const tierBonus = getEquipmentTierBonus(definition.slot, boundedTier);
  const rarityBonus = EQUIPMENT_RARITY_BONUS[rarity];
  return {
    ad: definition.baseStats.ad + tierBonus.ad + rarityBonus.ad,
    hp: definition.baseStats.hp + tierBonus.hp + rarityBonus.hp,
    ap: definition.baseStats.ap + tierBonus.ap + rarityBonus.ap,
  };
}

export function buildEquipmentMaterialId(slot: EquipmentSlot): string {
  return `gear_mats:${slot}`;
}

export function normalizeEquipmentRarity(raw: unknown): EquipmentRarity {
  switch (String(raw ?? "").trim().toLowerCase()) {
    case "epic":
    case "epico":
    case "raro":
      return "epic";
    case "legendary":
    case "legendario":
      return "legendary";
    case "mythic":
    case "mitico":
      return "mythic";
    case "basic":
    case "basico":
    case "comun":
    default:
      return "basic";
  }
}

export function normalizeEquipmentRarityForDatabase(raw: unknown): EquipmentDatabaseRarity {
  switch (normalizeEquipmentRarity(raw)) {
    case "epic":
      return "epico";
    case "legendary":
      return "legendario";
    case "mythic":
      return "mitico";
    case "basic":
    default:
      return "comun";
  }
}

export function normalizeEquipmentSlotForDatabase(raw: unknown): string {
  switch (String(raw ?? "").trim().toLowerCase()) {
    case "weapon":
    case "arma":
      return "arma";
    case "helmet":
    case "casco":
      return "casco";
    case "armor":
    case "armadura":
      return "armadura";
    case "boots":
    case "botas":
      return "botas";
    case "accessory":
    case "accesorio":
      return "accesorio";
    default:
      return "arma";
  }
}
