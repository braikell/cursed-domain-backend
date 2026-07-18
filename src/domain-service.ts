import type {
  AscendCardInput,
  BootstrapResponse,
  ClaimAfkInput,
  ClaimAllMissionsInput,
  ClaimChestInput,
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

export interface GodotDomainService {
  bootstrap(context: GodotAuthedRequestContext): Promise<BootstrapResponse>;
  purchasePack(context: GodotAuthedRequestContext, input: PurchasePackInput): Promise<unknown>;
  getPityStatus(context: GodotAuthedRequestContext): Promise<unknown>;
  getAfkStatus(context: GodotAuthedRequestContext): Promise<unknown>;
  claimAfk(context: GodotAuthedRequestContext, input: ClaimAfkInput): Promise<unknown>;
  getMissions(context: GodotAuthedRequestContext): Promise<unknown>;
  claimMission(context: GodotAuthedRequestContext, input: ClaimMissionInput): Promise<unknown>;
  getChests(context: GodotAuthedRequestContext, scope?: string): Promise<unknown>;
  claimChest(context: GodotAuthedRequestContext, input: ClaimChestInput): Promise<unknown>;
  claimAllMissions(context: GodotAuthedRequestContext, input: ClaimAllMissionsInput): Promise<unknown>;
  getMissionTokens(context: GodotAuthedRequestContext): Promise<unknown>;
  redeemPackToken(context: GodotAuthedRequestContext, input: { requestId: string; packId: string }): Promise<unknown>;
  redeemChoiceToken(context: GodotAuthedRequestContext, input: { requestId: string; tokenId: string; characterId: string; cardType: string }): Promise<unknown>;
  startBattle(context: GodotAuthedRequestContext, input: StartBattleInput): Promise<unknown>;
  completeBattle(context: GodotAuthedRequestContext, input: CompleteBattleInput): Promise<unknown>;
  getTowerStatus(context: GodotAuthedRequestContext): Promise<unknown>;
  completeTowerFloor(context: GodotAuthedRequestContext, input: CompleteTowerFloorInput): Promise<unknown>;
  getPvpStatus(context: GodotAuthedRequestContext): Promise<unknown>;
  upsertPvpDefense(context: GodotAuthedRequestContext, input: PvpUpsertDefenseInput): Promise<unknown>;
  startPvpMatch(context: GodotAuthedRequestContext, input: PvpStartMatchInput): Promise<unknown>;
  completePvpMatch(context: GodotAuthedRequestContext, input: PvpCompleteMatchInput): Promise<unknown>;
  getSocialStatus(context: GodotAuthedRequestContext): Promise<unknown>;
  searchSocialPlayers(context: GodotAuthedRequestContext, input: SocialSearchInput): Promise<unknown>;
  sendFriendRequest(context: GodotAuthedRequestContext, input: SocialSendRequestInput): Promise<unknown>;
  respondFriendRequest(context: GodotAuthedRequestContext, input: SocialRespondRequestInput): Promise<unknown>;
  removeFriend(context: GodotAuthedRequestContext, input: SocialRemoveFriendInput): Promise<unknown>;
  upgradeCard(context: GodotAuthedRequestContext, input: UpgradeCardInput): Promise<unknown>;
  ascendCard(context: GodotAuthedRequestContext, input: AscendCardInput): Promise<unknown>;
  getEquipment(context: GodotAuthedRequestContext): Promise<unknown>;
  equipItem(context: GodotAuthedRequestContext, input: EquipItemInput): Promise<unknown>;
  unequipItem(context: GodotAuthedRequestContext, input: UnequipItemInput): Promise<unknown>;
  upgradeItem(context: GodotAuthedRequestContext, input: UpgradeItemInput): Promise<unknown>;
  dismantleItem(context: GodotAuthedRequestContext, input: DismantleItemInput): Promise<unknown>;
  ultimateUsed(context: GodotAuthedRequestContext, input: { requestId: string; count?: number }): Promise<unknown>;
  grantChoiceCard(context: GodotAuthedRequestContext, input: { requestId: string; grantToken: string; characterId: string; cardType: string }): Promise<unknown>;
}
