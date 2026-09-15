import {
  PM_V2_CONTRACT,
  PM_V2_SCALINGS,
  type PmV2Band,
  type PmV2Contract,
  type PmV2Scaling,
} from "./pm-contract.js";
import {
  evaluatePmV2Rarity,
  getPmV2RarityBand,
  isPmV2CardType,
  isPmV2Rarity,
  type PmV2RarityEvaluation,
} from "./pm-rarity-bands.js";
import { getPmV2RoleProfile, isPmV2Role } from "./pm-role-profiles.js";
import { getPmV2UltimateContribution } from "./pm-ultimate-provider.js";

export interface PmV2Input {
  ad: number;
  ap: number;
  hp: number;
  attackSpeedMultiplier: number;
  scaling: string;
  role: string;
  rarity: string;
  cardType: string;
  critChance?: number;
  critDamageMultiplier?: number;
  explicitBasicAttackPower?: number;
}

export interface PmV2Breakdown {
  role: string;
  attackPower: number;
  expectedCritMultiplier: number;
  basicDps: number;
  offenseIndex: number;
  survivalIndex: number;
  offenseContribution: number;
  survivalContribution: number;
  ultimateContribution: 0;
  statisticalPowerIndex: number;
  roleProfile: {
    offenseWeight: number;
    survivalWeight: number;
    referenceBasicDps: number;
    referenceHp: number;
  };
}

export type PmV2CalculationResult =
  | {
      ok: true;
      pm: number;
      breakdown: PmV2Breakdown;
      rarityBand: Readonly<PmV2Band>;
      rarityEvaluation: Readonly<PmV2RarityEvaluation>;
      withinRarityBand: boolean;
      contractId: string;
      contractSchemaVersion: number;
      runtimeEnabled: boolean;
    }
  | {
      ok: false;
      errors: string[];
      contractId: string;
      contractSchemaVersion: number;
      runtimeEnabled: boolean;
    };

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function calculatePmV2Preview(
  input: Readonly<PmV2Input>,
  contract: Readonly<PmV2Contract> = PM_V2_CONTRACT,
): PmV2CalculationResult {
  const errors: string[] = [];
  const scaling = String(input.scaling ?? "").trim().toUpperCase();
  const role = String(input.role ?? "").trim().toUpperCase();
  const rarity = String(input.rarity ?? "").trim().toLowerCase();
  const cardType = String(input.cardType ?? "").trim().toUpperCase();

  for (const [name, value] of [["ad", input.ad], ["ap", input.ap], ["hp", input.hp]] as const) {
    if (!isFiniteNumber(value) || value < 0) errors.push(`${name} must be a finite non-negative number`);
  }
  if (!isFiniteNumber(input.attackSpeedMultiplier)) {
    errors.push("attackSpeedMultiplier must be finite");
  } else if (
    input.attackSpeedMultiplier < contract.constants.minimumAttackSpeedMultiplier
    || input.attackSpeedMultiplier > contract.constants.maximumAttackSpeedMultiplier
  ) {
    errors.push("attackSpeedMultiplier is outside the PM V2 calibration range");
  }
  if (!(PM_V2_SCALINGS as readonly string[]).includes(scaling)) errors.push(`unknown scaling: ${scaling}`);
  if (!isPmV2Role(role)) errors.push(`unknown role: ${role}`);
  if (!isPmV2Rarity(rarity)) errors.push(`unknown rarity: ${rarity}`);
  if (!isPmV2CardType(cardType)) errors.push(`unknown card type: ${cardType}`);

  const critChance = input.critChance ?? contract.constants.defaultCritChance;
  const critDamageMultiplier = input.critDamageMultiplier ?? contract.constants.defaultCritDamageMultiplier;
  if (!isFiniteNumber(critChance) || critChance < 0 || critChance > 1) {
    errors.push("critChance must be between 0 and 1");
  }
  if (!isFiniteNumber(critDamageMultiplier) || critDamageMultiplier < 1) {
    errors.push("critDamageMultiplier must be at least 1");
  }
  if (scaling === "SUPPORT" && (!isFiniteNumber(input.explicitBasicAttackPower) || input.explicitBasicAttackPower < 0)) {
    errors.push("SUPPORT requires explicitBasicAttackPower");
  }

  if (errors.length > 0 || !isPmV2Role(role) || !isPmV2Rarity(rarity) || !isPmV2CardType(cardType)) {
    return {
      ok: false,
      errors,
      contractId: contract.contractId,
      contractSchemaVersion: contract.schemaVersion,
      runtimeEnabled: contract.runtimeEnabled,
    };
  }

  const attackPower = calculateAttackPower(input, scaling as PmV2Scaling);
  const expectedCritMultiplier = 1 + critChance * (critDamageMultiplier - 1);
  const basicDps = attackPower * input.attackSpeedMultiplier
    / contract.constants.baseAttackIntervalSeconds
    * expectedCritMultiplier;
  const profile = getPmV2RoleProfile(role, contract);
  const offenseIndex = basicDps / profile.referenceBasicDps;
  const survivalIndex = input.hp / profile.referenceHp;
  const offenseContribution = profile.offenseWeight * offenseIndex;
  const survivalContribution = profile.survivalWeight * survivalIndex;
  const ultimateContribution = getPmV2UltimateContribution();
  const statisticalPowerIndex = offenseContribution + survivalContribution + ultimateContribution;
  const pm = Math.round(contract.constants.referencePm * statisticalPowerIndex);
  const rarityBand = getPmV2RarityBand(cardType, rarity, contract);
  const rarityEvaluation = evaluatePmV2Rarity(pm, cardType, rarity, contract);

  return {
    ok: true,
    pm,
    breakdown: {
      role,
      attackPower,
      expectedCritMultiplier,
      basicDps,
      offenseIndex,
      survivalIndex,
      offenseContribution,
      survivalContribution,
      ultimateContribution,
      statisticalPowerIndex,
      roleProfile: {
        offenseWeight: profile.offenseWeight,
        survivalWeight: profile.survivalWeight,
        referenceBasicDps: profile.referenceBasicDps,
        referenceHp: profile.referenceHp,
      },
    },
    rarityBand,
    rarityEvaluation,
    withinRarityBand: rarityEvaluation.status === "WITHIN",
    contractId: contract.contractId,
    contractSchemaVersion: contract.schemaVersion,
    runtimeEnabled: contract.runtimeEnabled,
  };
}

function calculateAttackPower(input: Readonly<PmV2Input>, scaling: PmV2Scaling): number {
  switch (scaling) {
    case "MAGICAL":
      return input.ap;
    case "HYBRID":
      return (input.ad + input.ap) / 2;
    case "SUPPORT":
      return input.explicitBasicAttackPower!;
    case "PHYSICAL":
      return input.ad;
  }
}
