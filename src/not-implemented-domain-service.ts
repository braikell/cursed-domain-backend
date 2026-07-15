import type {
  AscendCardInput,
  BootstrapResponse,
  ClaimAfkInput,
  ClaimMissionInput,
  CompleteBattleInput,
  CompleteTowerFloorInput,
  DismantleItemInput,
  EquipItemInput,
  GodotAuthedRequestContext,
  PvpCompleteMatchInput,
  PvpStartMatchInput,
  PvpUpsertDefenseInput,
  SocialRemoveFriendInput,
  SocialRespondRequestInput,
  SocialSearchInput,
  SocialSendRequestInput,
  PurchasePackInput,
  StartBattleInput,
  UnequipItemInput,
  UpgradeCardInput,
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
    | "battle_start"
    | "battle_resolve"
    | "cards_upgrade"
    | "cards_ascend"
    | "equipment_status"
    | "equipment_equip"
    | "equipment_unequip"
    | "equipment_upgrade"
    | "equipment_dismantle"
    | "tower_status"
    | "tower_complete_floor"
    | "pvp_status"
    | "pvp_upsert_defense"
    | "pvp_start_match"
    | "pvp_complete_match"
    | "social_status"
    | "social_search"
    | "social_send_request"
    | "social_respond_request"
    | "social_remove_friend",
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

  async startBattle(_context: GodotAuthedRequestContext, _input: StartBattleInput): Promise<unknown> {
    return notImplemented("battle_start", "Battle start extraction not implemented yet.");
  }

  async completeBattle(_context: GodotAuthedRequestContext, _input: CompleteBattleInput): Promise<unknown> {
    return notImplemented("battle_resolve", "Battle resolve extraction not implemented yet.");
  }

  async getTowerStatus(_context: GodotAuthedRequestContext): Promise<unknown> {
    return notImplemented("tower_status", "Tower status extraction not implemented yet.");
  }

  async completeTowerFloor(_context: GodotAuthedRequestContext, _input: CompleteTowerFloorInput): Promise<unknown> {
    return notImplemented("tower_complete_floor", "Tower floor completion extraction not implemented yet.");
  }

  async getPvpStatus(_context: GodotAuthedRequestContext): Promise<unknown> {
    return notImplemented("pvp_status", "PvP status extraction not implemented yet.");
  }

  async upsertPvpDefense(_context: GodotAuthedRequestContext, _input: PvpUpsertDefenseInput): Promise<unknown> {
    return notImplemented("pvp_upsert_defense", "PvP defense extraction not implemented yet.");
  }

  async startPvpMatch(_context: GodotAuthedRequestContext, _input: PvpStartMatchInput): Promise<unknown> {
    return notImplemented("pvp_start_match", "PvP match start extraction not implemented yet.");
  }

  async completePvpMatch(_context: GodotAuthedRequestContext, _input: PvpCompleteMatchInput): Promise<unknown> {
    return notImplemented("pvp_complete_match", "PvP match completion extraction not implemented yet.");
  }

  async getSocialStatus(_context: GodotAuthedRequestContext): Promise<unknown> {
    return notImplemented("social_status", "Social status extraction not implemented yet.");
  }

  async searchSocialPlayers(_context: GodotAuthedRequestContext, _input: SocialSearchInput): Promise<unknown> {
    return notImplemented("social_search", "Social search extraction not implemented yet.");
  }

  async sendFriendRequest(_context: GodotAuthedRequestContext, _input: SocialSendRequestInput): Promise<unknown> {
    return notImplemented("social_send_request", "Friend request extraction not implemented yet.");
  }

  async respondFriendRequest(_context: GodotAuthedRequestContext, _input: SocialRespondRequestInput): Promise<unknown> {
    return notImplemented("social_respond_request", "Friend response extraction not implemented yet.");
  }

  async removeFriend(_context: GodotAuthedRequestContext, _input: SocialRemoveFriendInput): Promise<unknown> {
    return notImplemented("social_remove_friend", "Friend removal extraction not implemented yet.");
  }

  async upgradeCard(_context: GodotAuthedRequestContext, _input: UpgradeCardInput): Promise<unknown> {
    return notImplemented("cards_upgrade", "Card upgrade extraction not implemented yet.");
  }

  async ascendCard(_context: GodotAuthedRequestContext, _input: AscendCardInput): Promise<unknown> {
    return notImplemented("cards_ascend", "Card ascension extraction not implemented yet.");
  }

  async getEquipment(_context: GodotAuthedRequestContext): Promise<unknown> {
    return notImplemented("equipment_status", "Equipment snapshot extraction not implemented yet.");
  }

  async equipItem(_context: GodotAuthedRequestContext, _input: EquipItemInput): Promise<unknown> {
    return notImplemented("equipment_equip", "Equip item extraction not implemented yet.");
  }

  async unequipItem(_context: GodotAuthedRequestContext, _input: UnequipItemInput): Promise<unknown> {
    return notImplemented("equipment_unequip", "Unequip item extraction not implemented yet.");
  }

  async upgradeItem(_context: GodotAuthedRequestContext, _input: UpgradeItemInput): Promise<unknown> {
    return notImplemented("equipment_upgrade", "Upgrade item extraction not implemented yet.");
  }

  async dismantleItem(_context: GodotAuthedRequestContext, _input: DismantleItemInput): Promise<unknown> {
    return notImplemented("equipment_dismantle", "Dismantle item extraction not implemented yet.");
  }
}
