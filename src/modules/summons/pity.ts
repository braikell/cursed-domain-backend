import type { SupabaseClient } from "@supabase/supabase-js";
import { randomInt } from "node:crypto";

const PITY_CYCLE = 90;

export type PityGuaranteeTier = "legendary" | "mythic" | "definitive_legendary" | "definitive_mythic";

export interface PityState {
  counter: number;
}

export async function loadPityState(supabase: SupabaseClient, userId: string, packId: string): Promise<PityState> {
  try {
    const { data, error } = await supabase
      .from("user_pity")
      .select("target_counter")
      .eq("user_id", userId)
      .eq("pack_id", packId)
      .maybeSingle<{ target_counter: number }>();
    if (error || !data) return { counter: 0 };
    return { counter: Math.max(0, Math.floor(data.target_counter ?? 0)) };
  } catch {
    return { counter: 0 };
  }
}

export function getGuaranteeTier(packId: string): PityGuaranteeTier {
  switch (packId) {
    case "basicPack": return "legendary";
    case "epicPack": return "mythic";
    case "legendaryPack": return "definitive_legendary";
    case "mythicPack": return "definitive_mythic";
    default: return "legendary";
  }
}

export function getGuaranteeLabel(packId: string): string {
  switch (packId) {
    case "basicPack": return "LEGENDARIO";
    case "epicPack": return "MITICO";
    case "legendaryPack": return "DEF. LEGENDARIO";
    case "mythicPack": return "DEF. MITICO";
    default: return "LEGENDARIO";
  }
}

export function getPityCycle(): number { return PITY_CYCLE; }

export function isHardPity(totalCounter: number): boolean {
  return totalCounter > 0 && totalCounter % PITY_CYCLE === 0;
}

export function displayCounter(totalCounter: number): number {
  return totalCounter % PITY_CYCLE;
}

function cardTypeMatchesTier(cardType: string, tier: PityGuaranteeTier): boolean {
  switch (tier) {
    case "legendary": return cardType.includes("_legendary") || cardType.includes("_mythic");
    case "mythic": return cardType.includes("_mythic");
    case "definitive_legendary":
      return cardType.startsWith("definitive_") && (cardType.includes("_legendary") || cardType.includes("_mythic"));
    case "definitive_mythic":
      return cardType.startsWith("definitive_") && cardType.includes("_mythic");
  }
}

export function pickGuaranteedCardType(
  rates: Array<{ cardType: string; rate: number }>,
  packId: string,
): string {
  const tier = getGuaranteeTier(packId);
  const candidates = rates.filter((entry) => cardTypeMatchesTier(entry.cardType, tier));
  if (candidates.length === 0) return rates[0]?.cardType ?? "base_basic";
  return candidates[randomInt(0, candidates.length)]?.cardType ?? candidates[0]!.cardType;
}
