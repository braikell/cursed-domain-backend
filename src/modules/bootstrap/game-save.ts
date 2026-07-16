export const GAME_SAVE_SCHEMA_VERSION = 3;
export const MAX_TEAM_SIZE = 3;
export const DEFAULT_UNLOCKED_TEAM_SLOTS = 3;
export const FORMATION_GRID_SLOT_COUNT = 9;
export const DEFAULT_STARTER_TEAM = ["yuji", "nobara", "megumi"] as const;
export const TEST_INITIAL_GOLD = 5_000;
export const TEST_INITIAL_GEMS = 200;

export interface EquipmentItem {
  id: string;
  slot: string;
  rarity: string;
  name: string;
  equipmentKey?: string;
  family?: string;
  tier?: number;
  equippedToCharacterId?: string | null;
  ad: number;
  hp: number;
  ap: number;
  atk?: number;
  def?: number;
}

export interface OwnedCharacter {
  id: string;
  level: number;
  xp: number;
  stars: number;
  ascension: number;
  awakening: number;
  fragments: number;
  equipment: Record<string, EquipmentItem>;
  energy: number;
  maxEnergy: number;
}

export interface MissionEntry {
  id: string;
  title: string;
  desc: string;
  target: number;
  progress: number;
  reward: {
    gold?: number;
    gems?: number;
    xp?: number;
  };
  claimed: boolean;
}

export interface TeamFormationAssignment {
  characterId: string;
  slot: number;
}

export interface OwnedDefinitiveCard {
  characterId: string;
  cardDefinitionId: string;
  level: number;
  xp: number;
  stars: number;
  ascension: number;
  awakening: number;
  fragments: number;
  acquiredAt: number;
}

export interface GameSaveSnapshot {
  schemaVersion: typeof GAME_SAVE_SCHEMA_VERSION;
  gold: number;
  gems: number;
  xp: number;
  playerLevel: number;
  characters: Record<string, OwnedCharacter>;
  team: (string | null)[];
  formation: TeamFormationAssignment[];
  unlockedSlots: number;
  currentStage: string;
  highestStage: string;
  pulls: number;
  pityLegendary: number;
  pityMythic: number;
  inventory: EquipmentItem[];
  fragments: Record<string, number>;
  definitiveCards: Record<string, OwnedDefinitiveCard>;
  missions: MissionEntry[];
  lastAfkAt: number;
  speed: 1 | 2 | 4;
  totalSummons: number;
  totalBattlesWon: number;
  cardModelVersion: 1;
}

export function normalizeStageKey(value: unknown, fallback = "world_1_stage_1"): string {
  const raw = String(value ?? "").trim();
  if (raw.length === 0) return fallback;

  const canonicalMatch = /^world_(\d+)_stage_(\d+)$/i.exec(raw);
  if (canonicalMatch) {
    return `world_${Number(canonicalMatch[1])}_stage_${Number(canonicalMatch[2])}`;
  }

  const compactMatch = /^(\d+)\s*-\s*(\d+)$/i.exec(raw);
  if (compactMatch) {
    return `world_${Number(compactMatch[1])}_stage_${Number(compactMatch[2])}`;
  }

  return raw;
}

export function toLegacyStageKey(value: unknown, fallback = "1-1"): string {
  const normalized = normalizeStageKey(value, normalizeStageKey(fallback));
  const canonicalMatch = /^world_(\d+)_stage_(\d+)$/i.exec(normalized);
  if (canonicalMatch) {
    return `${Number(canonicalMatch[1])}-${Number(canonicalMatch[2])}`;
  }
  const compactMatch = /^(\d+)\s*-\s*(\d+)$/i.exec(String(value ?? "").trim());
  if (compactMatch) {
    return `${Number(compactMatch[1])}-${Number(compactMatch[2])}`;
  }
  return fallback;
}

export function compareStageKeys(a: unknown, b: unknown): number {
  const parsedA = parseStageKeyParts(a);
  const parsedB = parseStageKeyParts(b);
  if (parsedA == null || parsedB == null) return 0;
  if (parsedA.world != parsedB.world) return parsedA.world - parsedB.world;
  return parsedA.stage - parsedB.stage;
}

export function createInitialGameSave(now = Date.now()): GameSaveSnapshot {
  return {
    schemaVersion: GAME_SAVE_SCHEMA_VERSION,
    gold: TEST_INITIAL_GOLD,
    gems: TEST_INITIAL_GEMS,
    xp: 0,
    playerLevel: 1,
    characters: {
      yuji: makeStarterCharacter("yuji"),
      nobara: makeStarterCharacter("nobara"),
      megumi: makeStarterCharacter("megumi"),
    },
    team: [...DEFAULT_STARTER_TEAM],
    formation: [],
    unlockedSlots: DEFAULT_UNLOCKED_TEAM_SLOTS,
    currentStage: "world_1_stage_1",
    highestStage: "world_1_stage_1",
    pulls: 0,
    pityLegendary: 0,
    pityMythic: 0,
    inventory: [],
    fragments: {},
    definitiveCards: {},
    missions: createDefaultMissions(),
    lastAfkAt: now,
    speed: 1,
    totalSummons: 0,
    totalBattlesWon: 0,
    cardModelVersion: 1,
  };
}

export function normalizeGameSave(source: unknown): GameSaveSnapshot {
  const fallback = createInitialGameSave();
  if (source == null || typeof source !== "object") {
    return fallback;
  }

  const save = source as Partial<GameSaveSnapshot>;
  const normalizedTeam = [
    ...((Array.isArray(save.team) ? save.team : []).slice(0, MAX_TEAM_SIZE)),
    ...Array.from({ length: Math.max(0, MAX_TEAM_SIZE - (Array.isArray(save.team) ? save.team.length : 0)) }, () => null),
  ].slice(0, MAX_TEAM_SIZE) as (string | null)[];

  return {
    ...fallback,
    ...save,
    currentStage: normalizeStageKey(save.currentStage, fallback.currentStage),
    highestStage: normalizeStageKey(save.highestStage, fallback.highestStage),
    team: normalizedTeam,
    formation: normalizeTeamFormation(normalizedTeam, Array.isArray(save.formation) ? save.formation : []),
    unlockedSlots: Math.max(1, Math.min(Number(save.unlockedSlots ?? DEFAULT_UNLOCKED_TEAM_SLOTS), MAX_TEAM_SIZE)),
    characters: typeof save.characters === "object" && save.characters != null ? (save.characters as Record<string, OwnedCharacter>) : fallback.characters,
    inventory: Array.isArray(save.inventory)
      ? (save.inventory as EquipmentItem[]).map((item) => normalizeEquipmentItem(item))
      : [],
    fragments: normalizeFragmentStacks(save.fragments),
    definitiveCards: typeof save.definitiveCards === "object" && save.definitiveCards != null ? (save.definitiveCards as Record<string, OwnedDefinitiveCard>) : {},
    missions: Array.isArray(save.missions) ? (save.missions as MissionEntry[]) : fallback.missions,
    schemaVersion: GAME_SAVE_SCHEMA_VERSION,
    cardModelVersion: 1,
  };
}

function normalizeFragmentStacks(source: unknown): Record<string, number> {
  if (source == null || typeof source !== "object") return {};

  const normalized: Record<string, number> = {};
  for (const [rawKey, rawQuantity] of Object.entries(source as Record<string, unknown>)) {
    const materialId = normalizeFragmentMaterialId(rawKey);
    if (materialId.length === 0) continue;
    const quantity = Math.max(0, Math.floor(Number(rawQuantity) || 0));
    if (quantity <= 0) continue;
    normalized[materialId] = Math.max(normalized[materialId] ?? 0, quantity);
  }
  return normalized;
}

function normalizeFragmentMaterialId(value: string): string {
  const materialId = value.trim().toLowerCase();
  if (materialId.length === 0) return "";
  if (materialId.includes(":")) return materialId;
  return `fragment:${materialId}`;
}

function normalizeEquipmentItem(item: EquipmentItem): EquipmentItem {
  const ad = Number((item as Partial<EquipmentItem>).ad ?? (item as Partial<EquipmentItem>).atk ?? 0);
  const ap = Number((item as Partial<EquipmentItem>).ap ?? (item as Partial<EquipmentItem>).def ?? 0);
  const hp = Number((item as Partial<EquipmentItem>).hp ?? 0);
  return {
    ...item,
    equipmentKey: typeof item.equipmentKey === "string" ? item.equipmentKey : undefined,
    family: typeof item.family === "string" ? item.family : undefined,
    tier: Math.max(1, Math.floor(Number(item.tier ?? 1) || 1)),
    equippedToCharacterId: typeof item.equippedToCharacterId === "string" ? item.equippedToCharacterId : null,
    ad: Number.isFinite(ad) ? Math.floor(ad) : 0,
    hp: Number.isFinite(hp) ? Math.floor(hp) : 0,
    ap: Number.isFinite(ap) ? Math.floor(ap) : 0,
    atk: Number.isFinite(ad) ? Math.floor(ad) : 0,
    def: Number.isFinite(ap) ? Math.floor(ap) : 0,
  };
}

function parseStageKeyParts(value: unknown): { world: number; stage: number } | null {
  const normalized = normalizeStageKey(value, "");
  const canonicalMatch = /^world_(\d+)_stage_(\d+)$/i.exec(normalized);
  if (!canonicalMatch) return null;
  return {
    world: Number(canonicalMatch[1]),
    stage: Number(canonicalMatch[2]),
  };
}

export function normalizeTeamFormation(
  team: readonly (string | null)[],
  formation: readonly TeamFormationAssignment[],
): TeamFormationAssignment[] {
  const activeTeam = team
    .slice(0, MAX_TEAM_SIZE)
    .filter((characterId): characterId is string => Boolean(characterId));
  const takenSlots = new Set<number>();
  const usedCharacters = new Set<string>();
  const normalized: TeamFormationAssignment[] = [];

  for (const assignment of formation) {
    if (!assignment || !activeTeam.includes(assignment.characterId)) continue;
    if (!Number.isInteger(assignment.slot) || assignment.slot < 0 || assignment.slot >= FORMATION_GRID_SLOT_COUNT) continue;
    if (usedCharacters.has(assignment.characterId) || takenSlots.has(assignment.slot)) continue;
    normalized.push({ characterId: assignment.characterId, slot: assignment.slot });
    usedCharacters.add(assignment.characterId);
    takenSlots.add(assignment.slot);
  }

  return normalized.slice(0, MAX_TEAM_SIZE);
}

function makeStarterCharacter(id: string): OwnedCharacter {
  return {
    id,
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

function createDefaultMissions(): MissionEntry[] {
  return [
    { id: "m1", title: "Primera Victoria", desc: "Gana 1 batalla", target: 1, progress: 0, reward: { gold: 500, gems: 50 }, claimed: false },
    { id: "m2", title: "Invocador Novato", desc: "Realiza 10 invocaciones", target: 10, progress: 0, reward: { gems: 300 }, claimed: false },
    { id: "m3", title: "Conquistador", desc: "Gana 10 batallas", target: 10, progress: 0, reward: { gold: 2000, xp: 500 }, claimed: false },
    { id: "m4", title: "Maestro del Gacha", desc: "Realiza 50 invocaciones", target: 50, progress: 0, reward: { gems: 1500 }, claimed: false },
    { id: "m5", title: "Aniquilador", desc: "Gana 50 batallas", target: 50, progress: 0, reward: { gold: 10000, gems: 500 }, claimed: false },
    { id: "m6", title: "Bendicion Maldita", desc: "Gana 1 batalla de campana", target: 1, progress: 0, reward: { gems: 500 }, claimed: false },
  ];
}
