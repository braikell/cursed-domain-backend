export type EquipmentSlot = "weapon" | "helmet" | "armor" | "boots" | "accessory";
export type EquipmentRarity = "basic" | "epic" | "legendary" | "mythic";
export type EquipmentDatabaseRarity = "comun" | "raro" | "epico" | "legendario" | "mitico";

export function buildEquipmentMaterialId(slot: EquipmentSlot): string {
  return `item_materials:${slot}`;
}

export function normalizeEquipmentRarity(raw: unknown): EquipmentRarity {
  switch (String(raw ?? "").trim().toLowerCase()) {
    case "epic":
    case "epico":
    case "raro":
      return "epic";
    case "legendary":
    case "legendario":
      return "legendary";
    case "mythic":
    case "mitico":
      return "mythic";
    case "basic":
    case "basico":
    case "comun":
    default:
      return "basic";
  }
}

export function normalizeEquipmentRarityForDatabase(raw: unknown): EquipmentDatabaseRarity {
  switch (normalizeEquipmentRarity(raw)) {
    case "epic":
      return "epico";
    case "legendary":
      return "legendario";
    case "mythic":
      return "mitico";
    case "basic":
    default:
      return "comun";
  }
}

export function normalizeEquipmentSlotForDatabase(raw: unknown): string {
  switch (String(raw ?? "").trim().toLowerCase()) {
    case "weapon":
    case "arma":
      return "arma";
    case "helmet":
    case "casco":
      return "casco";
    case "armor":
    case "armadura":
      return "armadura";
    case "boots":
    case "botas":
      return "botas";
    case "accessory":
    case "accesorio":
      return "accesorio";
    default:
      return "arma";
  }
}
