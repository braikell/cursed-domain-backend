import {
  CARD_BALANCE_DEFINITIONS,
  CARD_PM_FORMULA,
  calculateSupportBasicAttackPower,
  type CardBalanceDefinition,
} from "../balance.js";
import { buildPmV2InputFromCard } from "./pm-card-adapter.js";
import { calculatePmV2Preview } from "./pm-calculator.js";
import type { PmV2BandStatus } from "./pm-rarity-bands.js";

export interface PmV2StatSet {
  ad: number;
  ap: number;
  hp: number;
  vel: number;
  pm: number;
  basicAttackPower?: number;
}

export interface PmV2BalanceProposal {
  characterKey: string;
  cardType: string;
  rarity: string;
  role: string;
  scaling: string;
  previousStatus: PmV2BandStatus;
  targetPm: number;
  previousV2Pm: number;
  proposedV2Pm: number;
  proposedStatus: PmV2BandStatus;
  scale: number;
  stagedIterations: number;
  before: PmV2StatSet;
  proposed: PmV2StatSet;
}

function legacyPm(ad: number, ap: number, hp: number, vel: number, scaling: string): number {
  const subtotal = ad + ap + hp * CARD_PM_FORMULA.hpWeight + vel * CARD_PM_FORMULA.velWeight;
  return Math.round(subtotal * (scaling === "SUPPORT" ? CARD_PM_FORMULA.supportMultiplier : 1));
}

function buildStats(definition: CardBalanceDefinition, scale: number): PmV2StatSet {
  const scaling = String(definition.scaling).trim().toUpperCase();
  const source = definition.stats;
  const stats: PmV2StatSet = {
    ad: scaling === "PHYSICAL" || scaling === "HYBRID" || scaling === "SUPPORT" ? Math.round(source.ad * scale) : source.ad,
    ap: scaling === "MAGICAL" || scaling === "HYBRID" || scaling === "SUPPORT" ? Math.round(source.ap * scale) : source.ap,
    hp: Math.round(source.hp * scale),
    vel: source.vel,
    pm: 0,
  };
  stats.pm = legacyPm(stats.ad, stats.ap, stats.hp, stats.vel, scaling);
  if (scaling === "SUPPORT") {
    stats.basicAttackPower = calculateSupportBasicAttackPower(stats.ad, stats.ap, stats.hp, stats.vel);
  }
  return stats;
}

function calculatePreview(definition: CardBalanceDefinition, stats: PmV2StatSet) {
  const input = buildPmV2InputFromCard(definition, {
    ...stats,
    atk: stats.basicAttackPower ?? (definition.scaling === "MAGICAL" ? stats.ap : definition.scaling === "HYBRID" ? Math.round((stats.ad + stats.ap) / 2) : stats.ad),
    basic_attack_power: stats.basicAttackPower,
    attack_speed_multiplier: stats.vel,
    speed: stats.vel,
  });
  return calculatePmV2Preview(input);
}

function stagedIterations(scale: number): number {
  if (Math.abs(scale - 1) < 0.000001) return 0;
  return scale > 1
    ? Math.ceil(Math.log(scale) / Math.log(1.08))
    : Math.ceil(Math.log(scale) / Math.log(0.92));
}

export function planPmV2LevelOneBalance(): PmV2BalanceProposal[] {
  return CARD_BALANCE_DEFINITIONS.map((definition) => {
    const before = buildStats(definition, 1);
    const current = calculatePreview(definition, before);
    if (!current.ok) throw new Error(`${definition.characterKey} ${definition.cardType}: ${current.errors.join(", ")}`);
    const targetPm = current.rarityEvaluation.status === "BELOW"
      ? current.rarityEvaluation.minimumPm
      : current.rarityEvaluation.status === "ABOVE"
        ? current.rarityEvaluation.maximumPm
        : current.pm;

    let bestStats = before;
    let bestPm = current.pm;
    let bestScale = 1;
    let bestDistance = Math.abs(current.pm - targetPm);
    let bestIsWithin = current.rarityEvaluation.status === "WITHIN";
    if (current.rarityEvaluation.status !== "WITHIN") {
      for (let step = 5000; step <= 18000; step += 1) {
        const scale = step / 10000;
        const candidate = buildStats(definition, scale);
        const preview = calculatePreview(definition, candidate);
        if (!preview.ok) continue;
        const distance = Math.abs(preview.pm - targetPm);
        const isWithin = preview.rarityEvaluation.status === "WITHIN";
        if (
          (isWithin && !bestIsWithin)
          || (isWithin === bestIsWithin && distance < bestDistance)
          || (isWithin === bestIsWithin && distance === bestDistance && Math.abs(scale - 1) < Math.abs(bestScale - 1))
        ) {
          bestStats = candidate;
          bestPm = preview.pm;
          bestScale = scale;
          bestDistance = distance;
          bestIsWithin = isWithin;
        }
      }
    }

    const proposedPreview = calculatePreview(definition, bestStats);
    if (!proposedPreview.ok) {
      throw new Error(`${definition.characterKey} ${definition.cardType}: invalid proposal`);
    }

    return {
      characterKey: definition.characterKey,
      cardType: definition.cardType,
      rarity: definition.rarity,
      role: definition.role,
      scaling: definition.scaling,
      previousStatus: current.rarityEvaluation.status,
      targetPm,
      previousV2Pm: current.pm,
      proposedV2Pm: bestPm,
      proposedStatus: proposedPreview.rarityEvaluation.status,
      scale: Math.round(bestScale * 10000) / 10000,
      stagedIterations: stagedIterations(bestScale),
      before,
      proposed: bestStats,
    };
  });
}
