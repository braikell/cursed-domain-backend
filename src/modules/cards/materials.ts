import type { GameSaveSnapshot } from "../bootstrap/game-save.js";
import { getCardBalance, normalizeCharacterKey, type CardCatalogType, type CardBalanceRarity } from "./balance.js";

export function normalizeCardCatalogType(cardType: string): CardCatalogType {
  return String(cardType ?? "").trim().toUpperCase() === "DEFINITIVA" ? "DEFINITIVA" : "BASE";
}

export function normalizeCardMaterialId(materialId: string) {
  return String(materialId ?? "").trim().toLowerCase();
}

export function buildCardElementMaterialId(cardKey: string) {
  return `element:${normalizeCardMaterialId(cardKey)}`;
}

export function buildDuplicateFragmentMaterialId(input: {
  characterId: string;
  variant: "base" | "definitive";
}) {
  const characterId = normalizeCharacterKey(input.characterId);
  return input.variant === "base"
    ? `fragment:${characterId}`
    : `fragment:definitive:${characterId}`;
}

export function buildCardUpgradeFragmentMaterialIds(input: {
  characterId: string;
  characterKey: string;
  cardType: CardCatalogType;
  rarity: CardBalanceRarity;
}) {
  const characterKey = normalizeCharacterKey(input.characterKey);
  const characterId = normalizeCharacterKey(input.characterId);
  if (input.cardType === "DEFINITIVA") {
    return uniqueMaterialIds([
      `fragment:definitive:${characterKey}`,
      `fragment:definitive:${characterId}`,
      `fragment:definitive_${input.rarity}`,
    ]);
  }
  return uniqueMaterialIds([
    `fragment:${characterKey}`,
    `fragment:${characterId}`,
    `fragment:base:${characterKey}`,
    `fragment:base_${input.rarity}`,
  ]);
}

export function pruneOwnedCardUnlockElements(save: GameSaveSnapshot) {
  const ownedElementIds = new Set<string>();

  for (const characterKey of Object.keys(save.characters ?? {})) {
    for (const materialId of getCardElementMaterialIdAliases(characterKey, "BASE")) {
      ownedElementIds.add(materialId);
    }
  }

  for (const card of Object.values(save.definitiveCards ?? {})) {
    const characterKey = normalizeCharacterKey(card.characterId);
    for (const materialId of getCardElementMaterialIdAliases(characterKey, "DEFINITIVA")) {
      ownedElementIds.add(materialId);
    }
    if (card.cardDefinitionId) {
      ownedElementIds.add(buildCardElementMaterialId(card.cardDefinitionId));
    }
  }

  const removed: string[] = [];
  for (const materialId of ownedElementIds) {
    if (Object.prototype.hasOwnProperty.call(save.fragments, materialId)) {
      delete save.fragments[materialId];
      removed.push(materialId);
    }
  }
  return removed;
}

export function countAvailableCardFragments(
  save: GameSaveSnapshot,
  input: {
    characterId: string;
    characterKey: string;
    cardType: CardCatalogType;
    rarity: CardBalanceRarity;
  },
) {
  return buildCardUpgradeFragmentMaterialIds(input).reduce(
    (sum, materialId) => sum + Math.max(0, Math.floor(Number(save.fragments[materialId]) || 0)),
    0,
  );
}

export function syncOwnedCardFragmentMirrors(save: GameSaveSnapshot) {
  for (const [rawCharacterKey, character] of Object.entries(save.characters ?? {})) {
    const characterKey = normalizeCharacterKey(character.id || rawCharacterKey);
    const balance = getCardBalance(characterKey, "BASE");
    const rarity = balance?.rarity ?? "basic";
    character.fragments = countAvailableCardFragments(save, {
      characterId: characterKey,
      characterKey,
      cardType: "BASE",
      rarity,
    });
    character.id = characterKey;
  }

  for (const [rawCharacterKey, card] of Object.entries(save.definitiveCards ?? {})) {
    const characterKey = normalizeCharacterKey(card.characterId || rawCharacterKey);
    const balance = getCardBalance(characterKey, "DEFINITIVA");
    const rarity = balance?.rarity ?? "legendary";
    card.fragments = countAvailableCardFragments(save, {
      characterId: characterKey,
      characterKey,
      cardType: "DEFINITIVA",
      rarity,
    });
    card.characterId = characterKey;
  }
}

export function getCardElementMaterialIdAliases(characterKey: string, cardType: CardCatalogType) {
  const normalizedCharacterKey = normalizeCharacterKey(characterKey);
  const normalizedType = normalizeCardCatalogType(cardType);
  const balance = getCardBalance(normalizedCharacterKey, normalizedType);
  if (balance == null) return [];

  const cardKey = normalizeCardMaterialId(balance.card_key ?? `${normalizedCharacterKey}_${normalizedType.toLowerCase()}_${balance.rarity}`);
  const aliases = [buildCardElementMaterialId(cardKey)];
  if (cardKey.includes("_definitiva_")) {
    aliases.push(buildCardElementMaterialId(cardKey.replace("_definitiva_", "_definitive_")));
  } else if (cardKey.includes("_definitive_")) {
    aliases.push(buildCardElementMaterialId(cardKey.replace("_definitive_", "_definitiva_")));
  }
  return uniqueMaterialIds(aliases);
}

function uniqueMaterialIds(materialIds: string[]) {
  return Array.from(new Set(materialIds.map(normalizeCardMaterialId).filter(Boolean)));
}
