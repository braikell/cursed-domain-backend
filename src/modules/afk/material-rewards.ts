import { rarityMaterialId } from "../equipment/item-materials.js";
import { getV2Bundle } from "../equipment/v2-runtime.js";
const policy = getV2Bundle().rules.afk;
export const AFK_MATERIAL_PERIOD_MS = policy.materialPeriodHours * 60 * 60 * 1000;
if (!Number.isSafeInteger(AFK_MATERIAL_PERIOD_MS) || AFK_MATERIAL_PERIOD_MS <= 0 || !Number.isSafeInteger(policy.materialCaps.basic) || !Number.isSafeInteger(policy.materialCaps.epic) || policy.materialCaps.basic < 0 || policy.materialCaps.epic < 0) throw new Error("Invalid AFK material policy");
export interface MaterialRemainders { basic: number; epic: number }
export function normalizeMaterialRemainders(value?: Partial<MaterialRemainders>): MaterialRemainders {
  const clean = (n: unknown) => Number.isSafeInteger(n) && Number(n) >= 0 ? Number(n) % AFK_MATERIAL_PERIOD_MS : 0;
  return { basic: clean(value?.basic), epic: clean(value?.epic) };
}
/** Integer accrual carries fractions between claims; premium never increases this cap. */
export function planAfkMaterials(elapsedMs: number, carry?: Partial<MaterialRemainders>) {
  if (!Number.isFinite(elapsedMs)) throw new RangeError("Invalid AFK elapsed time");
  const elapsed = Math.min(AFK_MATERIAL_PERIOD_MS, Math.max(0, Math.floor(elapsedMs)));
  const previous = normalizeMaterialRemainders(carry);
  const nextRemainders: MaterialRemainders = { basic: 0, epic: 0 };
  const stacks: Array<{ materialId: string; quantity: number }> = [];
  for (const [rarity, cap] of [["basic", policy.materialCaps.basic], ["epic", policy.materialCaps.epic]] as const) {
    const units = elapsed * cap + previous[rarity];
    const quantity = Math.floor(units / AFK_MATERIAL_PERIOD_MS);
    nextRemainders[rarity] = units % AFK_MATERIAL_PERIOD_MS;
    if (quantity > 0) stacks.push({ materialId: rarityMaterialId(rarity), quantity });
  }
  return { stacks, nextRemainders, total: stacks.reduce((sum, stack) => sum + stack.quantity, 0) };
}