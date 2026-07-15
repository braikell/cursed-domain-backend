import type { SupabaseClient } from "@supabase/supabase-js";

import { createAuthSupabaseClient, createServiceSupabaseClient } from "../../supabase.js";
import type { BootstrapResponse } from "../../contracts.js";
import {
  compareStageKeys,
  createInitialGameSave,
  DEFAULT_UNLOCKED_TEAM_SLOTS,
  FORMATION_GRID_SLOT_COUNT,
  GAME_SAVE_SCHEMA_VERSION,
  MAX_TEAM_SIZE,
  normalizeGameSave,
  normalizeStageKey,
  normalizeTeamFormation,
  toLegacyStageKey,
  type GameSaveSnapshot,
} from "./game-save.js";
import {
  ensureBootstrapMonetizationFoundation,
  updateLoginMissionProgress,
} from "./monetization-foundation.js";
import { getCardBalance, normalizeCharacterKey } from "../cards/balance.js";
import { normalizeCardMaterialId, pruneOwnedCardUnlockElements, syncOwnedCardFragmentMirrors } from "../cards/materials.js";
import { normalizeEquipmentRarityForDatabase, normalizeEquipmentSlotForDatabase } from "../equipment/balance.js";
import { resolvePlayerLevelFromXp } from "../progression/player-progression.js";

interface PlayerSaveRow {
  save: GameSaveSnapshot;
  save_version: number;
  updated_at: string;
}

interface SnapshotRow {
  user_id: string;
  player_level: number;
  xp: number;
  current_stage_key: string | null;
  highest_stage_key: string | null;
  last_cleared_stage_key: string | null;
  campaign_world_key: string | null;
  total_summons: number;
  total_battles_won: number;
  gold: number;
  gems: number;
  active_formation_key: string | null;
  active_formation_unlocked_slots: number | null;
  active_team_slots: unknown;
  owned_card_count: number;
  owned_base_card_count: number;
  owned_definitive_card_count: number;
  inventory_item_count: number;
  material_stack_count: number;
  afk_last_claimed_at: string | null;
  snapshot_updated_at: string;
}

interface PlayerProgressRuntimeRow {
  player_level: number | null;
  xp: number | null;
  current_stage: string | null;
  highest_stage: string | null;
  unlocked_slots: number | null;
  total_summons: number | null;
  total_battles_won: number | null;
}

interface FormationHeaderRow {
  id: string;
  unlocked_slots: number;
  source_save_version?: number | null;
}

interface FormationSlotRow {
  team_position: number;
  board_slot: number;
  user_card_id: string;
  card_definition_uuid?: string | null;
  character_definition_uuid?: string | null;
}

interface UserCardRow {
  id: string;
  character_key: string | null;
  character_id: string;
  card_definition_uuid?: string | null;
  character_definition_uuid?: string | null;
  acquired_at: string;
  is_starter: boolean;
  variant: string | null;
  card_type: string | null;
}

interface DefinitiveCardRow {
  card_definition_id: string;
  character_id: string;
  level: number;
  xp: number;
  stars: number;
  ascension: number;
  awakening: number;
  fragments: number;
  acquired_at: string;
}

const PRIMARY_FORMATION_KEY = "primary";
const STARTER_CHARACTER_IDS = new Set(["yuji", "nobara"]);

export async function bootstrapPlayer(accessToken: string, userId: string): Promise<BootstrapResponse> {
  const service = createServiceSupabaseClient();
  await ensureProfile(accessToken, userId, service);

  const ensured = await ensurePlayerSave(accessToken, userId, service);
  const snapshot = await buildCanonicalBootstrapSnapshot(service, userId, ensured.save);

  try {
    const config = await ensureBootstrapMonetizationFoundation(service, userId);
    await updateLoginMissionProgress(service, userId, config);
  } catch (error) {
    console.warn(
      "[godot-backend] bootstrap mission progress skipped:",
      error instanceof Error ? error.message : String(error),
    );
  }

  return {
    ok: true,
    userId,
    save: ensured.save,
    snapshot,
    updatedAt: ensured.updatedAt,
    saveVersion: ensured.saveVersion,
  };
}

async function ensureProfile(accessToken: string, userId: string, service: SupabaseClient) {
  const authClient = createAuthSupabaseClient();
  const authResult = await (authClient.auth as {
    getUser: (jwt: string) => Promise<{
      data: {
        user: {
          id: string;
          email?: string | null;
          user_metadata?: Record<string, unknown> | null;
        } | null;
      };
      error: { message?: string } | null;
    }>;
  }).getUser(accessToken);
  const user = authResult.data.user;
  if (authResult.error != null || user == null || user.id !== userId) {
    throw new Error("Unauthorized");
  }

  const email = user.email ?? null;
  const displayName =
    typeof user.user_metadata?.full_name === "string"
      ? user.user_metadata.full_name
      : typeof user.user_metadata?.name === "string"
        ? user.user_metadata.name
        : null;
  const avatarUrl = typeof user.user_metadata?.avatar_url === "string" ? user.user_metadata.avatar_url : null;

  const { data: existingProfile, error: existingProfileError } = await service
    .from("profiles")
    .select("display_name, avatar_url, profile_created_at, display_name_changed_at, profile_backdrop")
    .eq("id", user.id)
    .maybeSingle<{
      display_name: string | null;
      avatar_url: string | null;
      profile_created_at: string | null;
      display_name_changed_at: string | null;
      profile_backdrop: string | null;
    }>();
  const profileMetadataColumnsAvailable =
    existingProfileError == null ||
    !(
      existingProfileError.message.includes("profile_created_at") ||
      existingProfileError.message.includes("display_name_changed_at") ||
      existingProfileError.message.includes("profile_backdrop") ||
      existingProfileError.message.includes("schema cache")
    );
  if (existingProfileError && profileMetadataColumnsAvailable) throw new Error(existingProfileError.message);

  const profilePayload: Record<string, unknown> = {
    id: user.id,
    email,
    display_name: existingProfile?.display_name ?? displayName,
    avatar_url: existingProfile?.avatar_url ?? avatarUrl,
    updated_at: new Date().toISOString(),
  };
  if (profileMetadataColumnsAvailable) {
    profilePayload.profile_created_at = existingProfile?.profile_created_at ?? new Date().toISOString();
    profilePayload.display_name_changed_at = existingProfile?.display_name_changed_at ?? null;
    profilePayload.profile_backdrop = existingProfile?.profile_backdrop ?? "eclipse";
  }

  const { error } = await service.from("profiles").upsert(profilePayload, { onConflict: "id" });
  if (error) throw new Error(error.message);
}

async function ensurePlayerSave(
  accessToken: string,
  userId: string,
  service: SupabaseClient,
): Promise<{ save: GameSaveSnapshot; updatedAt: string; saveVersion: number }> {
  const { data: existing, error: readError } = await service
    .from("player_saves")
    .select("save, save_version, updated_at")
    .eq("user_id", userId)
    .maybeSingle<PlayerSaveRow>();

  if (readError) throw new Error(readError.message);

  if (existing != null) {
    const baseSave = normalizeGameSave(existing.save);
    const hydratedCardsSave = await hydrateDefinitiveCardsFromServer(service, userId, baseSave);
    await tryEnsureBootstrapMonetizationFoundation(service, userId);
    const canonicalSave = await hydrateCanonicalRuntimeState(service, userId, hydratedCardsSave);
    const save = await hydrateSaveFormationFromServer(service, userId, canonicalSave);
    await tryEnsureServerGameFoundation(service, userId, save);
    await persistCanonicalPlayerSave(service, userId, save);
    return {
      save,
      updatedAt: existing.updated_at,
      saveVersion: existing.save_version,
    };
  }

  const initialSave = createInitialGameSave();
  const { data: created, error: insertError } = await service
    .from("player_saves")
    .insert({
      user_id: userId,
      save: initialSave,
      save_version: initialSave.schemaVersion,
    })
    .select("save, save_version, updated_at")
    .single<PlayerSaveRow>();

  if (insertError) {
    const { data: retry, error: retryError } = await service
      .from("player_saves")
      .select("save, save_version, updated_at")
      .eq("user_id", userId)
      .single<PlayerSaveRow>();

    if (retryError) throw new Error(insertError.message);
    const retrySave = normalizeGameSave(retry.save);
    const hydratedRetrySave = await hydrateDefinitiveCardsFromServer(service, userId, retrySave);
    await tryEnsureBootstrapMonetizationFoundation(service, userId);
    const canonicalRetrySave = await hydrateCanonicalRuntimeState(service, userId, hydratedRetrySave);
    const hydratedFormationSave = await hydrateSaveFormationFromServer(service, userId, canonicalRetrySave);
    await tryEnsureServerGameFoundation(service, userId, hydratedFormationSave);
    await persistCanonicalPlayerSave(service, userId, hydratedFormationSave);
    return {
      save: hydratedFormationSave,
      updatedAt: retry.updated_at,
      saveVersion: retry.save_version,
    };
  }

  const createdSave = normalizeGameSave(created.save);
  await tryEnsureServerGameFoundation(service, userId, createdSave);
  await tryEnsureBootstrapMonetizationFoundation(service, userId);
  const canonicalCreatedSave = await hydrateCanonicalRuntimeState(service, userId, createdSave);
  const hydratedFormationSave = await hydrateSaveFormationFromServer(service, userId, canonicalCreatedSave);
  await persistCanonicalPlayerSave(service, userId, hydratedFormationSave);
  return {
    save: hydratedFormationSave,
    updatedAt: created.updated_at,
    saveVersion: created.save_version,
  };
}

async function loadGodotSnapshot(service: SupabaseClient, userId: string) {
  const { data, error } = await service
    .from("godot_player_sync_snapshot")
    .select("*")
    .eq("user_id", userId)
    .limit(1)
    .maybeSingle<SnapshotRow>();
  if (error) throw new Error(error.message);
  return data;
}

async function buildCanonicalBootstrapSnapshot(
  service: SupabaseClient,
  userId: string,
  save: GameSaveSnapshot,
) {
  const rawSnapshot = await loadGodotSnapshot(service, userId).catch(() => null);
  const snapshot: Record<string, unknown> = {
    user_id: userId,
    player_level: save.playerLevel,
    xp: save.xp,
    current_stage_key: save.currentStage,
    highest_stage_key: save.highestStage,
    last_cleared_stage_key: rawSnapshot?.last_cleared_stage_key ?? null,
    campaign_world_key: rawSnapshot?.campaign_world_key ?? null,
    total_summons: save.totalSummons,
    total_battles_won: save.totalBattlesWon,
    gold: save.gold,
    gems: save.gems,
    active_formation_key: rawSnapshot?.active_formation_key ?? PRIMARY_FORMATION_KEY,
    active_formation_unlocked_slots: save.unlockedSlots,
    active_team_slots: buildActiveTeamSlots(save),
    owned_card_count: Object.keys(save.characters).length,
    owned_base_card_count: Object.keys(save.characters).length,
    owned_definitive_card_count: Object.keys(save.definitiveCards).length,
    inventory_item_count: save.inventory.length,
    material_stack_count: Object.keys(save.fragments).length,
    afk_last_claimed_at: new Date(save.lastAfkAt).toISOString(),
    snapshot_updated_at: new Date().toISOString(),
  };

  if (rawSnapshot != null) {
    const rawEntries = rawSnapshot as unknown as Record<string, unknown>;
    for (const [key, value] of Object.entries(rawEntries)) {
      if (!(key in snapshot)) {
        snapshot[key] = value;
      }
    }
  }

  return snapshot;
}

function buildActiveTeamSlots(save: GameSaveSnapshot) {
  return save.team
    .map((characterId, teamPosition) => {
      if (!characterId) return null;
      const assignment = save.formation.find((entry) => entry.characterId === characterId) ?? null;
      if (assignment == null) return null;
      return {
        team_position: teamPosition,
        board_slot: assignment.slot,
        character_id: characterId,
      };
    })
    .filter(Boolean);
}

async function tryEnsureBootstrapMonetizationFoundation(service: SupabaseClient, userId: string) {
  try {
    await ensureBootstrapMonetizationFoundation(service, userId);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (
      (message.includes("monetization_config_versions") ||
        message.includes("pack_definitions") ||
        message.includes("target_counter") ||
        message.includes("soft_pity_step") ||
        message.includes("config_version")) &&
      (message.includes("does not exist") || message.includes("Could not find") || message.includes("column"))
    ) {
      return;
    }
    throw error;
  }
}

async function hydrateCanonicalRuntimeState(
  service: SupabaseClient,
  userId: string,
  save: GameSaveSnapshot,
): Promise<GameSaveSnapshot> {
  const nextSave = normalizeGameSave(save);

  const { data: progress } = await service
    .from("player_progress")
    .select("player_level, xp, current_stage, highest_stage, unlocked_slots, total_summons, total_battles_won")
    .eq("user_id", userId)
    .maybeSingle<PlayerProgressRuntimeRow>();
  if (progress != null) {
    if (typeof progress.xp === "number") nextSave.xp = progress.xp;
    if (typeof progress.current_stage === "string" && progress.current_stage.trim().length > 0) {
      const normalizedProgressCurrent = normalizeStageKey(progress.current_stage, nextSave.currentStage);
      if (compareStageKeys(normalizedProgressCurrent, nextSave.currentStage) > 0) {
        nextSave.currentStage = normalizedProgressCurrent;
      }
    }
    if (typeof progress.highest_stage === "string" && progress.highest_stage.trim().length > 0) {
      const normalizedProgressHighest = normalizeStageKey(progress.highest_stage, nextSave.highestStage);
      if (compareStageKeys(normalizedProgressHighest, nextSave.highestStage) > 0) {
        nextSave.highestStage = normalizedProgressHighest;
      }
    }
    if (typeof progress.unlocked_slots === "number") nextSave.unlockedSlots = progress.unlocked_slots;
    if (typeof progress.total_summons === "number") nextSave.totalSummons = progress.total_summons;
    if (typeof progress.total_battles_won === "number") nextSave.totalBattlesWon = progress.total_battles_won;
  }
  nextSave.playerLevel = resolvePlayerLevelFromXp(nextSave.xp);

  const { data: economy } = await service
    .from("user_economy")
    .select("gold, gems")
    .eq("user_id", userId)
    .maybeSingle<{ gold: number; gems: number }>();
  if (economy != null) {
    nextSave.gold = economy.gold;
    nextSave.gems = economy.gems;
  }

  const { data: materialRows, error: materialError } = await service
    .from("user_materials")
    .select("material_id, quantity")
    .eq("user_id", userId)
    .returns<Array<{ material_id: string | null; quantity: number | null }>>();
  if (materialError) throw new Error(materialError.message);
  for (const row of materialRows ?? []) {
    const materialId = normalizeSaveMaterialId(String(row.material_id ?? ""));
    const quantity = Math.max(0, Math.floor(Number(row.quantity) || 0));
    if (materialId.length === 0 || quantity <= 0) continue;
    nextSave.fragments[materialId] = Math.max(Math.max(0, Math.floor(Number(nextSave.fragments[materialId]) || 0)), quantity);
  }
  const prunedOwnedElementMaterialIds = pruneOwnedCardUnlockElements(nextSave);
  await cleanupPrunedMaterialRows(service, userId, prunedOwnedElementMaterialIds);
  syncOwnedCardFragmentMirrors(nextSave);

  const { data: afk } = await service
    .from("user_afk")
    .select("last_claimed_at")
    .eq("user_id", userId)
    .maybeSingle<{ last_claimed_at: string | null }>();
  if (afk?.last_claimed_at) {
    nextSave.lastAfkAt = new Date(afk.last_claimed_at).getTime();
  }

  return nextSave;
}

async function persistCanonicalPlayerSave(service: SupabaseClient, userId: string, save: GameSaveSnapshot) {
  const { error } = await service.from("player_saves").upsert(
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

async function cleanupPrunedMaterialRows(service: SupabaseClient, userId: string, materialIds: string[]) {
  const normalizedMaterialIds = Array.from(new Set(materialIds.map(normalizeCardMaterialId).filter(Boolean)));
  if (normalizedMaterialIds.length === 0) return;

  const { error } = await service
    .from("user_materials")
    .delete()
    .eq("user_id", userId)
    .in("material_id", normalizedMaterialIds);
  if (error) {
    console.warn("[bootstrap] pruned material cleanup skipped:", error.message);
  }
}

async function tryEnsureServerGameFoundation(service: SupabaseClient, userId: string, save: GameSaveSnapshot) {
  try {
    await ensureServerGameFoundation(service, userId, save);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (
      (message.includes("player_progress") ||
        message.includes("user_economy") ||
        message.includes("user_cards") ||
        message.includes("schema cache")) &&
      (message.includes("does not exist") || message.includes("Could not find"))
    ) {
      return;
    }
    throw error;
  }
}

async function ensureServerGameFoundation(service: SupabaseClient, userId: string, save: GameSaveSnapshot) {
  const now = new Date().toISOString();

  console.log("[bootstrap] ensureServerGameFoundation:start", {
    userId,
    characterCount: Object.keys(save.characters ?? {}).length,
    definitiveCount: Object.keys(save.definitiveCards ?? {}).length,
  });

  await upsertOrThrow(service, "player_progress", {
    user_id: userId,
    player_level: save.playerLevel,
    xp: save.xp,
    current_stage: toLegacyStageKey(save.currentStage),
    highest_stage: toLegacyStageKey(save.highestStage),
    unlocked_slots: save.unlockedSlots,
    total_summons: save.totalSummons,
    total_battles_won: save.totalBattlesWon,
    updated_at: now,
  });

  await upsertOrThrow(service, "user_economy", {
    user_id: userId,
    gold: save.gold,
    gems: save.gems,
    updated_at: now,
  });

  const baseCardRows = Object.values(save.characters).map((character) => {
    const characterId = normalizeCharacterKey(character.id);
    const balance = getCardBalance(characterId, "BASE");
    const rarity = balance?.rarity ?? "basic";
    const cardKey = balance?.card_key ?? `${characterId}_base_${rarity}`;
    return {
      user_id: userId,
      card_definition_id: cardKey,
      character_id: characterId,
      character_key: characterId,
      variant: "base",
      card_type: "BASE",
      rarity,
      definition_rarity: mapCardRarityToDefinitionRarity(rarity),
      card_key: cardKey,
      level: character.level,
      xp: character.xp,
      stars: character.stars,
      ascension: character.ascension,
      awakening: character.awakening,
      fragments: character.fragments,
      energy: Math.floor(character.energy),
      max_energy: Math.floor(character.maxEnergy),
      is_starter: STARTER_CHARACTER_IDS.has(characterId),
      acquired_at: now,
      updated_at: now,
    };
  });

  const definitiveCardRows = Object.values(save.definitiveCards ?? {}).map((card) => {
    const characterId = normalizeCharacterKey(card.characterId);
    const balance = getCardBalance(characterId, "DEFINITIVA");
    const rarity = balance?.rarity ?? "legendary";
    const cardKey = balance?.card_key ?? card.cardDefinitionId ?? `${characterId}_definitiva_${rarity}`;
    return {
      user_id: userId,
      card_definition_id: cardKey,
      character_id: characterId,
      character_key: characterId,
      variant: "definitive",
      card_type: "DEFINITIVA",
      rarity,
      definition_rarity: mapCardRarityToDefinitionRarity(rarity),
      card_key: cardKey,
      level: card.level,
      xp: card.xp,
      stars: card.stars,
      ascension: card.ascension,
      awakening: card.awakening,
      fragments: card.fragments,
      energy: 0,
      max_energy: balance?.max_energy ?? 100,
      is_starter: false,
      acquired_at: new Date(card.acquiredAt || Date.now()).toISOString(),
      updated_at: now,
    };
  });

  console.log("[bootstrap] ensureServerGameFoundation:user_cards_payload", {
    userId,
    rows: baseCardRows.length + definitiveCardRows.length,
    cardDefinitionIds: [...baseCardRows, ...definitiveCardRows].map((row) => row.card_definition_id),
  });

  const cardRows = [...baseCardRows, ...definitiveCardRows];
  if (cardRows.length > 0) {
    await upsertOrThrow(service, "user_cards", cardRows, "user_id,card_definition_id");
    console.log("[bootstrap] ensureServerGameFoundation:user_cards_upsert_ok", {
      userId,
      rows: cardRows.length,
    });
  }

  await syncSaveFormationToServer(service, userId, save);

  await upsertOrThrow(service, "user_afk", {
    user_id: userId,
    last_claimed_at: new Date(save.lastAfkAt).toISOString(),
    updated_at: now,
  });

  if (save.inventory.length > 0) {
    const inventoryRows = save.inventory.map((item) => ({
      user_id: userId,
      id: item.id,
      slot: normalizeEquipmentSlotForDatabase(item.slot),
      rarity: normalizeEquipmentRarityForDatabase(item.rarity),
      name: item.name,
      atk: item.ad,
      hp: item.hp,
      def: item.ap,
      equipment_key: item.equipmentKey ?? null,
      equipment_tier: item.tier ?? 1,
      equipped_to_card_id: null,
      updated_at: now,
    }));
    await upsertOrThrow(service, "user_inventory", inventoryRows, "user_id,id");
  }

  const materialRows = buildUserMaterialRows(userId, save.fragments, now);
  if (materialRows.length > 0) {
    await upsertOrThrow(service, "user_materials", materialRows, "user_id,material_id");
  }

  if (save.missions.length > 0) {
    const missionRows = save.missions.map((mission) => ({
      user_id: userId,
      mission_id: mission.id,
      mission_type: "static",
      progress: mission.progress,
      target: mission.target,
      claimed: mission.claimed,
      reward: mission.reward,
      updated_at: now,
    }));
    await upsertOrThrow(service, "user_missions", missionRows, "user_id,mission_id");
  }

  await upsertOrThrow(service, "user_pity", {
    user_id: userId,
    pack_id: "standard",
    pity_legendary: save.pityLegendary,
    pity_mythic: save.pityMythic,
    updated_at: now,
  });
}

async function hydrateDefinitiveCardsFromServer(
  service: SupabaseClient,
  userId: string,
  save: GameSaveSnapshot,
): Promise<GameSaveSnapshot> {
  try {
    const { data, error } = await service
      .from("user_cards")
      .select("card_definition_id, character_id, level, xp, stars, ascension, awakening, fragments, acquired_at")
      .eq("user_id", userId)
      .eq("variant", "definitive")
      .returns<DefinitiveCardRow[]>();
    if (error) throw new Error(error.message);
    if (!data?.length) return save;

    const definitiveCards = { ...(save.definitiveCards ?? {}) };
    for (const row of data) {
      definitiveCards[row.character_id] = {
        characterId: row.character_id,
        cardDefinitionId: row.card_definition_id,
        level: row.level,
        xp: row.xp,
        stars: row.stars,
        ascension: row.ascension,
        awakening: row.awakening,
        fragments: row.fragments,
        acquiredAt: new Date(row.acquired_at).getTime(),
      };
    }

    return { ...save, definitiveCards };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (
      (message.includes("user_cards") || message.includes("schema cache")) &&
      (message.includes("does not exist") || message.includes("Could not find"))
    ) {
      return save;
    }
    throw error;
  }
}

async function hydrateSaveFormationFromServer(
  service: SupabaseClient,
  userId: string,
  save: GameSaveSnapshot,
): Promise<GameSaveSnapshot> {
  try {
    const { data: formation, error: formationError } = await service
      .from("user_formations")
      .select("id, unlocked_slots")
      .eq("user_id", userId)
      .eq("formation_key", PRIMARY_FORMATION_KEY)
      .eq("is_enabled", true)
      .order("is_active", { ascending: false })
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle<FormationHeaderRow>();
    if (formationError) throw new Error(formationError.message);
    if (!formation) {
      return {
        ...save,
        formation: [],
      };
    }

    const { data: slotRows, error: slotError } = await service
      .from("user_formation_slots")
      .select("team_position, board_slot, user_card_id")
      .eq("formation_id", formation.id)
      .order("team_position", { ascending: true })
      .returns<FormationSlotRow[]>();
    if (slotError) throw new Error(slotError.message);
    if (!slotRows?.length) {
      return {
        ...save,
        formation: [],
        unlockedSlots: clampUnlockedSlots(formation.unlocked_slots),
      };
    }

    const userCardIds = [...new Set(slotRows.map((slot: FormationSlotRow) => slot.user_card_id).filter(Boolean))] as string[];
    const { data: userCards, error: userCardsError } = await service
      .from("user_cards")
      .select("id, character_key, character_id")
      .in("id", userCardIds)
      .returns<Array<Pick<UserCardRow, "id" | "character_key" | "character_id">>>();
    if (userCardsError) throw new Error(userCardsError.message);

    const userCardsById = new Map<string, string>(
      (userCards ?? []).map((row: Pick<UserCardRow, "id" | "character_key" | "character_id">) =>
        [row.id, normalizeCharacterKey(row.character_key?.trim() || row.character_id)] as const,
      ),
    );
    const team = Array.from({ length: MAX_TEAM_SIZE }, () => null) as (string | null)[];
    const formationAssignments: Array<{ characterId: string; slot: number }> = [];
    const usedCharacters = new Set<string>();
    const usedSlots = new Set<number>();

    for (const slotRow of slotRows) {
      if (!Number.isInteger(slotRow.team_position) || slotRow.team_position < 0 || slotRow.team_position >= MAX_TEAM_SIZE) {
        continue;
      }
      const characterId = userCardsById.get(slotRow.user_card_id);
      if (!characterId || usedCharacters.has(characterId) || usedSlots.has(slotRow.board_slot)) continue;

      team[slotRow.team_position] = characterId;
      formationAssignments.push({ characterId, slot: slotRow.board_slot });
      usedCharacters.add(characterId);
      usedSlots.add(slotRow.board_slot);
    }

    if (!team.some(Boolean)) {
      return {
        ...save,
        formation: [],
        unlockedSlots: clampUnlockedSlots(formation.unlocked_slots),
      };
    }

    return {
      ...save,
      team,
      formation: normalizeTeamFormation(team, formationAssignments),
      unlockedSlots: clampUnlockedSlots(formation.unlocked_slots),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (
      (message.includes("user_formations") ||
        message.includes("user_formation_slots") ||
        message.includes("character_key") ||
        message.includes("formation_key")) &&
      (message.includes("does not exist") || message.includes("Could not find"))
    ) {
      return save;
    }
    throw error;
  }
}

function buildUserMaterialRows(userId: string, fragments: Record<string, number>, now: string) {
  const quantitiesByMaterialId = new Map<string, number>();
  for (const [materialKey, quantity] of Object.entries(fragments)) {
    const materialId = normalizeSaveMaterialId(materialKey);
    if (materialId.length === 0) continue;
    const normalizedQuantity = Math.max(0, Math.floor(Number(quantity) || 0));
    if (normalizedQuantity <= 0) continue;
    quantitiesByMaterialId.set(materialId, Math.max(quantitiesByMaterialId.get(materialId) ?? 0, normalizedQuantity));
  }
  return Array.from(quantitiesByMaterialId.entries()).map(([materialId, quantity]) => ({
    user_id: userId,
    material_id: materialId,
    quantity,
    updated_at: now,
  }));
}

function normalizeSaveMaterialId(value: string) {
  const materialId = normalizeCardMaterialId(value);
  if (materialId.length === 0) return "";
  if (materialId.includes(":")) return materialId;
  return `fragment:${materialId}`;
}

async function syncSaveFormationToServer(service: SupabaseClient, userId: string, save: GameSaveSnapshot) {
  const normalizedTeam = [
    ...save.team.slice(0, MAX_TEAM_SIZE),
    ...Array.from({ length: Math.max(0, MAX_TEAM_SIZE - save.team.length) }, () => null),
  ].slice(0, MAX_TEAM_SIZE).map((characterId) => characterId == null ? null : normalizeCharacterKey(characterId));
  const normalizedFormation = normalizeTeamFormation(normalizedTeam, save.formation);
  const activeCharacterIds = normalizedTeam.filter((characterId): characterId is string => Boolean(characterId));

  const { data: existingFormation, error: existingFormationError } = await service
    .from("user_formations")
    .select("id, source_save_version")
    .eq("user_id", userId)
    .eq("formation_key", PRIMARY_FORMATION_KEY)
    .maybeSingle<Pick<FormationHeaderRow, "id" | "source_save_version">>();
  if (existingFormationError) throw new Error(existingFormationError.message);

  const { data: formationRow, error: formationError } = await service
    .from("user_formations")
    .upsert(
      {
        user_id: userId,
        formation_key: PRIMARY_FORMATION_KEY,
        display_name: "Primary Formation",
        formation_type: "CAMPAIGN",
        team_size_limit: MAX_TEAM_SIZE,
        unlocked_slots: clampUnlockedSlots(save.unlockedSlots),
        is_active: true,
        is_enabled: true,
        source_save_version: existingFormation?.source_save_version === 0 ? 0 : save.schemaVersion,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,formation_key" },
    )
    .select("id, source_save_version")
    .single<Pick<FormationHeaderRow, "id" | "source_save_version">>();
  if (formationError) throw new Error(formationError.message);

  const { data: userCardRows, error: userCardsError } = await service
    .from("user_cards")
    .select("id, character_key, character_id, card_definition_uuid, character_definition_uuid, acquired_at, is_starter, variant, card_type")
    .eq("user_id", userId)
    .returns<UserCardRow[]>();
  if (userCardsError) throw new Error(userCardsError.message);

  const userCardsById = new Map<string, UserCardRow>();
  const baseCardsByCharacter = new Map<string, UserCardRow>();
  for (const row of userCardRows ?? []) {
    userCardsById.set(row.id, row);
    const isBaseCard =
      row.card_type === "BASE" ||
      row.variant === "base" ||
      (row.card_type == null && row.variant == null);
    if (!isBaseCard) continue;

    const characterKey = normalizeCharacterKey(row.character_key?.trim() || row.character_id);
    const current = baseCardsByCharacter.get(characterKey);
    if (!current || compareBaseCardPriority(row, current) < 0) {
      baseCardsByCharacter.set(characterKey, row);
    }
  }

  const { data: existingSlotRows, error: existingSlotsError } = await service
    .from("user_formation_slots")
    .select("team_position, board_slot, user_card_id, card_definition_uuid, character_definition_uuid")
    .eq("formation_id", formationRow.id)
    .returns<FormationSlotRow[]>();
  if (existingSlotsError) throw new Error(existingSlotsError.message);

  const exactExistingSlots = (existingSlotRows ?? []).filter((slot) => {
    if (!Number.isInteger(slot.team_position) || slot.team_position < 0 || slot.team_position >= MAX_TEAM_SIZE) return false;
    if (!Number.isInteger(slot.board_slot) || slot.board_slot < 0 || slot.board_slot >= FORMATION_GRID_SLOT_COUNT) return false;
    return userCardsById.has(slot.user_card_id);
  });

  if (exactExistingSlots.length > 0) {
    return;
  }

  if ((existingSlotRows ?? []).length === 0 && formationRow.source_save_version === 0) {
    return;
  }

  const existingCardsByTeamPosition = new Map<number, UserCardRow>();
  for (const slot of existingSlotRows ?? []) {
    const card = userCardsById.get(slot.user_card_id);
    if (!card) continue;
    const characterKey = normalizeCharacterKey(card.character_key?.trim() || card.character_id);
    if (normalizedTeam[slot.team_position] !== characterKey) continue;
    existingCardsByTeamPosition.set(slot.team_position, card);
  }

  const slotRows = activeCharacterIds
    .map((characterId, teamPosition) => {
      const existingCard = existingCardsByTeamPosition.get(teamPosition);
      const selectedCard = existingCard ?? baseCardsByCharacter.get(characterId);
      if (!selectedCard) return null;
      const assignment = normalizedFormation.find((entry) => entry.characterId === characterId) ?? null;
      return {
        formation_id: formationRow.id,
        team_position: teamPosition,
        board_slot: assignment?.slot ?? teamPosition,
        user_card_id: selectedCard.id,
        card_definition_uuid: selectedCard.card_definition_uuid ?? null,
        character_definition_uuid: selectedCard.character_definition_uuid ?? null,
      };
    })
    .filter((row): row is NonNullable<typeof row> => Boolean(row));

  const { error: deleteError } = await service
    .from("user_formation_slots")
    .delete()
    .eq("formation_id", formationRow.id);
  if (deleteError) throw new Error(deleteError.message);

  if (slotRows.length === 0) return;

  const { error: insertError } = await service.from("user_formation_slots").insert(slotRows);
  if (insertError) throw new Error(insertError.message);
}

async function upsertOrThrow(
  service: SupabaseClient,
  table: string,
  values: Record<string, unknown> | Array<Record<string, unknown>>,
  onConflict?: string,
) {
  const safeValues = Array.isArray(values) && onConflict
    ? dedupeUpsertRows(table, values, onConflict)
    : values;
  const query = service.from(table).upsert(safeValues, onConflict ? { onConflict } : undefined);
  const { error } = await query;
  if (error) throw new Error(error.message);
}

function dedupeUpsertRows(table: string, rows: Array<Record<string, unknown>>, onConflict: string) {
  const conflictColumns = onConflict.split(",").map((column) => column.trim()).filter(Boolean);
  if (conflictColumns.length === 0 || rows.length <= 1) return rows;

  const deduped = new Map<string, Record<string, unknown>>();
  for (const row of rows) {
    const key = conflictColumns.map((column) => String(row[column] ?? "")).join("\u001f");
    deduped.set(key, row);
  }

  if (deduped.size !== rows.length) {
    console.warn("[bootstrap] duplicate upsert rows collapsed", {
      table,
      onConflict,
      before: rows.length,
      after: deduped.size,
    });
  }

  return Array.from(deduped.values());
}

function clampUnlockedSlots(value: number | null | undefined) {
  return Math.max(1, Math.min(value ?? DEFAULT_UNLOCKED_TEAM_SLOTS, MAX_TEAM_SIZE));
}

function compareBaseCardPriority(left: UserCardRow, right: UserCardRow) {
  if (left.is_starter !== right.is_starter) {
    return left.is_starter ? -1 : 1;
  }
  const leftTime = Date.parse(left.acquired_at);
  const rightTime = Date.parse(right.acquired_at);
  if (Number.isFinite(leftTime) && Number.isFinite(rightTime) && leftTime !== rightTime) {
    return leftTime - rightTime;
  }
  return left.id.localeCompare(right.id);
}

function mapCardRarityToDefinitionRarity(rarity: string) {
  switch (String(rarity).trim().toLowerCase()) {
    case "epic":
      return "EPIC";
    case "legendary":
      return "LEGENDARY";
    case "mythic":
      return "MYTHIC";
    case "basic":
    default:
      return "COMMON";
  }
}
