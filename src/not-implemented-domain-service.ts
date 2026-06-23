import type {
  BootstrapResponse,
  ClaimAfkInput,
  ClaimMissionInput,
  CompleteBattleInput,
  DismantleItemInput,
  EquipItemInput,
  GodotAuthedRequestContext,
  PurchasePackInput,
  UpgradeItemInput,
} from "./contracts.js";
import type { GodotDomainService } from "./domain-service.js";
import { HttpModuleError } from "./errors.js";

function notImplemented(
  module:
    | "bootstrap"
    | "summons"
    | "afk_status"
    | "afk_claim"
    | "missions_status"
    | "mission_claim"
    | "battle_resolve"
    | "equipment_status"
    | "equipment_equip"
    | "equipment_upgrade"
    | "equipment_dismantle",
  message: string,
): never {
  throw new HttpModuleError(501, "not_implemented", module, message);
}

export class NotImplementedGodotDomainService implements GodotDomainService {
  async bootstrap(_context: GodotAuthedRequestContext): Promise<BootstrapResponse> {
    return notImplemented("bootstrap", "Bootstrap extraction not implemented yet.");
  }

  async purchasePack(_context: GodotAuthedRequestContext, _input: PurchasePackInput): Promise<unknown> {
    return notImplemented("summons", "Summon extraction not implemented yet.");
  }

  async getAfkStatus(_context: GodotAuthedRequestContext): Promise<unknown> {
    return notImplemented("afk_status", "AFK status extraction not implemented yet.");
  }

  async claimAfk(_context: GodotAuthedRequestContext, _input: ClaimAfkInput): Promise<unknown> {
    return notImplemented("afk_claim", "AFK claim extraction not implemented yet.");
  }

  async getMissions(_context: GodotAuthedRequestContext): Promise<unknown> {
    return notImplemented("missions_status", "Mission snapshot extraction not implemented yet.");
  }

  async claimMission(_context: GodotAuthedRequestContext, _input: ClaimMissionInput): Promise<unknown> {
    return notImplemented("mission_claim", "Mission claim extraction not implemented yet.");
  }

  async completeBattle(_context: GodotAuthedRequestContext, _input: CompleteBattleInput): Promise<unknown> {
    return notImplemented("battle_resolve", "Battle resolve extraction not implemented yet.");
  }

  async getEquipment(_context: GodotAuthedRequestContext): Promise<unknown> {
    return notImplemented("equipment_status", "Equipment snapshot extraction not implemented yet.");
  }

  async equipItem(_context: GodotAuthedRequestContext, _input: EquipItemInput): Promise<unknown> {
    return notImplemented("equipment_equip", "Equip item extraction not implemented yet.");
  }

  async upgradeItem(_context: GodotAuthedRequestContext, _input: UpgradeItemInput): Promise<unknown> {
    return notImplemented("equipment_upgrade", "Upgrade item extraction not implemented yet.");
  }

  async dismantleItem(_context: GodotAuthedRequestContext, _input: DismantleItemInput): Promise<unknown> {
    return notImplemented("equipment_dismantle", "Dismantle item extraction not implemented yet.");
  }
}
