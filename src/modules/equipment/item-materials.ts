import { normalizeEquipmentRarity } from "./balance.js";
export const ITEM_MATERIAL_RARITIES = ["basic", "epic", "legendary", "mythic"] as const;
export const ITEM_MATERIAL_MODEL = "rarity_v1";
export function rarityMaterialId(rarity: unknown): string {
  return `item_materials:${normalizeEquipmentRarity(rarity)}`;
}
/** Pure debit plan: callers apply it only after validating every other cost. */
export function planMaterialDebit(balances: Record<string, number>, rarity: unknown, cost: number): Record<string, number> | null {
  if (!Number.isSafeInteger(cost) || cost < 0) throw new RangeError("Invalid material cost");
  const ids = [rarityMaterialId(rarity)];
  let remaining = cost;
  const debit: Record<string, number> = {};
  for (const id of ids) {
    const available = Math.max(0, Math.floor(Number(balances[id]) || 0));
    const amount = Math.min(available, remaining);
    if (amount > 0) debit[id] = amount;
    remaining -= amount;
  }
  return remaining === 0 ? debit : null;
}