import type { CardBalanceDefinition, CardFinalStats } from "../balance.js";
import { calculatePmV2Preview, type PmV2CalculationResult, type PmV2Input } from "./pm-calculator.js";

type PmV2CardDefinition = Pick<
  CardBalanceDefinition,
  "scaling" | "role" | "rarity" | "cardType" | "crit_chance" | "crit_damage"
>;

export function buildPmV2InputFromCard(
  definition: Readonly<PmV2CardDefinition>,
  stats: Readonly<Pick<CardFinalStats, "ad" | "ap" | "hp" | "atk" | "speed" | "attack_speed_multiplier" | "basicAttackPower" | "basic_attack_power">>,
): PmV2Input {
  const input: PmV2Input = {
    ad: stats.ad,
    ap: stats.ap,
    hp: stats.hp,
    attackSpeedMultiplier: stats.attack_speed_multiplier,
    scaling: definition.scaling,
    role: definition.role,
    rarity: definition.rarity,
    cardType: definition.cardType,
    critChance: definition.crit_chance,
    critDamageMultiplier: definition.crit_damage,
  };
  if (String(definition.scaling).trim().toUpperCase() === "SUPPORT") {
    input.explicitBasicAttackPower = stats.basicAttackPower ?? stats.basic_attack_power;
  }
  return input;
}

export function calculateCardPmV2Preview(
  definition: Readonly<PmV2CardDefinition>,
  stats: Readonly<Pick<CardFinalStats, "ad" | "ap" | "hp" | "atk" | "speed" | "attack_speed_multiplier" | "basicAttackPower" | "basic_attack_power">>,
): PmV2CalculationResult {
  return calculatePmV2Preview(buildPmV2InputFromCard(definition, stats));
}
