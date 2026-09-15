import { readFileSync } from "node:fs";

export const PM_V2_ROLES = [
  "VANGUARDIA",
  "DPS_FISICO",
  "DPS_MAGICO",
  "DPS_DEBUFFER",
  "INVOCADOR",
  "SOPORTE",
] as const;
export const PM_V2_SCALINGS = ["PHYSICAL", "MAGICAL", "HYBRID", "SUPPORT"] as const;
export const PM_V2_RARITIES = ["basic", "epic", "legendary", "mythic"] as const;
export const PM_V2_CARD_TYPES = ["BASE", "DEFINITIVA"] as const;

export type PmV2Role = (typeof PM_V2_ROLES)[number];
export type PmV2Scaling = (typeof PM_V2_SCALINGS)[number];
export type PmV2Rarity = (typeof PM_V2_RARITIES)[number];
export type PmV2CardType = (typeof PM_V2_CARD_TYPES)[number];

export interface PmV2RoleProfile {
  offenseWeight: number;
  survivalWeight: number;
  referenceBasicDps: number;
  referenceHp: number;
}

export interface PmV2Band {
  minimumPm: number;
  maximumPm: number;
}

export interface PmV2Contract {
  schemaVersion: number;
  contractId: string;
  status: "specified" | "active";
  runtimeEnabled: boolean;
  scope: {
    name: string;
    levelOneCalibration: boolean;
    includes: string[];
    excludes: string[];
  };
  constants: {
    referencePm: number;
    baseAttackIntervalSeconds: number;
    defaultCritChance: number;
    defaultCritDamageMultiplier: number;
    minimumAttackSpeedMultiplier: number;
    maximumAttackSpeedMultiplier: number;
    balanceTolerance: number;
  };
  attackPower: Record<PmV2Scaling, string>;
  formula: Record<string, string>;
  roleProfiles: Record<PmV2Role, PmV2RoleProfile>;
  rarityTargets: Record<PmV2Rarity, number>;
  cardTypeTargets: Record<PmV2CardType, number>;
  levelOneBands: Record<PmV2CardType, Record<PmV2Rarity, PmV2Band>>;
  rules: {
    rarityIsNotAppliedInsidePmFormula: boolean;
    rarityDefinesBalanceTargetOnly: boolean;
    rarityOrderingAppliesAtEqualProgression: boolean;
    rarityOrderingScope: "within_card_type";
    individualHeroTargetsAreAuthoritative: boolean;
    unknownRoleIsError: boolean;
    unknownScalingIsError: boolean;
    negativeStatIsError: boolean;
    invalidNumberIsError: boolean;
    rounding: string;
    ultimateContribution: number;
  };
  activationRequirements: string[];
}

const CONTRACT_PATH = new URL(
  "../../../../data/card_power_rating_v2.contract.json",
  import.meta.url,
);

function loadSpecifiedContract(): Readonly<PmV2Contract> {
  const contract = JSON.parse(readFileSync(CONTRACT_PATH, "utf8")) as PmV2Contract;
  if (contract.schemaVersion !== 1 || contract.contractId !== "card-pm-v2-statistical") {
    throw new Error("Unsupported PM V2 contract");
  }
  const validLifecycle = (contract.status === "specified" && contract.runtimeEnabled === false)
    || (contract.status === "active" && contract.runtimeEnabled === true);
  if (!validLifecycle) {
    throw new Error("PM V2 contract lifecycle is inconsistent");
  }
  return Object.freeze(contract);
}

export const PM_V2_CONTRACT = loadSpecifiedContract();
