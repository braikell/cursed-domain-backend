import type { GodotAuthedRequestContext } from "../../contracts.js";
import { getArenaCosmeticsDedicated } from "../arena-cosmetics/service.js";
import { getEquipmentDedicated } from "../equipment/service.js";

type Snapshot = Record<string, unknown>;

/** Read-only hub. Mutations remain in their owning domain services. */
export async function getInventoryHubDedicated(context: GodotAuthedRequestContext): Promise<unknown> {
  // Equipment may normalize legacy saves, so resolve it before reading cosmetics.
  const equipmentRaw = await getEquipmentDedicated(context);
  const arenasRaw = await getArenaCosmeticsDedicated(context);
  const equipment = equipmentRaw as Snapshot;
  const arenas = arenasRaw as Snapshot;
  const balances = (arenas.balances ?? { gold: equipment.gold ?? 0 }) as Snapshot;
  return {
    ok: true as const,
    schemaVersion: 2,
    sections: {
      equipment: { materialModel: equipment.materialModel ?? "slot", items: equipment.items ?? [], materials: equipment.materials ?? [], heroes: equipment.heroes ?? [] },
      resources: { materials: equipment.materials ?? [] },
      consumables: { items: [] },
      collections: { arenas: { arenaCosmetics: arenas.arenaCosmetics ?? {}, catalog: arenas.catalog ?? [] } },
    },
    balances,
  };
}
