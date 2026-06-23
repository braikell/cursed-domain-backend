export type BackendModuleName =
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
  | "equipment_dismantle";

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

export interface EquipItemInput {
  itemId: string;
  requestId: string;
  targetCharacterId?: string;
}

export interface UpgradeItemInput {
  itemId: string;
  requestId: string;
}

export interface DismantleItemInput {
  itemId: string;
  requestId: string;
}
