import type { GameSaveSnapshot } from "../bootstrap/game-save.js";

export const EQUIPMENT_V2_CUTOVER_VERSION = 1;

export function applyEquipmentV2Cutover(save: GameSaveSnapshot, enabled = true): boolean {
  if (!enabled || save.equipmentV2CutoverVersion >= EQUIPMENT_V2_CUTOVER_VERSION) return false;

  save.inventory = [];
  for (const character of Object.values(save.characters)) character.equipment = {};
  for (const materialId of Object.keys(save.fragments)) {
    if (materialId.toLowerCase().startsWith("gear_mats:")) delete save.fragments[materialId];
  }
  save.equipmentV2Rewards = {
    campaignUtcDate: "",
    campaignReplayWinsToday: 0,
    campaignReplayItemsToday: 0,
    campaignMythicDryItems: 0,
    afkMaterialCursor: 0,
  };
  save.equipmentV2CutoverVersion = EQUIPMENT_V2_CUTOVER_VERSION;
  return true;
}
