import { readFileSync } from "node:fs";

export interface EquipmentV2StatTotals {
  adaptivePower: number;
  hp: number;
}

interface EquipmentPmContract {
  schemaVersion: number;
  contractId: string;
  weightsPerThousand: EquipmentV2StatTotals;
}

const CONTRACT_PATH = new URL("../../../data/equipment_v2_pm.contract.json", import.meta.url);
let cachedContract: EquipmentPmContract | undefined;

function contract(): EquipmentPmContract {
  if (cachedContract != null) return cachedContract;
  const parsed = JSON.parse(readFileSync(CONTRACT_PATH, "utf8")) as EquipmentPmContract;
  const weights = parsed.weightsPerThousand;
  if (parsed.schemaVersion !== 1 || parsed.contractId !== "equipment-v2-universal-pm"
    || !Number.isSafeInteger(weights?.adaptivePower) || weights.adaptivePower <= 0
    || !Number.isSafeInteger(weights?.hp) || weights.hp <= 0) {
    throw new Error("Invalid equipment V2 PM contract");
  }
  cachedContract = parsed;
  return parsed;
}

export function calculateEquipmentV2PmBonus(totals: EquipmentV2StatTotals): number {
  if (!Number.isSafeInteger(totals.adaptivePower) || totals.adaptivePower < 0
    || !Number.isSafeInteger(totals.hp) || totals.hp < 0) {
    throw new RangeError("Equipment V2 stats must be non-negative safe integers");
  }
  const weights = contract().weightsPerThousand;
  const numerator = totals.adaptivePower * weights.adaptivePower + totals.hp * weights.hp;
  if (!Number.isSafeInteger(numerator)) throw new RangeError("Equipment V2 PM exceeds safe integer range");
  return Math.round(numerator / 1000);
}

export function calculateTotalPmWithEquipmentV2(cardPmWithoutEquipment: number, totals: EquipmentV2StatTotals): number {
  if (!Number.isSafeInteger(cardPmWithoutEquipment) || cardPmWithoutEquipment < 0) {
    throw new RangeError("Card PM without equipment must be a non-negative safe integer");
  }
  const total = cardPmWithoutEquipment + calculateEquipmentV2PmBonus(totals);
  if (!Number.isSafeInteger(total)) throw new RangeError("Total PM exceeds safe integer range");
  return total;
}
