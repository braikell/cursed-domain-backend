import type { SupabaseClient } from "@supabase/supabase-js";

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

export function guaranteedRates(
  rates: Array<{ cardType: string; rate: number }>,
  packId: string,
): Array<{ cardType: string; rate: number }> {
  const tier = getGuaranteeTier(packId);
  const nonTarget = rates.filter((entry) => !cardTypeMatchesTier(entry.cardType, tier));
  const targetEntries = rates.filter((entry) => cardTypeMatchesTier(entry.cardType, tier));
  const nonTargetTotal = nonTarget.reduce((sum, entry) => sum + entry.rate, 0);
  if (nonTargetTotal <= 0) return rates;

  const boost = nonTargetTotal * 0.999;
  const targetTotal = targetEntries.reduce((sum, entry) => sum + entry.rate, 0);

  const adjusted: Array<{ cardType: string; rate: number }> = nonTarget.map((entry) => ({
    cardType: entry.cardType,
    rate: Math.max(0, entry.rate - (entry.rate / nonTargetTotal) * boost),
  }));

  for (const entry of targetEntries) {
    const share = targetTotal > 0 ? entry.rate / targetTotal : 1 / targetEntries.length;
    adjusted.push({ cardType: entry.cardType, rate: entry.rate + boost * share });
  }

  return adjusted;
}
