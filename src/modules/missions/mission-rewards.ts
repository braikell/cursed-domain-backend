import type { SupabaseClient } from "@supabase/supabase-js";

import { createServiceSupabaseClient } from "../../supabase.js";
import { getBalancedCardsByRarityAndType, getCardBalance } from "../cards/balance.js";

type PackId = "basicPack" | "epicPack" | "legendaryPack" | "mythicPack";

interface UserEconomyTokens {
  pack_tokens: Record<string, number>;
  choice_tokens: Array<{
    tokenId: string;
    choiceType: string;
    options: Array<{ characterId: string; cardType: string }>;
    createdAt: string;
    missionId: string;
  }>;
}

export async function getPackTokens(userId: string): Promise<Record<string, number>> {
  const supabase = createServiceSupabaseClient();
  const { data, error } = await supabase
    .from("user_economy")
    .select("pack_tokens")
    .eq("user_id", userId)
    .maybeSingle<{ pack_tokens: Record<string, number> }>();

  if (error || !data?.pack_tokens) return {};
  return sanitizePackTokens(data.pack_tokens);
}

function sanitizePackTokens(tokens: unknown): Record<string, number> {
  if (!tokens || typeof tokens !== "object" || Array.isArray(tokens)) return {};
  const record = tokens as Record<string, number>;
  const cleaned: Record<string, number> = {};
  for (const [key, value] of Object.entries(record)) {
    if (typeof key === "string" && typeof value === "number" && Number.isFinite(value) && value > 0) {
      cleaned[key] = Math.floor(value);
    }
  }
  return cleaned;
}

export async function getChoiceTokens(userId: string): Promise<Array<unknown>> {
  const supabase = createServiceSupabaseClient();
  const { data, error } = await supabase
    .from("user_economy")
    .select("choice_tokens")
    .eq("user_id", userId)
    .maybeSingle<{ choice_tokens: Array<unknown> }>();

  if (error || !data?.choice_tokens) return [];
  return sanitizeChoiceTokens(data.choice_tokens);
}

function sanitizeChoiceTokens(tokens: unknown): Array<unknown> {
  if (!Array.isArray(tokens)) return [];
  return tokens.filter((t: any) =>
    t && typeof t.tokenId === "string" && typeof t.choiceType === "string" && Array.isArray(t.options)
  );
}

export async function addPackToken(userId: string, packId: string, amount = 1): Promise<Record<string, number>> {
  const supabase = createServiceSupabaseClient();
  const current = await getPackTokens(userId);
  const key = packId as string;
  current[key] = (current[key] ?? 0) + amount;

  await supabase
    .from("user_economy")
    .update({ pack_tokens: current, updated_at: new Date().toISOString() })
    .eq("user_id", userId);

  return current;
}

export async function consumePackToken(userId: string, packId: string): Promise<boolean> {
  const supabase = createServiceSupabaseClient();
  const current = await getPackTokens(userId);
  const key = packId as string;
  const available = current[key] ?? 0;

  if (available <= 0) return false;

  current[key] = available - 1;
  await supabase
    .from("user_economy")
    .update({ pack_tokens: current, updated_at: new Date().toISOString() })
    .eq("user_id", userId);

  return true;
}

export async function addChoiceToken(
  userId: string,
  missionId: string,
  choiceType: string,
  options: Array<{ characterId: string; cardType: string }>,
): Promise<Array<unknown>> {
  const supabase = createServiceSupabaseClient();
  const current = await getChoiceTokens(userId);
  const tokenId = `choice_${missionId}_${Date.now()}`;

  current.push({
    tokenId,
    missionId,
    choiceType,
    options,
    createdAt: new Date().toISOString(),
  });

  await supabase
    .from("user_economy")
    .update({ choice_tokens: current, updated_at: new Date().toISOString() })
    .eq("user_id", userId);

  return current;
}

export async function consumeChoiceToken(userId: string, tokenId: string): Promise<{ choiceType: string; characterId: string; cardType: string } | null> {
  const supabase = createServiceSupabaseClient();
  const current = await getChoiceTokens(userId);

  const index = current.findIndex((t: any) => t.tokenId === tokenId);
  if (index === -1) return null;

  const token = current[index] as any;
  current.splice(index, 1);

  await supabase
    .from("user_economy")
    .update({ choice_tokens: current, updated_at: new Date().toISOString() })
    .eq("user_id", userId);

  return {
    choiceType: token.choiceType,
    characterId: token.options?.[0]?.characterId ?? "",
    cardType: token.options?.[0]?.cardType ?? "base",
  };
}

function mapCardRarityToDefinitionRarity(rarity: string): number {
  switch (rarity.toLowerCase()) {
    case "epic": return 3;
    case "legendary": return 4;
    case "mythic": return 5;
    default: return 1;
  }
}

export async function grantSpecificCard(
  supabaseClient: SupabaseClient,
  userId: string,
  characterId: string,
  cardType: "base" | "definitiva" = "base",
): Promise<{ card: { characterId: string; cardType: string } | null }> {
  const now = new Date().toISOString();
  const normalizedId = characterId.trim().toLowerCase();
  const normalizedType = cardType.toLowerCase() === "definitiva" ? "DEFINITIVA" : "BASE";
  const balance = getCardBalance(normalizedId, normalizedType);
  const rarity = balance?.rarity ?? (normalizedType === "DEFINITIVA" ? "legendary" : "basic");
  const cardKey = balance?.card_key ?? `${normalizedId}_${normalizedType.toLowerCase()}_${rarity}`;

  const { error } = await supabaseClient.from("user_cards").insert({
    user_id: userId,
    card_definition_id: cardKey,
    character_id: normalizedId,
    character_key: normalizedId,
    variant: normalizedType === "DEFINITIVA" ? "definitive" : "base",
    card_type: normalizedType,
    rarity,
    definition_rarity: mapCardRarityToDefinitionRarity(rarity),
    card_key: cardKey,
    level: 1,
    xp: 0,
    stars: 1,
    ascension: 0,
    awakening: 0,
    fragments: 0,
    acquired_at: now,
    updated_at: now,
  });

  if (error) {
    if (error.message.includes("duplicate") || error.code === "23505") {
      return { card: { characterId: normalizedId, cardType } };
    }
    throw new Error(`Failed to grant card: ${error.message}`);
  }

  return { card: { characterId: normalizedId, cardType } };
}

export function getChoiceCardOptions(choiceType: string): Array<{ characterId: string; cardType: string; displayName: string }> {
  const options: Array<{ characterId: string; cardType: string; displayName: string }> = [];
  const seen = new Set<string>();

  if (choiceType === "epic") {
    const cards = getBalancedCardsByRarityAndType("epic", "base");
    for (const card of cards) {
      const key = `${card.characterKey}_${card.cardType}`;
      if (!seen.has(key)) {
        seen.add(key);
        options.push({ characterId: card.characterKey, cardType: card.cardType.toLowerCase(), displayName: card.characterKey });
      }
    }
  } else if (choiceType === "legendary") {
    const cards = getBalancedCardsByRarityAndType("legendary", "base");
    for (const card of cards) {
      const key = `${card.characterKey}_${card.cardType}`;
      if (!seen.has(key)) {
        seen.add(key);
        options.push({ characterId: card.characterKey, cardType: card.cardType.toLowerCase(), displayName: card.characterKey });
      }
    }
  } else if (choiceType === "definitiva") {
    const legendaryCards = getBalancedCardsByRarityAndType("legendary", "definitiva");
    const mythicCards = getBalancedCardsByRarityAndType("mythic", "definitiva");
    for (const card of [...legendaryCards, ...mythicCards]) {
      const key = `${card.characterKey}_${card.cardType}`;
      if (!seen.has(key)) {
        seen.add(key);
        options.push({ characterId: card.characterKey, cardType: card.cardType.toLowerCase(), displayName: card.characterKey });
      }
    }
  }

  return options;
}

export function getRewardLabel(rewardType: string): string {
  switch (rewardType) {
    case "basic_pack": return "Sobre Basico";
    case "epic_pack": return "Sobre Epico";
    case "legendary_pack": return "Sobre Legendario";
    case "mythic_pack": return "Sobre Mitico";
    case "choice_epic": return "Carta Epica (a eleccion)";
    case "choice_legendary": return "Carta Legendaria (a eleccion)";
    case "choice_definitiva": return "Carta Definitiva (a eleccion)";
    default: return "Oro y Gemas";
  }
}

export function getRewardColor(rewardType: string): { bg: string; border: string } {
  switch (rewardType) {
    case "basic_pack": return { bg: "1a3a6e", border: "4a8fdf" };
    case "epic_pack": return { bg: "3a1a6e", border: "9a4fdf" };
    case "legendary_pack": return { bg: "5a4a0e", border: "dfbf2f" };
    case "mythic_pack": return { bg: "2a3a2a", border: "6fcf8f" };
    case "choice_epic": return { bg: "3a1a5e", border: "bf6fdf" };
    case "choice_legendary": return { bg: "4a2a0e", border: "df8f2f" };
    case "choice_definitiva": return { bg: "1a1a3a", border: "df6fcf" };
    default: return { bg: "2a2a2a", border: "8a8a8a" };
  }
}
