import type { SupabaseClient } from "@supabase/supabase-js";

const PITY_SOFT_THRESHOLD = 70;
const PITY_HARD_THRESHOLD = 90;
const PITY_SOFT_BOOST_MAX = 0.30; // 30 percentage points added to legendary+mythic rates at soft pity cap

interface PityRow {
  user_id: string;
  pity_counter: number;
  updated_at: string;
}

export interface PityState {
  counter: number;
  softPityActive: boolean;
  hardPityActive: boolean;
}

export interface PityRollAdjustment {
  adjustedRates: Array<{ cardType: string; rate: number }>;
  wasPity: boolean;
}

export async function loadPityState(supabase: SupabaseClient, userId: string): Promise<PityState> {
  const { data, error } = await supabase
    .from("user_pity")
    .select("pity_counter")
    .eq("user_id", userId)
    .maybeSingle<{ pity_counter: number }>();

  if (error || !data) {
    return { counter: 0, softPityActive: false, hardPityActive: false };
  }

  const counter = Math.max(0, Math.floor(data.pity_counter ?? 0));
  return {
    counter,
    softPityActive: counter >= PITY_SOFT_THRESHOLD,
    hardPityActive: counter >= PITY_HARD_THRESHOLD,
  };
}

export async function persistPityState(
  supabase: SupabaseClient,
  userId: string,
  counter: number,
): Promise<void> {
  const { error } = await supabase.from("user_pity").upsert(
    {
      user_id: userId,
      pity_counter: Math.max(0, Math.floor(counter)),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  );
  if (error) {
    console.warn("[pity] persist failed:", error.message);
  }
}

export function isLegendaryOrMythic(cardType: string): boolean {
  return cardType.includes("_legendary") || cardType.includes("_mythic");
}

export function adjustRatesForPity(
  rates: Array<{ cardType: string; rate: number }>,
  pityState: PityState,
): PityRollAdjustment {
  if (!pityState.softPityActive && !pityState.hardPityActive) {
    return { adjustedRates: rates, wasPity: false };
  }

  if (pityState.hardPityActive) {
    const nonPremiumTotal = rates
      .filter((entry) => !isLegendaryOrMythic(entry.cardType))
      .reduce((sum, entry) => sum + entry.rate, 0);

    const boost = nonPremiumTotal * 0.999;
    return {
      adjustedRates: redistributeRates(rates, "mythic", boost),
      wasPity: true,
    };
  }

  const stepsIntoSoft = pityState.counter - PITY_SOFT_THRESHOLD;
  const softRange = PITY_HARD_THRESHOLD - PITY_SOFT_THRESHOLD;
  const softProgress = Math.min(1, stepsIntoSoft / softRange);
  const boostAmount = PITY_SOFT_BOOST_MAX * softProgress * 100;

  const premiumRates = rates.filter((entry) => isLegendaryOrMythic(entry.cardType));
  const totalPremium = premiumRates.reduce((sum, entry) => sum + entry.rate, 0);
  const totalNonPremium = 100 - totalPremium;
  const boost = Math.min(totalNonPremium * 0.99, boostAmount);

  return {
    adjustedRates: redistributeRates(rates, "legendary", boost),
    wasPity: false,
  };
}

function redistributeRates(
  rates: Array<{ cardType: string; rate: number }>,
  priorityType: "legendary" | "mythic",
  totalBoost: number,
): Array<{ cardType: string; rate: number }> {
  const priorityEntries = rates.filter((entry) => isLegendaryOrMythic(entry.cardType));
  const nonPriority = rates.filter((entry) => !isLegendaryOrMythic(entry.cardType));
  const nonPriorityTotal = nonPriority.reduce((sum, entry) => sum + entry.rate, 0);

  if (nonPriorityTotal <= 0 || totalBoost <= 0) return rates;

  const actualBoost = Math.min(totalBoost, nonPriorityTotal * 0.99);
  const priorityTotal = priorityEntries.reduce((sum, entry) => sum + entry.rate, 0);

  const adjusted: Array<{ cardType: string; rate: number }> = nonPriority.map((entry) => ({
    cardType: entry.cardType,
    rate: Math.max(0, entry.rate - (entry.rate / nonPriorityTotal) * actualBoost),
  }));

  for (const entry of priorityEntries) {
    const share = priorityTotal > 0 ? entry.rate / priorityTotal : 1 / priorityEntries.length;
    adjusted.push({
      cardType: entry.cardType,
      rate: entry.rate + actualBoost * share,
    });
  }

  return adjusted;
}
