export type BackendModuleName =
  | "bootstrap"
  | "summons"
  | "afk_status"
  | "afk_claim"
  | "missions_status"
  | "mission_claim"
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
  | "pvp_complete_match";

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
  purchaseCurrency: "gold" | "gems";
  count: 1 | 10;
  requestId: string;
}

export interface ClaimAfkInput {
  requestId: string;
}

export interface ClaimMissionInput {
  requestId: string;
  missionId: string;
}

export interface CompleteBattleInput {
  stageId: string;
  result: "win";
  requestId: string;
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

export interface PvpCompleteMatchInput {
  requestId: string;
  defenderUserId: string;
  result: "win" | "loss";
  attackerPower: number;
  defenderPower: number;
}
