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
  PurchasePackInput,
  UnequipItemInput,
  UpgradeCardInput,
  UpgradeItemInput,
} from "./contracts.js";

export interface GodotDomainService {
  bootstrap(context: GodotAuthedRequestContext): Promise<BootstrapResponse>;
  purchasePack(context: GodotAuthedRequestContext, input: PurchasePackInput): Promise<unknown>;
  getAfkStatus(context: GodotAuthedRequestContext): Promise<unknown>;
  claimAfk(context: GodotAuthedRequestContext, input: ClaimAfkInput): Promise<unknown>;
  getMissions(context: GodotAuthedRequestContext): Promise<unknown>;
  claimMission(context: GodotAuthedRequestContext, input: ClaimMissionInput): Promise<unknown>;
  completeBattle(context: GodotAuthedRequestContext, input: CompleteBattleInput): Promise<unknown>;
  getTowerStatus(context: GodotAuthedRequestContext): Promise<unknown>;
  completeTowerFloor(context: GodotAuthedRequestContext, input: CompleteTowerFloorInput): Promise<unknown>;
  upgradeCard(context: GodotAuthedRequestContext, input: UpgradeCardInput): Promise<unknown>;
  ascendCard(context: GodotAuthedRequestContext, input: AscendCardInput): Promise<unknown>;
  getEquipment(context: GodotAuthedRequestContext): Promise<unknown>;
  equipItem(context: GodotAuthedRequestContext, input: EquipItemInput): Promise<unknown>;
  unequipItem(context: GodotAuthedRequestContext, input: UnequipItemInput): Promise<unknown>;
  upgradeItem(context: GodotAuthedRequestContext, input: UpgradeItemInput): Promise<unknown>;
  dismantleItem(context: GodotAuthedRequestContext, input: DismantleItemInput): Promise<unknown>;
}
