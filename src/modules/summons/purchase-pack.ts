import { randomInt } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { PurchasePackInput } from "../../contracts.js";
import { HttpModuleError } from "../../errors.js";
import type { GodotAuthedRequestContext } from "../../contracts.js";
import {
  ensureBootstrapMonetizationFoundation,
  getBootstrapMonetizationConfig,
  updateDailyMissionProgress,
} from "../bootstrap/monetization-foundation.js";
import { normalizeGameSave, type GameSaveSnapshot, type OwnedDefinitiveCard, type OwnedCharacter } from "../bootstrap/game-save.js";
import { createServiceSupabaseClient } from "../../supabase.js";
import { getBalancedCardsByRarityAndType, getCardBalance, getCardUnlockElementsRequired, normalizeCharacterKey } from "../cards/balance.js";
import {
  buildCardElementMaterialId as buildCanonicalCardElementMaterialId,
  buildDuplicateFragmentMaterialId as buildCanonicalDuplicateFragmentMaterialId,
  normalizeCardMaterialId,
  pruneOwnedCardUnlockElements,
  syncOwnedCardFragmentMirrors,
} from "../cards/materials.js";

type Rarity = "basic" | "epic" | "legendary" | "mythic";
type CardVariant = "base" | "definitive";
type CardType =
  | "base_basic"
  | "base_epic"
  | "base_legendary"
  | "base_mythic"
  | "definitive_basic"
  | "definitive_epic"
  | "definitive_legendary"
  | "definitive_mythic";

interface PackConfig {
  id: PurchasePackInput["packId"];
  displayName: string;
  prices: {
    gold: number | null;
    gems: number | null;
  };
  limits: {
    gold: { count: number | null; windowType: "calendar_day_utc" | "rolling_hours" | null; windowHours: number | null };
    gems: { count: number | null; windowType: "calendar_day_utc" | "rolling_hours" | null; windowHours: number | null };
  };
  pityTarget: "epic_or_higher" | "legendary_or_higher" | "mythic";
  rates: Array<{ cardType: CardType; rate: number }>;
  isEnabled: boolean;
}

interface SummonMonetizationConfig {
  configVersion: number;
  probabilitiesVersion: number;
  dailyMissions: Awaited<ReturnType<typeof getBootstrapMonetizationConfig>>["dailyMissions"];
  packs: Record<PurchasePackInput["packId"], PackConfig>;
  duplicateRewards: Array<{ cardType: CardType; fragmentMaterialId: string; fragmentAmount: number }>;
}

interface PlayerSaveRow {
  save: GameSaveSnapshot;
}

interface UserPackLimitRow {
  purchases: number;
  window_key: string;
  window_started_at: string | null;
  window_ends_at: string | null;
  window_type: "calendar_day_utc" | "rolling_hours" | null;
}

interface UserPityRow {
  pity_legendary: number;
  pity_mythic: number;
  target_counter: number;
  soft_pity_step: number;
}

interface CardDefinitionRow {
  card_key: string;
  character_key: string;
  card_type: string;
  rarity: string;
  display_name: string;
}

interface FinalizePackPurchaseResultRow {
  gold: number;
  gems: number;
  purchases_before: number;
  purchases_after: number;
}

interface PityState {
  targetCounter: number;
  softPityStep: number;
}

interface CardDefinition {
  id: string;
  characterId: string;
  variant: CardVariant;
  rarity: Rarity;
  name: string;
}

interface PackPullResult {
  cardType: CardType;
  cardDefinitionId: string;
  characterId: string;
  rarity: Rarity;
  variant: CardVariant;
  isDefinitive: boolean;
  isNew: boolean;
  cardOwnedAfter: boolean;
  duplicateFragmentMaterialId?: string;
  duplicateFragmentAmount?: number;
  unlockElementMaterialId?: string;
  unlockElementsGranted?: number;
  unlockElementsRequired?: number;
  unlockElementsOwnedAfter?: number;
  unlockedNow?: boolean;
  wasPity: boolean;
  pityStateBefore?: PityState;
  pityStateAfter?: PityState;
}

interface PersistableUserCardRow {
  user_id: string;
  card_definition_id: string;
  character_id: string;
  character_key: string;
  card_key: string;
  card_type: "BASE" | "DEFINITIVA";
  variant: CardVariant;
  rarity: Rarity;
  definition_rarity: "COMMON" | "EPIC" | "LEGENDARY" | "MYTHIC";
  level: number;
  xp: number;
  stars: number;
  ascension: number;
  awakening: number;
  fragments: number;
  energy: number;
  max_energy: number;
  is_starter: boolean;
  updated_at: string;
  acquired_at: string;
}

interface PersistableUserMaterialRow {
  user_id: string;
  material_id: string;
  quantity: number;
  updated_at: string;
}

const PACK_CARDS_PER_PURCHASE = 3;

interface ResolvedPurchase {
  config: SummonMonetizationConfig;
  pack: PackConfig;
  cost: {
    currency: "gold" | "gems";
    amount: number;
  };
  serverNow: Date;
  limitWindow: {
    windowKey: string;
    purchaseCurrency: "gold" | "gems";
    purchasesBefore: number;
    purchasesAfter: number;
    windowType: "calendar_day_utc" | "rolling_hours";
    windowStartedAt: string;
    windowEndsAt: string;
  };
  purchaseCount: number;
  pityBefore: PityState;
  pityAfter: PityState;
  results: PackPullResult[];
  save: GameSaveSnapshot;
  cardRows: PersistableUserCardRow[];
  materialRows: PersistableUserMaterialRow[];
}

export async function purchasePackDedicated(
  context: GodotAuthedRequestContext,
  input: PurchasePackInput,
): Promise<unknown> {
  const supabase = createServiceSupabaseClient();
  const operation = `purchase_pack_v1:${input.packId}:${input.purchaseCurrency}:${input.count}`;

  const replay = await beginIdempotentOperation(supabase, context.userId, operation, input.requestId);
  if (replay.status === "replayed") {
    if (replay.response == null) {
      throw new HttpModuleError(409, "operation_in_progress", "summons", "La compra V1 todavia esta procesandose. Intenta otra vez en unos segundos.");
    }
    return replay.response;
  }

  await ensureBootstrapMonetizationFoundation(supabase, context.userId);
  const config = await getSummonMonetizationConfig(supabase);
  const resolved = await resolvePurchase({
    supabase,
    userId: context.userId,
    input,
    config,
  });

  const finalized = await finalizePurchase({
    supabase,
    userId: context.userId,
    requestId: input.requestId,
    resolved,
  });

  resolved.save.gold = finalized.gold;
  resolved.save.gems = finalized.gems;
  resolved.save.totalSummons = resolved.save.totalSummons;

  if (input.packId === "basicPack") {
    await updateDailyMissionProgress(supabase, context.userId, await getBootstrapMonetizationConfig(supabase), "basic_pack_opened", 1);
  }
  if (input.purchaseCurrency === "gold") {
    await updateDailyMissionProgress(supabase, context.userId, await getBootstrapMonetizationConfig(supabase), "gold_spent", resolved.cost.amount);
  }

  await upsertLegacyPlayerSaveMirror(supabase, context.userId, resolved.save);

  const response = {
    ok: true as const,
    packId: input.packId,
    purchaseCurrency: input.purchaseCurrency,
    count: input.count,
    cost: resolved.cost,
    pityBefore: resolved.pityBefore,
    pityAfter: resolved.pityAfter,
    limitWindow: {
      windowKey: resolved.limitWindow.windowKey,
      purchasesBefore: finalized.purchasesBefore,
      purchasesAfter: finalized.purchasesAfter,
      windowType: resolved.limitWindow.windowType,
      windowStartedAt: resolved.limitWindow.windowStartedAt,
      windowEndsAt: resolved.limitWindow.windowEndsAt,
    },
    results: resolved.results,
    save: resolved.save,
    configVersion: config.configVersion,
    probabilitiesVersion: config.probabilitiesVersion,
  };

  await completeIdempotentOperation(supabase, context.userId, input.requestId, response);
  return response;
}

async function getSummonMonetizationConfig(supabase: SupabaseClient): Promise<SummonMonetizationConfig> {
  const bootstrapConfig = await getBootstrapMonetizationConfig(supabase);

  const defaultPacks: SummonMonetizationConfig["packs"] = {
    basicPack: {
      id: "basicPack",
      displayName: "Basic Pack",
      prices: { gold: 6000, gems: 120 },
      limits: { gold: { count: null, windowType: null, windowHours: null }, gems: { count: null, windowType: null, windowHours: null } },
      pityTarget: "epic_or_higher",
      rates: [
        { cardType: "base_basic", rate: 80 }, { cardType: "base_epic", rate: 19.8 }, { cardType: "base_legendary", rate: 0.1 }, { cardType: "base_mythic", rate: 0.01 },
        { cardType: "definitive_basic", rate: 0.06 }, { cardType: "definitive_epic", rate: 0.03 }, { cardType: "definitive_legendary", rate: 0 }, { cardType: "definitive_mythic", rate: 0 },
      ],
      isEnabled: true,
    },
    epicPack: {
      id: "epicPack",
      displayName: "Epic Pack",
      prices: { gold: 30000, gems: 650 },
      limits: { gold: { count: 25, windowType: "calendar_day_utc", windowHours: 24 }, gems: { count: 50, windowType: "calendar_day_utc", windowHours: 24 } },
      pityTarget: "legendary_or_higher",
      rates: [
        { cardType: "base_basic", rate: 50 }, { cardType: "base_epic", rate: 47.5 }, { cardType: "base_legendary", rate: 1.49 }, { cardType: "base_mythic", rate: 0.01 },
        { cardType: "definitive_basic", rate: 0.75 }, { cardType: "definitive_epic", rate: 0.25 }, { cardType: "definitive_legendary", rate: 0 }, { cardType: "definitive_mythic", rate: 0 },
      ],
      isEnabled: true,
    },
    legendaryPack: {
      id: "legendaryPack",
      displayName: "Legendary Pack",
      prices: { gold: 180000, gems: 2800 },
      limits: { gold: { count: 1, windowType: "calendar_day_utc", windowHours: 24 }, gems: { count: 30, windowType: "calendar_day_utc", windowHours: 24 } },
      pityTarget: "mythic",
      rates: [
        { cardType: "base_basic", rate: 5 }, { cardType: "base_epic", rate: 65 }, { cardType: "base_legendary", rate: 25 }, { cardType: "base_mythic", rate: 2 },
        { cardType: "definitive_basic", rate: 2 }, { cardType: "definitive_epic", rate: 0.9 }, { cardType: "definitive_legendary", rate: 0.05 }, { cardType: "definitive_mythic", rate: 0.05 },
      ],
      isEnabled: true,
    },
    mythicPack: {
      id: "mythicPack",
      displayName: "Mythic Pack",
      prices: { gold: 650000, gems: 7800 },
      limits: { gold: { count: 1, windowType: "rolling_hours", windowHours: 240 }, gems: { count: 10, windowType: "calendar_day_utc", windowHours: 24 } },
      pityTarget: "mythic",
      rates: [
        { cardType: "base_basic", rate: 0 }, { cardType: "base_epic", rate: 14 }, { cardType: "base_legendary", rate: 45 }, { cardType: "base_mythic", rate: 31 },
        { cardType: "definitive_basic", rate: 4 }, { cardType: "definitive_epic", rate: 3 }, { cardType: "definitive_legendary", rate: 2 }, { cardType: "definitive_mythic", rate: 1 },
      ],
      isEnabled: true,
    },
  };

  const duplicateRewards = [
    { cardType: "base_basic" as const, fragmentMaterialId: "fragment:base_basic", fragmentAmount: 8 },
    { cardType: "base_epic" as const, fragmentMaterialId: "fragment:base_epic", fragmentAmount: 20 },
    { cardType: "base_legendary" as const, fragmentMaterialId: "fragment:base_legendary", fragmentAmount: 45 },
    { cardType: "base_mythic" as const, fragmentMaterialId: "fragment:base_mythic", fragmentAmount: 90 },
    { cardType: "definitive_basic" as const, fragmentMaterialId: "fragment:definitive_basic", fragmentAmount: 110 },
    { cardType: "definitive_epic" as const, fragmentMaterialId: "fragment:definitive_epic", fragmentAmount: 125 },
    { cardType: "definitive_legendary" as const, fragmentMaterialId: "fragment:definitive_legendary", fragmentAmount: 145 },
    { cardType: "definitive_mythic" as const, fragmentMaterialId: "fragment:definitive_mythic", fragmentAmount: 160 },
  ];

  try {
    const { data: configVersion, error: versionError } = await supabase
      .from("monetization_config_versions")
      .select("config_version, probabilities_version")
      .eq("namespace", "monetization_v1")
      .eq("is_active", true)
      .order("config_version", { ascending: false })
      .limit(1)
      .maybeSingle<{ config_version: number; probabilities_version: number }>();
    if (versionError) throw new Error(versionError.message);

    if (configVersion != null) {
      const [{ data: packRows, error: packError }, { data: duplicateRows, error: duplicateError }] = await Promise.all([
        supabase
          .from("pack_definitions")
          .select("pack_id, display_name, price_gold, price_gems, gold_limit_count, gold_limit_window_type, gold_limit_window_hours, gem_limit_count, gem_limit_window_type, gem_limit_window_hours, pity_target, rates, is_enabled")
          .eq("config_version", configVersion.config_version)
          .returns<Array<Record<string, unknown>>>(),
        supabase
          .from("card_duplicate_rewards")
          .select("card_type, fragment_material_id, fragment_amount")
          .eq("config_version", configVersion.config_version)
          .returns<Array<Record<string, unknown>>>(),
      ]);
      if (packError) throw new Error(packError.message);
      if (duplicateError) throw new Error(duplicateError.message);

      if (Array.isArray(packRows) && packRows.length > 0) {
        const packs = { ...defaultPacks };
        for (const row of packRows) {
          const packId = String(row.pack_id) as PurchasePackInput["packId"];
          if (!(packId in packs)) continue;
          packs[packId] = {
            id: packId,
            displayName: String(row.display_name ?? packs[packId].displayName),
            prices: { gold: numberOrNull(row.price_gold), gems: numberOrNull(row.price_gems) },
            limits: {
              gold: {
                count: numberOrNull(row.gold_limit_count),
                windowType: nullableWindowType(row.gold_limit_window_type),
                windowHours: numberOrNull(row.gold_limit_window_hours),
              },
              gems: {
                count: numberOrNull(row.gem_limit_count),
                windowType: nullableWindowType(row.gem_limit_window_type),
                windowHours: numberOrNull(row.gem_limit_window_hours),
              },
            },
            pityTarget: String(row.pity_target ?? packs[packId].pityTarget) as PackConfig["pityTarget"],
            rates: Array.isArray(row.rates) ? (row.rates as Array<{ cardType: CardType; rate: number }>).map((entry) => ({
              cardType: entry.cardType,
              rate: Number(entry.rate),
            })) : packs[packId].rates,
            isEnabled: Boolean(row.is_enabled),
          };
        }
        return {
          configVersion: configVersion.config_version,
          probabilitiesVersion: configVersion.probabilities_version,
          dailyMissions: bootstrapConfig.dailyMissions,
          packs,
          duplicateRewards: Array.isArray(duplicateRows) && duplicateRows.length > 0
            ? duplicateRows.map((row) => ({
                cardType: String(row.card_type) as CardType,
                fragmentMaterialId: String(row.fragment_material_id),
                fragmentAmount: Number(row.fragment_amount),
              }))
            : duplicateRewards,
        };
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!isMissingPackSchemaError(message)) {
      throw error;
    }
  }

  return {
    configVersion: bootstrapConfig.configVersion,
    probabilitiesVersion: bootstrapConfig.probabilitiesVersion,
    dailyMissions: bootstrapConfig.dailyMissions,
    packs: defaultPacks,
    duplicateRewards,
  };
}

async function resolvePurchase(input: {
  supabase: SupabaseClient;
  userId: string;
  input: PurchasePackInput;
  config: SummonMonetizationConfig;
}): Promise<ResolvedPurchase> {
  const save = await loadPlayerSave(input.supabase, input.userId);
  const pack = input.config.packs[input.input.packId];
  if (!pack || !pack.isEnabled) {
    throw new HttpModuleError(400, "pack_unavailable", "summons", "Pack V1 no disponible.");
  }

  const price = pack.prices[input.input.purchaseCurrency];
  if (price == null) {
    throw new HttpModuleError(400, "invalid_currency", "summons", `El pack ${input.input.packId} no puede comprarse con ${input.input.purchaseCurrency}.`);
  }

  const serverNow = new Date();
  const totalCost = price * input.input.count;
  const currentBalance = input.input.purchaseCurrency === "gold" ? save.gold : save.gems;
  if (currentBalance < totalCost) {
    throw new HttpModuleError(400, "insufficient_funds", "summons", `No tienes ${input.input.purchaseCurrency === "gold" ? "oro" : "gemas"} suficientes.`);
  }

  const limitWindow = await validatePackPurchaseLimit(input.supabase, input.userId, input.input, pack, serverNow);
  const pityRow = await loadUserPity(input.supabase, input.userId, input.input.packId);
  const pityBefore: PityState = {
    targetCounter: pityRow.target_counter,
    softPityStep: pityRow.soft_pity_step,
  };
  const pityState: PityState = { ...pityBefore };
  const duplicateRewards = new Map(input.config.duplicateRewards.map((entry) => [entry.cardType, entry]));
  const results: PackPullResult[] = [];
  const totalPulls = input.input.count * PACK_CARDS_PER_PURCHASE;

  for (let index = 0; index < totalPulls; index += 1) {
    const pityStateBefore = { targetCounter: pityState.targetCounter, softPityStep: pityState.softPityStep };
    const roll = rollConfiguredPackCard(pack, pityState);
    const definition = await pickCardDefinitionForCardType(input.supabase, roll.cardType);
    if (definition == null) {
      throw new HttpModuleError(500, "missing_card_definition", "summons", `No hay definiciones disponibles para ${roll.cardType}.`);
    }

    const pityStateAfter = { targetCounter: pityState.targetCounter, softPityStep: pityState.softPityStep };
    results.push(
      applyPackCardToCollection({
        save,
        definition,
        cardType: roll.cardType,
        wasPity: roll.wasPity,
        duplicateRewardsByType: duplicateRewards,
        pityStateBefore,
        pityStateAfter,
      }),
    );
  }

  save.totalSummons += totalPulls;
  save.pulls += totalPulls;
  pruneOwnedCardUnlockElements(save);
  syncOwnedCardFragmentMirrors(save);

  const { cardRows, materialRows } = buildPackCollectionPersistenceRows(input.userId, save, results, serverNow.toISOString());
  return {
    config: input.config,
    pack,
    cost: { currency: input.input.purchaseCurrency, amount: totalCost },
    serverNow,
    limitWindow,
    purchaseCount: input.input.count,
    pityBefore,
    pityAfter: { targetCounter: pityState.targetCounter, softPityStep: pityState.softPityStep },
    results,
    save,
    cardRows,
    materialRows,
  };
}

async function finalizePurchase(input: {
  supabase: SupabaseClient;
  userId: string;
  requestId: string;
  resolved: ResolvedPurchase;
}) {
  const packLimit = input.resolved.pack.limits[input.resolved.cost.currency];
  const packLogRows = input.resolved.results.map((result) => ({
    user_id: input.userId,
    request_id: input.requestId,
    pack_id: input.resolved.pack.id,
    purchase_currency: input.resolved.cost.currency,
    purchase_amount: 1,
    card_type: result.cardType,
    card_definition_id: result.cardDefinitionId,
    rarity: result.rarity,
    variant: result.variant,
    is_definitive: result.isDefinitive,
    is_new: result.isNew,
    duplicate_fragment_material_id: result.duplicateFragmentMaterialId ?? null,
    duplicate_fragment_amount: result.duplicateFragmentAmount ?? null,
    was_pity: result.wasPity,
    pity_state_before: result.pityStateBefore ?? {},
    pity_state_after: result.pityStateAfter ?? {},
    probabilities_version: input.resolved.config.probabilitiesVersion,
    config_version: input.resolved.config.configVersion,
    server_date: input.resolved.serverNow.toISOString().slice(0, 10),
    metadata: {},
  }));

  const { data, error } = await input.supabase
    .rpc("finalize_pack_purchase_v1", {
      target_user_id: input.userId,
      request_id: input.requestId,
      target_pack_id: input.resolved.pack.id,
      purchase_currency: input.resolved.cost.currency,
      purchase_amount: input.resolved.purchaseCount,
      price_amount: input.resolved.cost.amount,
      action: "purchase_pack_v1",
      save_payload: input.resolved.save,
      save_version: input.resolved.save.schemaVersion,
      player_level: input.resolved.save.playerLevel,
      xp_amount: input.resolved.save.xp,
      current_stage: input.resolved.save.currentStage,
      highest_stage: input.resolved.save.highestStage,
      unlocked_slots: input.resolved.save.unlockedSlots,
      total_summons: input.resolved.save.totalSummons,
      total_battles_won: input.resolved.save.totalBattlesWon,
      pity_target_counter: input.resolved.pityAfter.targetCounter,
      pity_soft_pity_step: input.resolved.pityAfter.softPityStep,
      config_version: input.resolved.config.configVersion,
      probabilities_version: input.resolved.config.probabilitiesVersion,
      window_key: input.resolved.limitWindow.windowKey,
      window_type: packLimit.windowType ?? null,
      window_hours: packLimit.windowHours ?? null,
      window_started_at: input.resolved.limitWindow.windowStartedAt,
      window_ends_at: input.resolved.limitWindow.windowEndsAt,
      limit_count: packLimit.count ?? null,
      card_rows: input.resolved.cardRows,
      material_rows: input.resolved.materialRows,
      pack_log_rows: packLogRows,
      economy_metadata: {
        count: input.resolved.purchaseCount,
        resultCount: input.resolved.results.length,
        limitWindow: input.resolved.limitWindow.windowKey,
        packType: input.resolved.pack.id,
        probabilitiesVersion: input.resolved.config.probabilitiesVersion,
        configVersion: input.resolved.config.configVersion,
        wasPity: input.resolved.results.some((result) => result.wasPity),
        serverDate: input.resolved.serverNow.toISOString().slice(0, 10),
      },
    })
    .single<FinalizePackPurchaseResultRow>();
  if (error) throw new Error(error.message);
  await cleanupZeroQuantityMaterialRows(input.supabase, input.userId, input.resolved.materialRows);
  return {
    gold: data.gold,
    gems: data.gems,
    purchasesBefore: data.purchases_before,
    purchasesAfter: data.purchases_after,
  };
}

async function cleanupZeroQuantityMaterialRows(
  supabase: SupabaseClient,
  userId: string,
  materialRows: PersistableUserMaterialRow[],
) {
  const materialIds = Array.from(new Set(
    materialRows
      .filter((row) => Math.max(0, Math.floor(Number(row.quantity) || 0)) <= 0)
      .map((row) => normalizeCardMaterialId(row.material_id))
      .filter(Boolean),
  ));
  if (materialIds.length === 0) return;

  const { error } = await supabase
    .from("user_materials")
    .delete()
    .eq("user_id", userId)
    .in("material_id", materialIds);
  if (error) {
    console.warn("[summons] zero-quantity material cleanup skipped:", error.message);
  }
}

async function beginIdempotentOperation(supabase: SupabaseClient, userId: string, operation: string, requestId: string) {
  assertRequestId(requestId);
  const { error: insertError } = await supabase.from("idempotency_keys").insert({
    user_id: userId,
    request_id: requestId,
    operation,
  });
  if (!insertError) {
    return { status: "started" as const, response: null as unknown };
  }

  const { data, error: readError } = await supabase
    .from("idempotency_keys")
    .select("operation, response")
    .eq("user_id", userId)
    .eq("request_id", requestId)
    .maybeSingle<{ operation: string; response: unknown | null }>();
  if (readError || !data) throw new Error(insertError.message);
  if (data.operation !== operation) throw new HttpModuleError(400, "request_id_reused", "summons", "requestId already used for another operation.");
  return { status: "replayed" as const, response: data.response };
}

async function completeIdempotentOperation(supabase: SupabaseClient, userId: string, requestId: string, response: unknown) {
  const { error } = await supabase
    .from("idempotency_keys")
    .update({ response })
    .eq("user_id", userId)
    .eq("request_id", requestId);
  if (error) throw new Error(error.message);
}

function assertRequestId(requestId: string) {
  const value = requestId.trim();
  if (!/^[a-zA-Z0-9_-]{8,80}$/.test(value)) {
    throw new HttpModuleError(400, "invalid_request_id", "summons", "Invalid requestId.");
  }
}

async function loadPlayerSave(supabase: SupabaseClient, userId: string) {
  const { data, error } = await supabase
    .from("player_saves")
    .select("save")
    .eq("user_id", userId)
    .single<PlayerSaveRow>();
  if (error) throw new Error(error.message);
  const save = normalizeGameSave(data.save);
  await mergeUserMaterialStacks(supabase, userId, save);
  pruneOwnedCardUnlockElements(save);
  syncOwnedCardFragmentMirrors(save);
  return save;
}

async function mergeUserMaterialStacks(supabase: SupabaseClient, userId: string, save: GameSaveSnapshot) {
  const { data, error } = await supabase
    .from("user_materials")
    .select("material_id, quantity")
    .eq("user_id", userId)
    .returns<Array<{ material_id: string | null; quantity: number | null }>>();
  if (error) throw new Error(error.message);

  for (const row of data ?? []) {
    const materialId = normalizeCardMaterialId(String(row.material_id ?? ""));
    const quantity = Math.max(0, Math.floor(Number(row.quantity) || 0));
    if (!materialId || quantity <= 0) continue;
    save.fragments[materialId] = Math.max(Math.max(0, Math.floor(Number(save.fragments[materialId]) || 0)), quantity);
  }
}

async function loadUserPity(supabase: SupabaseClient, userId: string, packId: PurchasePackInput["packId"]) {
  const { data, error } = await supabase
    .from("user_pity")
    .select("pity_legendary, pity_mythic, target_counter, soft_pity_step")
    .eq("user_id", userId)
    .eq("pack_id", packId)
    .maybeSingle<UserPityRow>();
  if (error) throw new Error(error.message);
  return data ?? { pity_legendary: 0, pity_mythic: 0, target_counter: 0, soft_pity_step: 0 };
}

async function pickCardDefinitionForCardType(supabase: SupabaseClient, cardType: CardType): Promise<CardDefinition | null> {
  const variant = cardType.startsWith("definitive_") ? "DEFINITIVA" : "BASE";
  const localRarity = getCardTypeRarity(cardType);
  const activePool = getBalancedCardsByRarityAndType(localRarity, variant);
  if (!activePool.length) return null;

  const { data, error } = await supabase
    .from("card_definitions")
    .select("card_key, character_key, card_type, rarity, display_name, sort_order")
    .eq("card_type", variant)
    .eq("is_enabled", true)
    .order("sort_order", { ascending: true })
    .returns<Array<CardDefinitionRow & { sort_order?: number }>>();
  if (error) throw new Error(error.message);

  const remoteByCharacter = new Map<string, CardDefinitionRow & { sort_order?: number }>(
    (data ?? []).map((row: CardDefinitionRow & { sort_order?: number }) => [
      `${normalizeCharacterKey(row.character_key)}::${row.card_type.trim().toUpperCase()}`,
      row,
    ]),
  );
  const selected = activePool[randomInt(activePool.length)] ?? null;
  if (selected == null) return null;
  const canonicalCharacterId = normalizeCharacterKey(selected.characterKey);
  const balance = getCardBalance(canonicalCharacterId, selected.cardType);
  const canonicalCardDefinitionId = balance?.card_key ?? selected.card_key ?? `${canonicalCharacterId}_${selected.cardType.toLowerCase()}_${selected.rarity}`;
  const remoteRow = remoteByCharacter.get(`${canonicalCharacterId}::${selected.cardType}`) ?? null;

  return {
    id: canonicalCardDefinitionId,
    characterId: canonicalCharacterId,
    variant: selected.cardType === "BASE" ? "base" : "definitive",
    rarity: balance?.rarity ?? selected.rarity,
    name: remoteRow?.display_name ?? `${canonicalCharacterId} ${selected.cardType.toLowerCase()}`,
  };
}

function applyPackCardToCollection(input: {
  save: GameSaveSnapshot;
  definition: CardDefinition;
  cardType: CardType;
  wasPity: boolean;
  duplicateRewardsByType: Map<CardType, { fragmentMaterialId: string; fragmentAmount: number }>;
  pityStateBefore: PityState;
  pityStateAfter: PityState;
}): PackPullResult {
  const { save, definition, cardType, wasPity, duplicateRewardsByType, pityStateBefore, pityStateAfter } = input;
  const isOwnedBefore = isCardOwnedInSave(save, definition);

  if (!isOwnedBefore) {
    const unlockElementMaterialId = buildCardElementMaterialId(definition.id);
    const unlockElementsRequired = getCardUnlockElementsRequired(definition.variant === "base" ? "BASE" : "DEFINITIVA", definition.rarity);
    const unlockElementsOwnedBefore = Math.max(0, Number(save.fragments[unlockElementMaterialId] ?? 0));
    const unlockElementsOwnedAfter = Math.min(unlockElementsRequired, unlockElementsOwnedBefore + 1);
    const unlockedNow = unlockElementsOwnedAfter >= unlockElementsRequired;

    if (unlockedNow) {
      delete save.fragments[unlockElementMaterialId];
      applyCardUnlockToSave(save, definition);
    } else {
      save.fragments[unlockElementMaterialId] = unlockElementsOwnedAfter;
    }

    return {
      cardType,
      cardDefinitionId: definition.id,
      characterId: definition.characterId,
      rarity: definition.rarity,
      variant: definition.variant,
      isDefinitive: definition.variant === "definitive",
      isNew: unlockedNow,
      cardOwnedAfter: unlockedNow,
      unlockElementMaterialId,
      unlockElementsGranted: 1,
      unlockElementsRequired,
      unlockElementsOwnedAfter,
      unlockedNow,
      wasPity,
      pityStateBefore,
      pityStateAfter,
    };
  }

  const duplicateReward = duplicateRewardsByType.get(cardType) ?? null;
  applyDuplicateCardRewardToSave(save, definition, duplicateReward?.fragmentAmount ?? 0);

  return {
    cardType,
    cardDefinitionId: definition.id,
    characterId: definition.characterId,
    rarity: definition.rarity,
    variant: definition.variant,
    isDefinitive: definition.variant === "definitive",
    isNew: false,
    cardOwnedAfter: true,
    duplicateFragmentMaterialId: buildDuplicateFragmentMaterialId(definition),
    duplicateFragmentAmount: duplicateReward?.fragmentAmount,
    wasPity,
    pityStateBefore,
    pityStateAfter,
  };
}

function buildPackCollectionPersistenceRows(
  userId: string,
  save: GameSaveSnapshot,
  results: PackPullResult[],
  nowIso: string,
) {
  const cardRows = new Map<string, PersistableUserCardRow>();
  const materialRows = new Map<string, PersistableUserMaterialRow>();

  for (const result of results) {
    const characterId = normalizeCharacterKey(result.characterId);
    const baseCharacter: OwnedCharacter | undefined = save.characters[characterId];
    const definitiveCharacter: OwnedDefinitiveCard | undefined = save.definitiveCards[characterId];
    if (result.cardOwnedAfter && ((result.variant === "base" && baseCharacter) || (result.variant === "definitive" && definitiveCharacter))) {
      const cardType = result.variant === "base" ? "BASE" : "DEFINITIVA";
      const balance = getCardBalance(characterId, cardType);
      const cardKey = balance?.card_key ?? result.cardDefinitionId;
      const rarity = balance?.rarity ?? result.rarity;
      cardRows.set(cardKey, {
        user_id: userId,
        card_definition_id: cardKey,
        character_id: characterId,
        character_key: characterId,
        card_key: cardKey,
        card_type: cardType,
        variant: result.variant,
        rarity,
        definition_rarity: mapRarityToCatalog(rarity),
        level: result.variant === "base" ? (baseCharacter?.level ?? 1) : (definitiveCharacter?.level ?? 1),
        xp: result.variant === "base" ? (baseCharacter?.xp ?? 0) : (definitiveCharacter?.xp ?? 0),
        stars: result.variant === "base" ? (baseCharacter?.stars ?? 1) : (definitiveCharacter?.stars ?? 1),
        ascension: result.variant === "base" ? (baseCharacter?.ascension ?? 0) : (definitiveCharacter?.ascension ?? 0),
        awakening: result.variant === "base" ? (baseCharacter?.awakening ?? 0) : (definitiveCharacter?.awakening ?? 0),
        fragments: result.variant === "base" ? (baseCharacter?.fragments ?? 0) : (definitiveCharacter?.fragments ?? 0),
        energy: result.variant === "base" ? Math.floor(baseCharacter?.energy ?? 0) : 0,
        max_energy: result.variant === "base" ? Math.floor(baseCharacter?.maxEnergy ?? 100) : 100,
        is_starter: characterId === "yuji" || characterId === "nobara",
        updated_at: nowIso,
        acquired_at: result.variant === "definitive" && definitiveCharacter ? new Date(definitiveCharacter.acquiredAt).toISOString() : nowIso,
      });
    }

    if (result.unlockElementMaterialId) {
      materialRows.set(result.unlockElementMaterialId, {
        user_id: userId,
        material_id: result.unlockElementMaterialId,
        quantity: Number(save.fragments[result.unlockElementMaterialId] ?? 0),
        updated_at: nowIso,
      });
    }

    if (result.duplicateFragmentMaterialId) {
      materialRows.set(result.duplicateFragmentMaterialId, {
        user_id: userId,
        material_id: result.duplicateFragmentMaterialId,
        quantity: Number(save.fragments[result.duplicateFragmentMaterialId] ?? 0),
        updated_at: nowIso,
      });
    }
  }

  for (const [materialId, quantity] of Object.entries(save.fragments)) {
    const normalizedQuantity = Math.max(0, Math.floor(Number(quantity) || 0));
    materialRows.set(materialId, {
      user_id: userId,
      material_id: materialId,
      quantity: normalizedQuantity,
      updated_at: nowIso,
    });
  }

  return {
    cardRows: Array.from(cardRows.values()),
    materialRows: Array.from(materialRows.values()),
  };
}

function applyCardUnlockToSave(save: GameSaveSnapshot, definition: CardDefinition) {
  const characterId = normalizeCharacterKey(definition.characterId);
  if (definition.variant === "base") {
    if (!save.characters[characterId]) {
      save.characters[characterId] = {
        id: characterId,
        level: 1,
        xp: 0,
        stars: 1,
        ascension: 0,
        awakening: 0,
        fragments: 0,
        equipment: {},
        energy: 0,
        maxEnergy: 100,
      };
    }
    return;
  }

  const existingDefinitive = save.definitiveCards[characterId];
  save.definitiveCards[characterId] = {
    characterId,
    cardDefinitionId: definition.id,
    level: existingDefinitive?.level ?? 1,
    xp: existingDefinitive?.xp ?? 0,
    stars: existingDefinitive?.stars ?? 1,
    ascension: existingDefinitive?.ascension ?? 0,
    awakening: existingDefinitive?.awakening ?? 0,
    fragments: existingDefinitive?.fragments ?? 0,
    acquiredAt: existingDefinitive?.acquiredAt ?? Date.now(),
  };
}

function applyDuplicateCardRewardToSave(save: GameSaveSnapshot, definition: CardDefinition, fragmentAmount: number) {
  if (fragmentAmount <= 0) return;

  const characterId = normalizeCharacterKey(definition.characterId);
  if (definition.variant === "base") {
    const character = save.characters[characterId];
    if (!character) return;
    const fragmentMaterialId = buildDuplicateFragmentMaterialId({ ...definition, characterId });
    save.fragments[fragmentMaterialId] = (save.fragments[fragmentMaterialId] ?? 0) + fragmentAmount;
    save.characters[characterId] = {
      ...character,
      fragments: Math.max(0, Math.floor(Number(save.fragments[fragmentMaterialId]) || 0)),
    };
    return;
  }

  const existingDefinitive = save.definitiveCards[characterId];
  if (!existingDefinitive) return;
  const fragmentMaterialId = buildDuplicateFragmentMaterialId({ ...definition, characterId });
  save.fragments[fragmentMaterialId] = (save.fragments[fragmentMaterialId] ?? 0) + fragmentAmount;
  save.definitiveCards[characterId] = {
    ...existingDefinitive,
    fragments: Math.max(0, Math.floor(Number(save.fragments[fragmentMaterialId]) || 0)),
  };
}

function isCardOwnedInSave(save: GameSaveSnapshot, definition: CardDefinition) {
  const characterId = normalizeCharacterKey(definition.characterId);
  if (definition.variant === "base") {
    return Boolean(save.characters[characterId]);
  }
  return Boolean(save.definitiveCards[characterId]);
}

function buildCardElementMaterialId(cardDefinitionId: string) {
  return buildCanonicalCardElementMaterialId(cardDefinitionId);
}

function buildDuplicateFragmentMaterialId(definition: CardDefinition) {
  return buildCanonicalDuplicateFragmentMaterialId({
    characterId: definition.characterId,
    variant: definition.variant,
  });
}

async function validatePackPurchaseLimit(
  supabase: SupabaseClient,
  userId: string,
  input: PurchasePackInput,
  pack: PackConfig,
  serverNow: Date,
) {
  const limitConfig = pack.limits[input.purchaseCurrency];
  if (limitConfig.count == null || limitConfig.windowType == null || limitConfig.windowHours == null) {
    const nowIso = serverNow.toISOString();
    return {
      windowKey: `${input.purchaseCurrency}:unlimited`,
      purchaseCurrency: input.purchaseCurrency,
      purchasesBefore: 0,
      purchasesAfter: input.count,
      windowType: "calendar_day_utc" as const,
      windowStartedAt: nowIso,
      windowEndsAt: nowIso,
    };
  }

  const window = resolveLimitWindow(limitConfig.windowType, limitConfig.windowHours, serverNow, input.purchaseCurrency);
  const { data, error } = await supabase
    .from("user_pack_limits")
    .select("purchases, window_key, window_started_at, window_ends_at, window_type")
    .eq("user_id", userId)
    .eq("pack_id", input.packId)
    .eq("window_key", window.windowKey)
    .maybeSingle<UserPackLimitRow>();
  if (error) throw new Error(error.message);

  const purchasesBefore = shouldResetWindow(data, limitConfig.windowType, serverNow) ? 0 : (data?.purchases ?? 0);
  const purchasesAfter = purchasesBefore + input.count;
  if (purchasesAfter > limitConfig.count) {
    throw new HttpModuleError(400, "purchase_limit_exceeded", "summons", "Limite de compra excedido para este sobre y moneda.");
  }

  return {
    windowKey: window.windowKey,
    purchaseCurrency: input.purchaseCurrency,
    purchasesBefore,
    purchasesAfter,
    windowType: limitConfig.windowType,
    windowStartedAt: window.windowStartedAt,
    windowEndsAt: window.windowEndsAt,
  };
}

function resolveLimitWindow(windowType: "calendar_day_utc" | "rolling_hours", windowHours: number, now: Date, purchaseCurrency: "gold" | "gems") {
  if (windowType === "calendar_day_utc") {
    const key = `${purchaseCurrency}:${now.toISOString().slice(0, 10)}`;
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0));
    const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 23, 59, 59, 999));
    return {
      windowKey: key,
      windowStartedAt: start.toISOString(),
      windowEndsAt: end.toISOString(),
    };
  }

  const end = new Date(now.getTime() + windowHours * 60 * 60 * 1000);
  return {
    windowKey: `${purchaseCurrency}:rolling_${windowHours}h`,
    windowStartedAt: now.toISOString(),
    windowEndsAt: end.toISOString(),
  };
}

function shouldResetWindow(row: UserPackLimitRow | null, windowType: "calendar_day_utc" | "rolling_hours", now: Date) {
  if (!row) return true;
  if (windowType === "calendar_day_utc") return false;
  if (!row.window_ends_at) return true;
  return new Date(row.window_ends_at).getTime() <= now.getTime();
}

function rollConfiguredPackCard(pack: PackConfig, pityState: PityState) {
  pityState.targetCounter += 1;
  const guaranteed = resolveGuaranteedCardType(pack.id, pityState);
  if (guaranteed) {
    pityState.targetCounter = 0;
    pityState.softPityStep = 0;
    return { cardType: guaranteed, wasPity: true };
  }

  const adjustedRates = applySoftPityRules(pack.id, pack.rates, pityState);
  const rolledCardType = rollCardType(adjustedRates);
  const rolledRarity = getCardTypeRarity(rolledCardType);
  const targetHit = isTargetHit(pack.pityTarget, rolledRarity);

  if (targetHit) {
    pityState.targetCounter = 0;
    pityState.softPityStep = 0;
  } else {
    pityState.softPityStep = deriveSoftPityStep(pack.id, pityState);
  }

  return { cardType: rolledCardType, wasPity: false };
}

function resolveGuaranteedCardType(packId: PurchasePackInput["packId"], pityState: PityState): CardType | null {
  if (packId === "basicPack" && pityState.targetCounter >= 10) return "base_epic";
  if (packId === "epicPack" && pityState.targetCounter >= 20) return "base_legendary";
  if (packId === "mythicPack" && pityState.targetCounter >= 3) return "base_mythic";
  return null;
}

function applySoftPityRules(packId: PurchasePackInput["packId"], rates: Array<{ cardType: CardType; rate: number }>, pityState: PityState) {
  const adjusted = rates.map((entry) => ({ ...entry }));
  if (packId === "epicPack" && pityState.targetCounter === 10) {
    return replaceSingleCardRate(adjusted, "base_legendary", 10);
  }
  if (packId === "legendaryPack") {
    if (pityState.targetCounter >= 10) return replaceSingleCardRate(adjusted, "base_mythic", 12);
    if (pityState.targetCounter >= 5) return replaceSingleCardRate(adjusted, "base_mythic", 7);
  }
  return adjusted;
}

function replaceSingleCardRate(rates: Array<{ cardType: CardType; rate: number }>, targetCardType: CardType, newRate: number) {
  const target = rates.find((entry) => entry.cardType === targetCardType);
  if (!target) return rates;
  const delta = newRate - target.rate;
  if (Math.abs(delta) < 0.0001) return rates;
  const others = rates.filter((entry) => entry.cardType !== targetCardType);
  const othersTotal = others.reduce((sum, entry) => sum + entry.rate, 0);
  if (othersTotal <= 0) return rates;
  return rates.map((entry) => {
    if (entry.cardType === targetCardType) return { ...entry, rate: newRate };
    const reduction = (entry.rate / othersTotal) * delta;
    return { ...entry, rate: Math.max(0, entry.rate - reduction) };
  });
}

function rollCardType(rates: Array<{ cardType: CardType; rate: number }>) {
  const roll = secureRandomFloat() * 100;
  let acc = 0;
  for (const entry of rates) {
    acc += entry.rate;
    if (roll <= acc) return entry.cardType;
  }
  return rates[rates.length - 1]?.cardType ?? "base_basic";
}

function getCardTypeRarity(cardType: CardType): Rarity {
  if (cardType.endsWith("_basic")) return "basic";
  if (cardType.endsWith("_epic")) return "epic";
  if (cardType.endsWith("_legendary")) return "legendary";
  return "mythic";
}

function isTargetHit(target: PackConfig["pityTarget"], rarity: Rarity) {
  if (target === "epic_or_higher") return rarity !== "basic";
  if (target === "legendary_or_higher") return rarity === "legendary" || rarity === "mythic";
  return rarity === "mythic";
}

function deriveSoftPityStep(packId: PurchasePackInput["packId"], pityState: PityState) {
  if (packId === "epicPack" && pityState.targetCounter >= 10) return 1;
  if (packId === "legendaryPack" && pityState.targetCounter >= 10) return 2;
  if (packId === "legendaryPack" && pityState.targetCounter >= 5) return 1;
  return 0;
}

async function upsertLegacyPlayerSaveMirror(supabase: SupabaseClient, userId: string, save: GameSaveSnapshot) {
  const { error } = await supabase.from("player_saves").upsert(
    {
      user_id: userId,
      save,
      save_version: save.schemaVersion,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  );
  if (error) throw new Error(error.message);
}

function secureRandomFloat() {
  return randomInt(0, 1_000_000) / 1_000_000;
}

function numberOrNull(value: unknown): number | null {
  if (value == null) return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function nullableWindowType(value: unknown): "calendar_day_utc" | "rolling_hours" | null {
  return value === "calendar_day_utc" || value === "rolling_hours" ? value : null;
}

function mapRarityToCatalog(rarity: Rarity) {
  switch (rarity) {
    case "basic":
      return "COMMON";
    case "epic":
      return "EPIC";
    case "legendary":
      return "LEGENDARY";
    case "mythic":
      return "MYTHIC";
  }
}

function mapCatalogRarity(rarity: string): Rarity {
  switch (rarity) {
    case "COMMON":
      return "basic";
    case "RARE":
    case "EPIC":
      return "epic";
    case "LEGENDARY":
      return "legendary";
    case "MYTHIC":
      return "mythic";
    default:
      return "basic";
  }
}

function isMissingPackSchemaError(message: string) {
  return (
    message.includes("pack_definitions") ||
    message.includes("card_duplicate_rewards") ||
    message.includes("monetization_config_versions")
  ) && (message.includes("does not exist") || message.includes("Could not find"));
}
