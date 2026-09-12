import { DEFAULT_ARENA_ID } from "../bootstrap/game-save.js";

export type ArenaAcquisitionType = "free" | "gold" | "gems" | "event" | "season" | "chapter";

export const ARENA_ECONOMY_GUARDRAILS = Object.freeze({
  gold: Object.freeze({ min: 10000, max: 500000 }),
  gems: Object.freeze({ min: 250, max: 10000 }),
});

export interface ArenaCatalogEntry {
  id: string;
  displayName: string;
  acquisitionType: ArenaAcquisitionType;
  price: number;
  requirementId?: string;
  requirementTarget?: number;
  requirementLabel?: string;
  availableFrom?: string;
  availableUntil?: string;
  available: boolean;
}

// This catalog is authoritative for ownership and prices. Visual asset paths stay
// in Godot's validated local catalog and are deliberately never accepted from clients.
export const ARENA_COSMETICS_CATALOG: readonly ArenaCatalogEntry[] = Object.freeze([
  Object.freeze({
    id: DEFAULT_ARENA_ID,
    displayName: "Distrito Maldito",
    acquisitionType: "free" as const,
    price: 0,
    available: true,
  }),
  Object.freeze({
    id: "arena_relicario_obsidiana",
    displayName: "Relicario de Obsidiana",
    acquisitionType: "gold" as const,
    price: 75000,
    available: true,
  }),
  Object.freeze({
    id: "arena_nexo_astral",
    displayName: "Nexo Astral de Amatista",
    acquisitionType: "gems" as const,
    price: 1200,
    available: true,
  }),
  Object.freeze({
    id: "arena_ruinas_primer_sello",
    displayName: "Ruinas del Primer Sello",
    acquisitionType: "chapter" as const,
    price: 0,
    requirementId: "world_1_stage_17",
    requirementTarget: 17,
    requirementLabel: "Completa el capitulo 1",
    available: true,
  }),
  Object.freeze({
    id: "arena_noche_mil_sellos",
    displayName: "Noche de los Mil Sellos",
    acquisitionType: "event" as const,
    price: 0,
    requirementId: "event_night_wards_2026",
    requirementTarget: 3,
    requirementLabel: "Ten 3 victorias registradas",
    availableFrom: "2026-09-12T00:00:00.000Z",
    availableUntil: "2026-11-01T00:00:00.000Z",
    available: true,
  }),
  Object.freeze({
    id: "arena_trono_invierno",
    displayName: "Trono del Invierno Hueco",
    acquisitionType: "season" as const,
    price: 0,
    requirementId: "season_hollow_winter_2026",
    requirementTarget: 25,
    requirementLabel: "Ten 25 victorias registradas",
    availableFrom: "2026-09-01T00:00:00.000Z",
    availableUntil: "2026-12-01T00:00:00.000Z",
    available: true,
  }),
]);

const CATALOG_BY_ID = new Map(ARENA_COSMETICS_CATALOG.map((entry) => [entry.id, entry]));

export function findArenaCatalogEntry(arenaId: string): ArenaCatalogEntry | null {
  return CATALOG_BY_ID.get(arenaId.trim().toLowerCase()) ?? null;
}

export function isPurchasableArena(entry: ArenaCatalogEntry): boolean {
  return (entry.acquisitionType === "gold" || entry.acquisitionType === "gems") && entry.price > 0;
}

export function publicArenaCatalog() {
  return ARENA_COSMETICS_CATALOG.map((entry) => ({ ...entry }));
}

export function validateArenaCatalog(entries: readonly ArenaCatalogEntry[] = ARENA_COSMETICS_CATALOG): string[] {
  const errors: string[] = [];
  const ids = new Set<string>();
  for (const entry of entries) {
    if (!/^[a-z0-9_]{1,64}$/.test(entry.id) || ids.has(entry.id)) errors.push(`invalid_or_duplicate_id:${entry.id}`);
    ids.add(entry.id);
    if (entry.acquisitionType === "gold" || entry.acquisitionType === "gems") {
      const limits = ARENA_ECONOMY_GUARDRAILS[entry.acquisitionType];
      if (!Number.isSafeInteger(entry.price) || entry.price < limits.min || entry.price > limits.max) errors.push(`price_out_of_bounds:${entry.id}`);
    } else if (entry.price !== 0) {
      errors.push(`non_purchase_price:${entry.id}`);
    }
    if ((entry.acquisitionType === "event" || entry.acquisitionType === "season") &&
        (!entry.availableFrom || !entry.availableUntil || Date.parse(entry.availableFrom) >= Date.parse(entry.availableUntil))) {
      errors.push(`invalid_availability_window:${entry.id}`);
    }
    if (["event", "season", "chapter"].includes(entry.acquisitionType) && (!entry.requirementId || !entry.requirementTarget)) {
      errors.push(`missing_requirement:${entry.id}`);
    }
  }
  if (!ids.has(DEFAULT_ARENA_ID)) errors.push("missing_default_arena");
  return errors;
}
