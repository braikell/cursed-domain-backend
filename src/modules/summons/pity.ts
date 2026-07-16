import type { SupabaseClient } from "@supabase/supabase-js";

const PITY_SOFT_THRESHOLD = 70;
const PITY_HARD_THRESHOLD = 90;
const PITY_SOFT_BOOST_MAX = 0.30;

export type PityGuaranteeTier = "epic" | "legendary" | "mythic" | "definitive_legendary";

export interface PityState {
  counter: number;
  softPityActive: boolean;
  hardPityActive: boolean;
}

export interface PityRollAdjustment {
  adjustedRates: Array<{ cardType: string; rate: number }>;
  wasPity: boolean;
  guaranteeTier: PityGuaranteeTier | null;
}

export async function loadPityState(supabase: SupabaseClient, userId: string, packId: string): Promise<PityState> {
  try {
    const { data, error } = await supabase
      .from("user_pity")
      .select("target_counter")
      .eq("user_id", userId)
      .eq("pack_id", packId)
      .maybeSingle<{ target_counter: number }>();

    if (error) return { counter: 0, softPityActive: false, hardPityActive: false };
    if (!data) return { counter: 0, softPityActive: false, hardPityActive: false };

    const counter = Math.max(0, Math.floor(data.target_counter ?? 0));
    return {
      counter,
      softPityActive: counter >= PITY_SOFT_THRESHOLD,
      hardPityActive: counter >= PITY_HARD_THRESHOLD,
    };
  } catch {
    return { counter: 0, softPityActive: false, hardPityActive: false };
  }
}

export async function persistPityState(
  supabase: SupabaseClient,
  userId: string,
  packId: string,
  counter: number,
): Promise<boolean> {
  try {
    const { error } = await supabase.from("user_pity").upsert(
      {
        user_id: userId,
        pack_id: packId,
        target_counter: Math.max(0, Math.floor(counter)),
        pity_legendary: 0,
        pity_mythic: 0,
        soft_pity_step: 0,
        config_version: 1,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,pack_id" },
    );
    if (error) return false;
    return true;
  } catch {
    return false;
  }
}

// --- GARANTIA ESCALONADA ---

export function getHardPityGuaranteeTier(packId: string): PityGuaranteeTier {
  switch (packId) {
    case "basicPack": return "epic";
    case "epicPack": return "legendary";
    case "legendaryPack": return "mythic";
    case "mythicPack": return "definitive_legendary";
    default: return "epic";
  }
}

export function getHardPityLabel(packId: string): string {
  switch (packId) {
    case "basicPack": return "EPICO+";
    case "epicPack": return "LEGENDARIO+";
    case "legendaryPack": return "MITICO";
    case "mythicPack": return "DEFINITIVA L+";
    default: return "EPICO+";
  }
}

export function getSoftThreshold(): number { return PITY_SOFT_THRESHOLD; }
export function getHardThreshold(): number { return PITY_HARD_THRESHOLD; }

export function isCardTypePremium(cardType: string, tier: PityGuaranteeTier | null): boolean {
  if (tier == null) return isLegendaryOrMythic(cardType);
  return cardTypeMatchesTier(cardType, tier);
}

export function isLegendaryOrMythic(cardType: string): boolean {
  return cardType.includes("_legendary") || cardType.includes("_mythic");
}

function cardTypeMatchesTier(cardType: string, tier: PityGuaranteeTier): boolean {
  switch (tier) {
    case "epic": return cardType.includes("_epic") || cardType.includes("_legendary") || cardType.includes("_mythic");
    case "legendary": return cardType.includes("_legendary") || cardType.includes("_mythic");
    case "mythic": return cardType.includes("_mythic");
    case "definitive_legendary":
      return cardType.startsWith("definitive_") && (cardType.includes("_legendary") || cardType.includes("_mythic"));
  }
}

function softPityTargetTier(guaranteeTier: PityGuaranteeTier): PityGuaranteeTier {
  if (guaranteeTier === "epic") return "legendary";
  return guaranteeTier;
}

// --- AJUSTE DE RATES ---

export function adjustRatesForPity(
  rates: Array<{ cardType: string; rate: number }>,
  pityState: PityState,
  packId: string,
): PityRollAdjustment {
  const guaranteeTier = getHardPityGuaranteeTier(packId);

  if (!pityState.softPityActive && !pityState.hardPityActive) {
    return { adjustedRates: rates, wasPity: false, guaranteeTier: null };
  }

  if (pityState.hardPityActive) {
    return {
      adjustedRates: boostToGuaranteedTier(rates, guaranteeTier),
      wasPity: true,
      guaranteeTier,
    };
  }

  const stepsIntoSoft = pityState.counter - PITY_SOFT_THRESHOLD;
  const softRange = PITY_HARD_THRESHOLD - PITY_SOFT_THRESHOLD;
  const softProgress = Math.min(1, stepsIntoSoft / softRange);
  const boostAmount = PITY_SOFT_BOOST_MAX * softProgress * 100;

  const targetTier = softPityTargetTier(guaranteeTier);
  const boost = Math.min(
    rates.filter((entry) => !cardTypeMatchesTier(entry.cardType, targetTier))
      .reduce((sum, entry) => sum + entry.rate, 0) * 0.99,
    boostAmount,
  );

  return {
    adjustedRates: redistributeRates(rates, targetTier, boost),
    wasPity: false,
    guaranteeTier: null,
  };
}

function boostToGuaranteedTier(
  rates: Array<{ cardType: string; rate: number }>,
  tier: PityGuaranteeTier,
): Array<{ cardType: string; rate: number }> {
  const nonGuaranteedTotal = rates
    .filter((entry) => !cardTypeMatchesTier(entry.cardType, tier))
    .reduce((sum, entry) => sum + entry.rate, 0);
  return redistributeRates(rates, tier, nonGuaranteedTotal * 0.999);
}

function redistributeRates(
  rates: Array<{ cardType: string; rate: number }>,
  tier: PityGuaranteeTier,
  totalBoost: number,
): Array<{ cardType: string; rate: number }> {
  const premiumEntries = rates.filter((entry) => cardTypeMatchesTier(entry.cardType, tier));
  const nonPremium = rates.filter((entry) => !cardTypeMatchesTier(entry.cardType, tier));
  const nonPremiumTotal = nonPremium.reduce((sum, entry) => sum + entry.rate, 0);

  if (nonPremiumTotal <= 0 || totalBoost <= 0) return rates;

  const actualBoost = Math.min(totalBoost, nonPremiumTotal * 0.99);
  const premiumTotal = premiumEntries.reduce((sum, entry) => sum + entry.rate, 0);

  const adjusted: Array<{ cardType: string; rate: number }> = nonPremium.map((entry) => ({
    cardType: entry.cardType,
    rate: Math.max(0, entry.rate - (entry.rate / nonPremiumTotal) * actualBoost),
  }));

  for (const entry of premiumEntries) {
    const share = premiumTotal > 0 ? entry.rate / premiumTotal : 1 / premiumEntries.length;
    adjusted.push({
      cardType: entry.cardType,
      rate: entry.rate + actualBoost * share,
    });
  }

  return adjusted;
}
