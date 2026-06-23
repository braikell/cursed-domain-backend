import { readFileSync } from "node:fs";

export type CardCatalogType = "BASE" | "DEFINITIVA";
export type CardBalanceRarity = "basic" | "epic" | "legendary" | "mythic";

export interface CardCombatStats {
  ad: number;
  ap: number;
  hp: number;
  vel: number;
  pm: number;
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
  const normalizedRarity = normalizeRarity(rarity);
  return CARD_BALANCE_DEFINITIONS.filter(
    (definition) => definition.cardType === normalizedType && definition.rarity === normalizedRarity,
  );
}

function normalizeDefinition(definition: CardBalanceDefinition): CardBalanceDefinition {
  return {
    characterKey: normalizeCharacterKey(definition.characterKey),
    cardType: normalizeCardType(definition.cardType),
    rarity: normalizeRarity(definition.rarity),
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
  const rarity = normalizeRarity(definition.rarity);
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

function normalizeRarity(rarity: string): CardBalanceRarity {
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

function normalizeCharacterKey(characterKey: string) {
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
