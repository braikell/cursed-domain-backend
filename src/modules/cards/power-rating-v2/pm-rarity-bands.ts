import {
  PM_V2_CARD_TYPES,
  PM_V2_CONTRACT,
  PM_V2_RARITIES,
  type PmV2Band,
  type PmV2CardType,
  type PmV2Contract,
  type PmV2Rarity,
} from "./pm-contract.js";

export function isPmV2Rarity(value: string): value is PmV2Rarity {
  return (PM_V2_RARITIES as readonly string[]).includes(value);
}

export function isPmV2CardType(value: string): value is PmV2CardType {
  return (PM_V2_CARD_TYPES as readonly string[]).includes(value);
}

export function getPmV2RarityBand(
  cardType: PmV2CardType,
  rarity: PmV2Rarity,
  contract: Readonly<PmV2Contract> = PM_V2_CONTRACT,
): Readonly<PmV2Band> {
  return contract.levelOneBands[cardType][rarity];
}

export function isPmV2WithinRarityBand(pm: number, band: Readonly<PmV2Band>): boolean {
  return pm >= band.minimumPm && pm <= band.maximumPm;
}

export type PmV2BandStatus = "BELOW" | "WITHIN" | "ABOVE";

export interface PmV2RarityEvaluation {
  rarity: PmV2Rarity;
  cardType: PmV2CardType;
  rarityTarget: number;
  cardTypeTarget: number;
  combinedTarget: number;
  targetPm: number;
  minimumPm: number;
  maximumPm: number;
  deltaFromTargetPm: number;
  deltaPercent: number;
  distanceToBandPm: number;
  status: PmV2BandStatus;
}

export function evaluatePmV2Rarity(
  pm: number,
  cardType: PmV2CardType,
  rarity: PmV2Rarity,
  contract: Readonly<PmV2Contract> = PM_V2_CONTRACT,
): Readonly<PmV2RarityEvaluation> {
  const band = getPmV2RarityBand(cardType, rarity, contract);
  const rarityTarget = contract.rarityTargets[rarity];
  const cardTypeTarget = contract.cardTypeTargets[cardType];
  const combinedTarget = rarityTarget * cardTypeTarget;
  const targetPm = Math.round(contract.constants.referencePm * combinedTarget);
  const status: PmV2BandStatus = pm < band.minimumPm ? "BELOW" : pm > band.maximumPm ? "ABOVE" : "WITHIN";
  const distanceToBandPm = status === "BELOW"
    ? band.minimumPm - pm
    : status === "ABOVE"
      ? pm - band.maximumPm
      : 0;
  return {
    rarity,
    cardType,
    rarityTarget,
    cardTypeTarget,
    combinedTarget,
    targetPm,
    minimumPm: band.minimumPm,
    maximumPm: band.maximumPm,
    deltaFromTargetPm: pm - targetPm,
    deltaPercent: targetPm > 0 ? (pm - targetPm) / targetPm : 0,
    distanceToBandPm,
    status,
  };
}
