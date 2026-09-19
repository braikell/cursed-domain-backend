import { describe, expect, it } from "vitest";
import { createInitialGameSave } from "../bootstrap/game-save.js";
import { applyEquipmentV2Cutover, EQUIPMENT_V2_CUTOVER_VERSION } from "./v2-cutover.js";

describe("equipment V2 cutover", () => {
  it("wipes legacy equipment once without touching progression or canonical materials", () => {
    const save = createInitialGameSave(1234);
    save.gold = 777;
    save.gems = 88;
    save.xp = 99;
    save.inventory = [{
      id: "legacy-item",
      slot: "weapon",
      rarity: "basic",
      name: "Legacy",
      equipmentKey: "removed_v1_item",
      tier: 3,
      equippedToCharacterId: "yuji",
      ad: 12,
      ap: 0,
      hp: 0,
    }];
    save.characters.yuji!.equipment.weapon = save.inventory[0]!;
    save.fragments = {
      "gear_mats:weapon": 50,
      "item_materials:weapon": 7,
      "fragment:yuji": 3,
    };
    save.equipmentV2Rewards.campaignMythicDryItems = 19;

    expect(applyEquipmentV2Cutover(save, true)).toBe(true);
    expect(save.inventory).toEqual([]);
    expect(save.characters.yuji!.equipment).toEqual({});
    expect(save.fragments).toEqual({ "item_materials:weapon": 7, "fragment:yuji": 3 });
    expect(save.gold).toBe(777);
    expect(save.gems).toBe(88);
    expect(save.xp).toBe(99);
    expect(save.equipmentV2Rewards.campaignMythicDryItems).toBe(0);
    expect(save.equipmentV2CutoverVersion).toBe(EQUIPMENT_V2_CUTOVER_VERSION);

    save.inventory.push({
      id: "new-v2-item",
      slot: "weapon",
      rarity: "basic",
      name: "Filo de la Ruptura",
      equipmentKey: "weapon_filo_de_la_ruptura",
      adaptivePower: 19,
      tier: 1,
      equippedToCharacterId: null,
      ad: 0,
      ap: 0,
      hp: 0,
    });
    expect(applyEquipmentV2Cutover(save, true)).toBe(false);
    expect(save.inventory).toHaveLength(1);
  });

  it("does nothing while the activation gate is off", () => {
    const save = createInitialGameSave();
    save.fragments["gear_mats:helmet"] = 4;
    expect(applyEquipmentV2Cutover(save, false)).toBe(false);
    expect(save.fragments["gear_mats:helmet"]).toBe(4);
    expect(save.equipmentV2CutoverVersion).toBe(0);
  });
});
