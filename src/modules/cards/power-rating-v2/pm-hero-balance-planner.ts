import {
  CARD_BALANCE_DEFINITIONS,
  CARD_PM_FORMULA,
  calculateCardFinalStats,
  calculateSupportBasicAttackPower,
  type CardBalanceDefinition,
} from "../balance.js";
import { calculatePmV2Preview } from "./pm-calculator.js";
import {
  PM_V2_HERO_TARGET_BY_KEY,
  type PmHeroTarget,
  type PmHeroIdentity,
} from "./pm-hero-targets.js";
import type { PmV2StatSet } from "./pm-balance-planner.js";

export interface PmHeroBalanceProposal {
  characterKey: string;
  cardType: string;
  rarity: string;
  role: string;
  scaling: string;
  identity: PmHeroIdentity;
  currentPm: number;
  targetPm: number;
  before: PmV2StatSet;
  proposed: PmV2StatSet;
  effectiveAttackBefore: number;
  effectiveAttackAfter: number;
}

function legacyPm(ad: number, ap: number, hp: number, vel: number, scaling: string): number {
  let value = ad + ap + hp * CARD_PM_FORMULA.hpWeight + vel * CARD_PM_FORMULA.velWeight;
  if (scaling === "SUPPORT") value *= CARD_PM_FORMULA.supportMultiplier;
  return Math.round(value);
}

function effectiveAttack(stats: PmV2StatSet, scaling: string): number {
  if (scaling === "MAGICAL") return stats.ap;
  if (scaling === "HYBRID") return (stats.ad + stats.ap) / 2;
  if (scaling === "SUPPORT") return stats.basicAttackPower ?? 0;
  return stats.ad;
}

function buildCandidate(
  definition: CardBalanceDefinition,
  before: PmV2StatSet,
  attackDelta: number,
  hp: number,
): PmV2StatSet | null {
  const scaling = definition.scaling;
  const candidate: PmV2StatSet = { ...before, hp, pm: 0 };
  if (scaling === "PHYSICAL") candidate.ad = before.ad + attackDelta;
  else if (scaling === "MAGICAL") candidate.ap = before.ap + attackDelta;
  else {
    candidate.ad = before.ad + attackDelta;
    candidate.ap = before.ap + attackDelta;
  }
  if (candidate.ad < 0 || candidate.ap < 0 || candidate.hp <= 0) return null;
  candidate.pm = legacyPm(candidate.ad, candidate.ap, candidate.hp, candidate.vel, scaling);
  if (scaling === "SUPPORT") {
    candidate.basicAttackPower = calculateSupportBasicAttackPower(
      candidate.ad,
      candidate.ap,
      candidate.hp,
      candidate.vel,
    );
  } else {
    delete candidate.basicAttackPower;
  }
  return candidate;
}

function calculateV2(definition: CardBalanceDefinition, stats: PmV2StatSet): number {
  const result = calculatePmV2Preview({
    ad: stats.ad,
    ap: stats.ap,
    hp: stats.hp,
    attackSpeedMultiplier: stats.vel,
    scaling: definition.scaling,
    role: definition.role,
    rarity: definition.rarity,
    cardType: definition.cardType,
    critChance: definition.crit_chance,
    critDamageMultiplier: definition.crit_damage,
    ...(definition.scaling === "SUPPORT" ? { explicitBasicAttackPower: stats.basicAttackPower } : {}),
  });
  if (!result.ok) throw new Error(definition.characterKey + " " + definition.cardType + ": " + result.errors.join(", "));
  return result.pm;
}

function candidateScore(
  identity: PmHeroIdentity,
  before: PmV2StatSet,
  candidate: PmV2StatSet,
  scaling: string,
): number {
  const effectiveAttackChange = Math.abs(effectiveAttack(candidate, scaling) - effectiveAttack(before, scaling))
    / Math.max(1, effectiveAttack(before, scaling));
  const rawSupportAttackChange = Math.max(
    Math.abs(candidate.ad - before.ad) / Math.max(1, before.ad),
    Math.abs(candidate.ap - before.ap) / Math.max(1, before.ap),
  );
  const attackChange = scaling === "SUPPORT" ? rawSupportAttackChange : effectiveAttackChange;
  const hpChange = Math.abs(candidate.hp - before.hp) / Math.max(1, before.hp);
  if (identity === "OFFENSE") return attackChange + hpChange * 8 + Math.max(attackChange, hpChange) * 0.01;
  if (identity === "SURVIVAL") return attackChange * 8 + hpChange + Math.max(attackChange, hpChange) * 0.01;
  return attackChange + hpChange + Math.abs(attackChange - hpChange) * 4;
}

function findExactCandidate(
  definition: CardBalanceDefinition,
  before: PmV2StatSet,
  target: PmHeroTarget,
): PmV2StatSet {
  const targetPm = target.targetPm;
  const identity = target.identity;
  const meetsConstraints = (candidate: PmV2StatSet): boolean => {
    const attack = effectiveAttack(candidate, definition.scaling);
    return (target.minimumEffectiveAttack == null || attack >= target.minimumEffectiveAttack)
      && (target.maximumEffectiveAttack == null || attack <= target.maximumEffectiveAttack);
  };
  if (calculateV2(definition, before) === targetPm && meetsConstraints(before)) return { ...before };
  let best: PmV2StatSet | null = null;
  let bestScore = Number.POSITIVE_INFINITY;
  const hpMinimum = Math.max(1, before.hp - 2000);
  const hpMaximum = before.hp + 2000;
  for (let attackDelta = -200; attackDelta <= 200; attackDelta += 1) {
    let low = hpMinimum;
    let high = hpMaximum;
    while (low <= high) {
      const middle = Math.floor((low + high) / 2);
      const candidate = buildCandidate(definition, before, attackDelta, middle);
      if (candidate == null) break;
      const pm = calculateV2(definition, candidate);
      if (pm < targetPm) low = middle + 1;
      else high = middle - 1;
    }
    for (let hp = Math.max(hpMinimum, high - 3); hp <= Math.min(hpMaximum, low + 3); hp += 1) {
      const candidate = buildCandidate(definition, before, attackDelta, hp);
      if (candidate == null || calculateV2(definition, candidate) !== targetPm || !meetsConstraints(candidate)) continue;
      const score = candidateScore(identity, before, candidate, definition.scaling);
      if (score < bestScore) {
        best = candidate;
        bestScore = score;
      }
    }
  }
  if (best == null) {
    throw new Error("No exact stat solution for " + definition.characterKey + " " + definition.cardType + " at " + targetPm + " PM");
  }
  return best;
}

export function planPmV2HeroTargets(): PmHeroBalanceProposal[] {
  return CARD_BALANCE_DEFINITIONS.map((definition) => {
    const key = definition.characterKey + "::" + definition.cardType;
    const target = PM_V2_HERO_TARGET_BY_KEY.get(key);
    if (target == null) throw new Error("Missing PM V2 hero target for " + key);
    const finalStats = calculateCardFinalStats(definition, 1, 0);
    const before: PmV2StatSet = {
      ad: finalStats.ad,
      ap: finalStats.ap,
      hp: finalStats.hp,
      vel: finalStats.vel,
      pm: finalStats.pm_legacy,
      ...(finalStats.basicAttackPower != null ? { basicAttackPower: finalStats.basicAttackPower } : {}),
    };
    const currentPm = calculateV2(definition, before);
    const proposed = findExactCandidate(definition, before, target);
    return {
      characterKey: definition.characterKey,
      cardType: definition.cardType,
      rarity: definition.rarity,
      role: definition.role,
      scaling: definition.scaling,
      identity: target.identity,
      currentPm,
      targetPm: target.targetPm,
      before,
      proposed,
      effectiveAttackBefore: effectiveAttack(before, definition.scaling),
      effectiveAttackAfter: effectiveAttack(proposed, definition.scaling),
    };
  });
}
