import type { SupabaseClient } from "@supabase/supabase-js";
import { randomInt } from "node:crypto";

const PITY_CYCLE = 90;

const _counterCache = new Map<string, number>();

function cacheKey(userId: string, packId: string): string {
  return `${userId}:${packId}`;
}

export type PityGuaranteeTier = "legendary" | "mythic" | "definitive_legendary" | "definitive_mythic";

export interface PityState {
  counter: number;
}

export async function loadPityState(supabase: SupabaseClient, userId: string, packId: string): Promise<PityState> {
  const key = cacheKey(userId, packId);
  const cached = _counterCache.get(key) ?? 0;
  try {
    const { data, error } = await supabase
      .from("user_pity")
      .select("target_counter")
      .eq("user_id", userId)
      .eq("pack_id", packId)
      .maybeSingle<{ target_counter: number }>();
    if (error || !data) {
      return { counter: Math.max(0, cached) };
    }
    const dbCounter = Math.max(0, Math.floor(data.target_counter ?? 0));
    const final = Math.max(dbCounter, cached);
    _counterCache.set(key, final);
    return { counter: final };
  } catch {
    return { counter: Math.max(0, cached) };
  }
}

export function cacheCounter(userId: string, packId: string, counter: number): void {
  _counterCache.set(cacheKey(userId, packId), Math.max(0, Math.floor(counter)));
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
    case "legendary": return cardType === "base_legendary";
    case "mythic": return cardType === "base_mythic";
    case "definitive_legendary": return cardType === "definitive_legendary";
    case "definitive_mythic": return cardType === "definitive_mythic";
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
