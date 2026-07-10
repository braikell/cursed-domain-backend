import { readFileSync } from "node:fs";

export type CardCatalogType = "BASE" | "DEFINITIVA";
export type CardBalanceRarity = "basic" | "epic" | "legendary" | "mythic";

export const CARD_MAX_LEVEL_BY_TYPE_AND_RARITY: Record<CardCatalogType, Record<CardBalanceRarity, number>> = {
  BASE: {
    basic: 92,
    epic: 94,
    legendary: 96,
    mythic: 100,
  },
  DEFINITIVA: {
    basic: 100,
    epic: 102,
    legendary: 105,
    mythic: 110,
  },
};
export const CARD_STAT_GROWTH_BY_TYPE_AND_RARITY: Record<CardCatalogType, Record<CardBalanceRarity, { atkGrowth: number; hpGrowth: number }>> = {
  BASE: {
    basic: { atkGrowth: 0.0070, hpGrowth: 0.0100 },
    epic: { atkGrowth: 0.0075, hpGrowth: 0.0105 },
    legendary: { atkGrowth: 0.0080, hpGrowth: 0.0110 },
    mythic: { atkGrowth: 0.0085, hpGrowth: 0.0115 },
  },
  DEFINITIVA: {
    basic: { atkGrowth: 0.0090, hpGrowth: 0.0120 },
    epic: { atkGrowth: 0.0095, hpGrowth: 0.0125 },
    legendary: { atkGrowth: 0.0100, hpGrowth: 0.0130 },
    mythic: { atkGrowth: 0.0105, hpGrowth: 0.0135 },
  },
};
export const CARD_ASCENSION_STAT_MULTIPLIER: Record<number, number> = {
  0: 1.00,
  1: 1.03,
  2: 1.06,
  3: 1.09,
  4: 1.12,
  5: 1.14,
};
export const CARD_MAX_ASCENSION_BY_TYPE_AND_RARITY: Record<CardCatalogType, Record<CardBalanceRarity, number>> = {
  BASE: {
    basic: 3,
    epic: 3,
    legendary: 4,
    mythic: 4,
  },
  DEFINITIVA: {
    basic: 4,
    epic: 4,
    legendary: 5,
    mythic: 5,
  },
};
export const CARD_ASCENSION_LEVEL_CAPS: Record<number, number> = {
  0: 20,
  1: 40,
  2: 60,
  3: 80,
  4: 95,
};
export const CARD_ASCENSION_STAT_BONUS: Record<number, number> = {
  0: 0,
  1: 0.03,
  2: 0.03,
  3: 0.03,
  4: 0.03,
  5: 0.02,
};
export const CARD_XP_CURVE = {
  baseCost: 750,
  linearGrowth: 325,
  quadraticGrowth: 140,
};
export const CARD_IMPROVE_GOLD_DISTRIBUTION_BY_TIER: Record<string, number> = {
  "1_20": 0.1,
  "21_40": 0.15,
  "41_60": 0.2,
  "61_80": 0.25,
  "81_plus": 0.3,
};
export const CARD_IMPROVE_FRAGMENT_DISTRIBUTION_BY_TIER: Record<string, number> = {
  "1_20": 0,
  "21_40": 0.1,
  "41_60": 0.2,
  "61_80": 0.3,
  "81_plus": 0.4,
};
export const CARD_IMPROVE_TOTAL_GOLD_BY_TYPE_AND_RARITY: Record<CardCatalogType, Record<CardBalanceRarity, number>> = {
  BASE: {
    basic: 1_000_000,
    epic: 1_500_000,
    legendary: 5_000_000,
    mythic: 9_000_000,
  },
  DEFINITIVA: {
    basic: 14_000_000,
    epic: 14_000_000,
    legendary: 14_000_000,
    mythic: 14_000_000,
  },
};
export const CARD_IMPROVE_TOTAL_FRAGMENTS_BY_TYPE_AND_RARITY: Record<CardCatalogType, Record<CardBalanceRarity, number>> = {
  BASE: {
    basic: 120,
    epic: 220,
    legendary: 480,
    mythic: 900,
  },
  DEFINITIVA: {
    basic: 1100,
    epic: 1250,
    legendary: 1450,
    mythic: 1600,
  },
};
export const CARD_UNLOCK_ELEMENTS_BY_TYPE_AND_RARITY: Record<CardCatalogType, Record<CardBalanceRarity, number>> = {
  BASE: {
    basic: 5,
    epic: 4,
    legendary: 3,
    mythic: 2,
  },
  DEFINITIVA: {
    basic: 1,
    epic: 1,
    legendary: 1,
    mythic: 1,
  },
};
export const CARD_ASCENSION_COSTS: Record<number, { gold: number; fragments: number }> = {
  1: { gold: 120_000, fragments: 40 },
  2: { gold: 280_000, fragments: 80 },
  3: { gold: 520_000, fragments: 140 },
  4: { gold: 900_000, fragments: 220 },
  5: { gold: 1_400_000, fragments: 320 },
};

export interface CardCombatStats {
  ad: number;
  ap: number;
  hp: number;
  vel: number;
  pm: number;
}

export interface CardFinalStats extends CardCombatStats {
  atk: number;
  speed: number;
}

interface CardDefinitionSkillPayload {
  [key: string]: unknown;
}

export interface CardBalanceDefinition {
  characterKey: string;
  character_key?: string;
  cardType: CardCatalogType;
  card_type?: CardCatalogType;
  card_key?: string;
  rarity: CardBalanceRarity;
  role: string;
  damageType: string;
  damage_type?: string;
  scaling: string;
  stats: CardCombatStats;
  ad?: number;
  ap?: number;
  hp?: number;
  vel?: number;
  pm?: number;
  atk?: number;
  speed?: number;
  attack_range?: number;
  desired_range?: number;
  move_speed?: number;
  attack_interval?: number;
  max_energy?: number;
  max_level?: number;
  max_ascension?: number;
  current_level_cap?: number;
  current_ascension_stat_bonus?: number;
  xp_to_next_level?: number;
  can_gain_xp?: boolean;
  crit_chance?: number;
  crit_damage?: number;
  basicSkill?: CardDefinitionSkillPayload;
  basic_skill?: CardDefinitionSkillPayload;
  ultimate?: CardDefinitionSkillPayload;
  art_path?: string;
  sort_order?: number;
  schema_version?: number;
}

interface CardBalancePayload {
  schemaVersion: number;
  pmFormula: {
    hpWeight: number;
    velWeight: number;
    supportMultiplier: number;
  };
  definitions: CardBalanceDefinition[];
}

const CARD_BALANCE_PATH = new URL("../../../data/card_balance.json", import.meta.url);
const CHARACTER_KEY_ALIASES: Record<string, string> = {
  inumaki: "toge",
};
const DEFINITIVE_RARITY_BONUS: Record<CardBalanceRarity, number> = {
  basic: 2,
  epic: 3,
  legendary: 4,
  mythic: 5,
};
const ROLE_ATTACK_RANGES: Record<string, number> = {
  DPS_FISICO: 120,
  DPS_MAGICO: 500,
  DPS_DEBUFFER: 300,
  INVOCADOR: 300,
  SOPORTE: 530,
};
const ROLE_DESIRED_RANGES: Record<string, number> = {
  DPS_FISICO: 117.4,
  DPS_MAGICO: 487.4,
  DPS_DEBUFFER: 289.4,
  INVOCADOR: 289.4,
  SOPORTE: 517.4,
};
const ROLE_MOVE_SPEEDS: Record<string, number> = {
  DPS_FISICO: 50,
  DPS_MAGICO: 40,
  DPS_DEBUFFER: 43,
  INVOCADOR: 42,
  SOPORTE: 32,
};
const DEFAULT_ATTACK_INTERVAL = 1.45;
const DEFAULT_MAX_ENERGY = 100;
const DEFAULT_CRIT_CHANCE = 0.08;
const DEFAULT_CRIT_DAMAGE = 1.5;

const payload = JSON.parse(readFileSync(CARD_BALANCE_PATH, "utf-8")) as CardBalancePayload;

export const CARD_BALANCE_SCHEMA_VERSION = Number(payload.schemaVersion ?? 1) || 1;
export const CARD_PM_FORMULA = payload.pmFormula;
export const CARD_BALANCE_DEFINITIONS: ReadonlyArray<CardBalanceDefinition> = Object.freeze(
  finalizeDefinitions(resolveDerivedDefinitives(
    (Array.isArray(payload.definitions) ? payload.definitions : []).map((definition) => normalizeDefinition(definition)),
    payload.pmFormula,
  )),
);

const CARD_BALANCE_INDEX = new Map(
  CARD_BALANCE_DEFINITIONS.map((definition) => [buildCardBalanceKey(definition.characterKey, definition.cardType), definition]),
);

export function buildCardBalanceKey(characterKey: string, cardType: string) {
  return `${normalizeCharacterKey(characterKey)}::${normalizeCardType(cardType)}`;
}

export function getCardBalance(characterKey: string, cardType: string) {
  return CARD_BALANCE_INDEX.get(buildCardBalanceKey(characterKey, cardType)) ?? null;
}

export function requireCardBalance(characterKey: string, cardType: string) {
  const definition = getCardBalance(characterKey, cardType);
  if (definition == null) {
    throw new Error(`Missing card balance definition for ${characterKey} ${cardType}`);
  }
  return definition;
}

export function hasCardBalance(characterKey: string, cardType: string) {
  return CARD_BALANCE_INDEX.has(buildCardBalanceKey(characterKey, cardType));
}

export function getBalancedCardsByRarityAndType(rarity: string, cardType: string) {
  const normalizedType = normalizeCardType(cardType);
  const normalizedRarity = normalizeCardRarity(rarity);
  return CARD_BALANCE_DEFINITIONS.filter(
    (definition) => definition.cardType === normalizedType && definition.rarity === normalizedRarity,
  );
}

export function getCardMaxLevel(cardType: string, rarity: string) {
  const normalizedType = normalizeCardType(cardType);
  const normalizedRarity = normalizeCardRarity(rarity);
  return CARD_MAX_LEVEL_BY_TYPE_AND_RARITY[normalizedType][normalizedRarity];
}

export function getCardMaxAscension(cardType: string, rarity: string) {
  const normalizedType = normalizeCardType(cardType);
  const normalizedRarity = normalizeCardRarity(rarity);
  return CARD_MAX_ASCENSION_BY_TYPE_AND_RARITY[normalizedType][normalizedRarity];
}

export function getCardLevelCapForAscension(cardType: string, rarity: string, ascension: number) {
  const maxLevel = getCardMaxLevel(cardType, rarity);
  const maxAscension = getCardMaxAscension(cardType, rarity);
  const normalizedAscension = Math.max(0, Math.min(Math.floor(Number(ascension) || 0), maxAscension));
  if (normalizedAscension >= 5 || normalizedAscension >= maxAscension) {
    return maxLevel;
  }
  return CARD_ASCENSION_LEVEL_CAPS[normalizedAscension] ?? maxLevel;
}

export function getCardAscensionStatBonus(ascension: number) {
  const normalizedAscension = Math.max(0, Math.floor(Number(ascension) || 0));
  return getCardAscensionMultiplier(normalizedAscension) - 1;
}

export function getCardAscensionMultiplier(ascension: number) {
  const normalizedAscension = Math.max(0, Math.min(5, Math.floor(Number(ascension) || 0)));
  return CARD_ASCENSION_STAT_MULTIPLIER[normalizedAscension] ?? 1;
}

export function calculateCardFinalStats(
  definition: Pick<CardBalanceDefinition, "stats" | "scaling" | "cardType" | "rarity">,
  level: number,
  ascension: number,
  equipmentBonus: Partial<Pick<CardFinalStats, "ad" | "ap" | "hp">> = {},
): CardFinalStats {
  const cardType = normalizeCardType(definition.cardType);
  const rarity = normalizeCardRarity(definition.rarity);
  const growth = CARD_STAT_GROWTH_BY_TYPE_AND_RARITY[cardType][rarity];
  const normalizedLevel = Math.max(1, Math.floor(Number(level) || 1));
  const ascMult = getCardAscensionMultiplier(ascension);
  const baseAd = Math.max(0, Math.floor(Number(definition.stats?.ad ?? 0) || 0));
  const baseAp = Math.max(0, Math.floor(Number(definition.stats?.ap ?? 0) || 0));
  const baseHp = Math.max(0, Math.floor(Number(definition.stats?.hp ?? 0) || 0));
  const baseVel = Number(definition.stats?.vel ?? 0) || 0;
  const levelIndex = normalizedLevel - 1;
  const ad = Math.floor(baseAd * (1 + growth.atkGrowth * levelIndex) * ascMult) + Math.max(0, Math.floor(Number(equipmentBonus.ad ?? 0) || 0));
  const ap = Math.floor(baseAp * (1 + growth.atkGrowth * levelIndex) * ascMult) + Math.max(0, Math.floor(Number(equipmentBonus.ap ?? 0) || 0));
  const hp = Math.floor(baseHp * (1 + growth.hpGrowth * levelIndex) * ascMult) + Math.max(0, Math.floor(Number(equipmentBonus.hp ?? 0) || 0));
  const vel = baseVel;
  const pm = Math.round(ad + ap + hp * 0.10 + vel * 80);
  return {
    ad,
    ap,
    hp,
    vel,
    pm,
    atk: calculateAttackValue(ad, ap, pm, String(definition.scaling ?? "")),
    speed: vel,
  };
}

export function getCardFinalStats(
  characterKey: string,
  cardType: string,
  level: number,
  ascension: number,
  equipmentBonus: Partial<Pick<CardFinalStats, "ad" | "ap" | "hp">> = {},
): CardFinalStats {
  const definition = getCardBalance(characterKey, cardType);
  if (definition == null) {
    return { ad: 0, ap: 0, hp: 0, vel: 0, pm: 0, atk: 1, speed: 0 };
  }
  return calculateCardFinalStats(definition, level, ascension, equipmentBonus);
}

export function canCardLevelUp(cardType: string, rarity: string, level: number, ascension: number) {
  const normalizedLevel = Math.max(1, Math.floor(Number(level) || 1));
  return normalizedLevel < getCardLevelCapForAscension(cardType, rarity, ascension);
}

export function cardRequiresAscensionToLevel(cardType: string, rarity: string, level: number, ascension: number) {
  const normalizedLevel = Math.max(1, Math.floor(Number(level) || 1));
  const maxAscension = getCardMaxAscension(cardType, rarity);
  const normalizedAscension = Math.max(0, Math.min(Math.floor(Number(ascension) || 0), maxAscension));
  return normalizedAscension < maxAscension && normalizedLevel >= getCardLevelCapForAscension(cardType, rarity, normalizedAscension);
}

export function getCardXpForNextLevel(level: number) {
  const normalizedLevel = Math.max(1, Math.floor(Number(level) || 1));
  const levelIndex = normalizedLevel - 1;
  return Math.floor(
    CARD_XP_CURVE.baseCost +
      levelIndex * CARD_XP_CURVE.linearGrowth +
      levelIndex * levelIndex * CARD_XP_CURVE.quadraticGrowth,
  );
}

export function canCardGainXp(cardType: string, rarity: string, level: number, ascension: number) {
  return canCardLevelUp(cardType, rarity, level, ascension);
}

export function getCardMaxStars(cardType: string, rarity: string) {
  const normalizedType = normalizeCardType(cardType);
  const normalizedRarity = normalizeCardRarity(rarity);
  return normalizedType === "DEFINITIVA" || normalizedRarity === "mythic" ? 6 : 5;
}

export function getCardStarsForLevel(cardType: string, rarity: string, level: number) {
  const normalizedLevel = Math.max(1, Math.floor(Number(level) || 1));
  const derivedStars = 1 + Math.floor(normalizedLevel / 20);
  return Math.max(1, Math.min(derivedStars, getCardMaxStars(cardType, rarity)));
}

export function getCardImproveTotalGold(cardType: string, rarity: string) {
  const normalizedType = normalizeCardType(cardType);
  const normalizedRarity = normalizeCardRarity(rarity);
  return CARD_IMPROVE_TOTAL_GOLD_BY_TYPE_AND_RARITY[normalizedType][normalizedRarity];
}

export function getCardImproveTotalFragments(cardType: string, rarity: string) {
  const normalizedType = normalizeCardType(cardType);
  const normalizedRarity = normalizeCardRarity(rarity);
  return CARD_IMPROVE_TOTAL_FRAGMENTS_BY_TYPE_AND_RARITY[normalizedType][normalizedRarity];
}

export function getCardImproveCostForLevel(cardType: string, rarity: string, currentLevel: number) {
  const normalizedType = normalizeCardType(cardType);
  const normalizedRarity = normalizeCardRarity(rarity);
  const normalizedLevel = Math.max(1, Math.floor(Number(currentLevel) || 1));
  const maxLevel = getCardMaxLevel(normalizedType, normalizedRarity);
  if (normalizedLevel >= maxLevel) {
    return { gold: 0, fragments: 0 };
  }

  const tier = resolveImproveTier(normalizedLevel);
  const [startLevel, endLevelExclusive] = getImproveTierBounds(tier, maxLevel);
  const totalGold = Math.floor(
    getCardImproveTotalGold(normalizedType, normalizedRarity) * CARD_IMPROVE_GOLD_DISTRIBUTION_BY_TIER[tier],
  );
  const totalFragments = Math.floor(
    getCardImproveTotalFragments(normalizedType, normalizedRarity) * CARD_IMPROVE_FRAGMENT_DISTRIBUTION_BY_TIER[tier],
  );
  const stepCount = Math.max(1, endLevelExclusive - startLevel);
  const stepIndex = Math.max(0, Math.min(normalizedLevel - startLevel, stepCount - 1));

  return {
    gold: distributeTierCost(totalGold, stepCount, stepIndex),
    fragments: distributeTierCost(totalFragments, stepCount, stepIndex),
  };
}

export function getCardUnlockElementsRequired(cardType: string, rarity: string) {
  const normalizedType = normalizeCardType(cardType);
  const normalizedRarity = normalizeCardRarity(rarity);
  return CARD_UNLOCK_ELEMENTS_BY_TYPE_AND_RARITY[normalizedType][normalizedRarity];
}

export function getCardAscensionCost(targetAscension: number) {
  const normalizedAscension = Math.max(1, Math.floor(Number(targetAscension) || 1));
  return CARD_ASCENSION_COSTS[normalizedAscension] ?? CARD_ASCENSION_COSTS[5];
}

function resolveImproveTier(level: number) {
  if (level <= 19) return "1_20";
  if (level <= 39) return "21_40";
  if (level <= 59) return "41_60";
  if (level <= 79) return "61_80";
  return "81_plus";
}

function getImproveTierBounds(tier: string, maxLevel: number): [number, number] {
  switch (tier) {
    case "1_20":
      return [1, Math.min(maxLevel, 20)];
    case "21_40":
      return [20, Math.min(maxLevel, 40)];
    case "41_60":
      return [40, Math.min(maxLevel, 60)];
    case "61_80":
      return [60, Math.min(maxLevel, 80)];
    default:
      return [80, maxLevel];
  }
}

function distributeTierCost(total: number, stepCount: number, stepIndex: number) {
  const base = Math.floor(total / stepCount);
  const remainder = total % stepCount;
  return base + (stepIndex < remainder ? 1 : 0);
}

function normalizeDefinition(definition: CardBalanceDefinition): CardBalanceDefinition {
  return {
    characterKey: normalizeCharacterKey(definition.characterKey),
    cardType: normalizeCardType(definition.cardType),
    rarity: normalizeCardRarity(definition.rarity),
    role: String(definition.role ?? "").trim().toUpperCase(),
    damageType: String(definition.damageType ?? "").trim().toUpperCase(),
    scaling: String(definition.scaling ?? "").trim().toUpperCase(),
    stats: {
      ad: Math.floor(Number(definition.stats?.ad ?? 0) || 0),
      ap: Math.floor(Number(definition.stats?.ap ?? 0) || 0),
      hp: Math.floor(Number(definition.stats?.hp ?? 0) || 0),
      vel: Number(definition.stats?.vel ?? 0) || 0,
      pm: Math.floor(Number(definition.stats?.pm ?? 0) || 0),
    },
    basicSkill: isRecord(definition.basicSkill) ? definition.basicSkill : {},
    ultimate: isRecord(definition.ultimate) ? definition.ultimate : {},
    sort_order: Number.isFinite(Number(definition.sort_order)) ? Number(definition.sort_order) : -1,
  };
}

function resolveDerivedDefinitives(
  definitions: CardBalanceDefinition[],
  pmFormula: CardBalancePayload["pmFormula"],
): CardBalanceDefinition[] {
  const baseByCharacter = new Map(
    definitions
      .filter((definition) => definition.cardType === "BASE")
      .map((definition) => [definition.characterKey, definition] as const),
  );

  return definitions.map((definition) => {
    if (definition.cardType !== "DEFINITIVA") {
      return definition;
    }

    const base = baseByCharacter.get(definition.characterKey);
    if (base == null) {
      return definition;
    }

    const bonus = DEFINITIVE_RARITY_BONUS[definition.rarity] ?? 2;
    const derivedStats = {
      ad: base.stats.ad + bonus,
      ap: base.stats.ap + bonus,
      hp: base.stats.hp + bonus,
      vel: base.stats.vel,
      pm: calculatePm(base.stats.ad + bonus, base.stats.ap + bonus, base.stats.hp + bonus, base.stats.vel, definition.scaling, pmFormula),
    };

    return {
      ...definition,
      role: base.role,
      damageType: base.damageType,
      scaling: base.scaling,
      stats: derivedStats,
    };
  });
}

function finalizeDefinitions(definitions: CardBalanceDefinition[]) {
  return definitions.map((definition, index) => buildCanonicalDefinition(definition, index));
}

function buildCanonicalDefinition(definition: CardBalanceDefinition, fallbackSortOrder: number): CardBalanceDefinition {
  const role = String(definition.role ?? "").trim().toUpperCase();
  const attackRange = ROLE_ATTACK_RANGES[role] ?? ROLE_ATTACK_RANGES.DPS_FISICO;
  const desiredRange = ROLE_DESIRED_RANGES[role] ?? ROLE_DESIRED_RANGES.DPS_FISICO;
  const moveSpeed = ROLE_MOVE_SPEEDS[role] ?? ROLE_MOVE_SPEEDS.DPS_FISICO;
  const stats = {
    ad: Math.floor(Number(definition.stats.ad ?? 0) || 0),
    ap: Math.floor(Number(definition.stats.ap ?? 0) || 0),
    hp: Math.floor(Number(definition.stats.hp ?? 0) || 0),
    vel: Number(definition.stats.vel ?? 0) || 0,
    pm: Math.floor(Number(definition.stats.pm ?? 0) || 0),
  };
  const rarity = normalizeCardRarity(definition.rarity);
  const cardType = normalizeCardType(definition.cardType);
  const characterKey = normalizeCharacterKey(definition.characterKey);
  const explicitSortOrder = Number(definition.sort_order);
  return {
    ...definition,
    characterKey,
    character_key: characterKey,
    cardType,
    card_type: cardType,
    card_key: `${characterKey}_${cardType.toLowerCase()}_${rarity}`,
    rarity,
    damageType: String(definition.damageType ?? "").trim().toUpperCase(),
    damage_type: String(definition.damageType ?? "").trim().toUpperCase(),
    stats,
    ad: stats.ad,
    ap: stats.ap,
    hp: stats.hp,
    vel: stats.vel,
    pm: stats.pm,
    atk: calculateAttackValue(stats.ad, stats.ap, stats.pm, definition.scaling),
    speed: stats.vel,
    attack_range: attackRange,
    desired_range: desiredRange,
    move_speed: moveSpeed,
    attack_interval: DEFAULT_ATTACK_INTERVAL,
    max_energy: DEFAULT_MAX_ENERGY,
    crit_chance: DEFAULT_CRIT_CHANCE,
    crit_damage: DEFAULT_CRIT_DAMAGE,
    basicSkill: isRecord(definition.basicSkill) ? definition.basicSkill : {},
    basic_skill: isRecord(definition.basicSkill) ? definition.basicSkill : {},
    ultimate: isRecord(definition.ultimate) ? definition.ultimate : {},
    art_path: "",
    max_level: getCardMaxLevel(cardType, rarity),
    max_ascension: getCardMaxAscension(cardType, rarity),
    sort_order: Number.isFinite(explicitSortOrder) && explicitSortOrder >= 0 ? explicitSortOrder : fallbackSortOrder,
    schema_version: CARD_BALANCE_SCHEMA_VERSION,
  };
}

function calculatePm(
  ad: number,
  ap: number,
  hp: number,
  vel: number,
  scaling: string,
  pmFormula: CardBalancePayload["pmFormula"],
) {
  const hpWeight = Number(pmFormula?.hpWeight ?? 0.1) || 0.1;
  const velWeight = Number(pmFormula?.velWeight ?? 80) || 80;
  const supportMultiplier = Number(pmFormula?.supportMultiplier ?? 1.1) || 1.1;
  let value = ad + ap + hp * hpWeight + vel * velWeight;
  if (String(scaling).trim().toUpperCase() === "SUPPORT") {
    value *= supportMultiplier;
  }
  return Math.round(value);
}

function normalizeCardType(cardType: string): CardCatalogType {
  return String(cardType).trim().toUpperCase() === "DEFINITIVA" ? "DEFINITIVA" : "BASE";
}

export function normalizeCardRarity(rarity: string): CardBalanceRarity {
  switch (String(rarity).trim().toLowerCase()) {
    case "epic":
      return "epic";
    case "legendary":
      return "legendary";
    case "mythic":
      return "mythic";
    default:
      return "basic";
  }
}

export function normalizeCharacterKey(characterKey: string) {
  const normalized = String(characterKey ?? "").trim().toLowerCase();
  return CHARACTER_KEY_ALIASES[normalized] ?? normalized;
}

function calculateAttackValue(ad: number, ap: number, pm: number, scaling: string) {
  switch (String(scaling ?? "").trim().toUpperCase()) {
    case "MAGICAL":
      return Math.max(1, ap);
    case "HYBRID":
      return Math.max(1, Math.round((ad + ap) * 0.5));
    case "SUPPORT":
      return Math.max(1, Math.round(pm * 0.28));
    default:
      return Math.max(1, ad);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}
