export type BackendModuleName =
  | "bootstrap"
  | "summons"
  | "pity_status"
  | "afk_status"
  | "afk_claim"
  | "missions_status"
  | "mission_claim"
  | "chests_status"
  | "chest_claim"
  | "claim_all_missions"
  | "mission_tokens"
  | "redeem_pack_token"
  | "redeem_choice_token"
  | "ultimate_used"
  | "grant_choice_card"
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
  | "social_remove_friend";

export interface ErrorEnvelope {
  ok: false;
  code: string;
  message: string;
  details?: unknown;
  request_id?: string;
  module: BackendModuleName;
}

export interface GodotAuthedRequestContext {
  accessToken: string;
  userId: string;
  requestId?: string;
}

export interface AuthUserProfile {
  id: string;
  email: string | null;
  user_metadata?: Record<string, unknown> | null;
}

export interface BootstrapResponse {
  ok: true;
  userId: string;
  save: unknown;
  snapshot: unknown;
  updatedAt?: string;
  saveVersion?: number;
}

export interface PurchasePackInput {
  packId: "basicPack" | "epicPack" | "legendaryPack" | "mythicPack";
  purchaseCurrency: "gold" | "gems" | "free_token";
  count: 1 | 10;
  requestId: string;
}

export interface ClaimAfkInput {
  requestId: string;
}

export interface ClaimMissionInput {
  requestId: string;
  missionId: string;
  scope?: "daily" | "weekly" | "season";
}

export interface ClaimChestInput {
  requestId: string;
  chestId: string;
  scope?: "daily" | "weekly" | "season";
}

export interface ClaimAllMissionsInput {
  requestId: string;
  scope?: "daily" | "weekly" | "season";
}

export interface StartBattleInput {
  stageId: string;
  requestId: string;
  teamSlots: Array<{
    userCardId: string;
    boardSlot: number;
  }>;
}

export interface CompleteBattleInput {
  stageId: string;
  result: "win";
  requestId: string;
  battleSessionId: string;
  durationSeconds?: number;
}

export interface CompleteTowerFloorInput {
  floorNumber: number;
  result: "win";
  requestId: string;
}

export interface EquipItemInput {
  itemId: string;
  requestId: string;
  targetCharacterId?: string;
}

export interface UnequipItemInput {
  requestId: string;
  itemId?: string;
  targetCharacterId?: string;
  slot?: string;
  clearAll?: boolean;
}

export interface UpgradeCardInput {
  userCardId: string;
  requestId: string;
  levels?: number;
  mode?: "single" | "max_affordable";
}

export interface AscendCardInput {
  userCardId: string;
  requestId: string;
}

export interface UpgradeItemInput {
  itemId: string;
  requestId: string;
}

export interface DismantleItemInput {
  itemId: string;
  requestId: string;
}

export interface PvpUpsertDefenseInput {
  requestId: string;
  defensePower: number;
  defenseSnapshot: unknown;
}

export interface PvpStartMatchInput {
  requestId: string;
  defenderUserId: string;
}

export interface PvpCompleteMatchInput {
  requestId: string;
  matchId: string;
  result: "win" | "loss";
  attackerPower: number;
  defenderPower: number;
}

export interface SocialSearchInput {
  query: string;
}

export interface SocialSendRequestInput {
  requestId: string;
  targetUserId?: string;
  targetQuery?: string;
}

export interface SocialRespondRequestInput {
  requestId: string;
  requestIdToRespond: string;
  action: "accept" | "decline" | "cancel";
}

export interface SocialRemoveFriendInput {
  requestId: string;
  friendUserId: string;
}
