import { serve } from "@hono/node-server";

import { createApp } from "./app.js";
import { env } from "./env.js";
import { NotImplementedGodotDomainService } from "./not-implemented-domain-service.js";
import { bootstrapPlayer } from "./modules/bootstrap/player-bootstrap.js";
import { purchasePackDedicated } from "./modules/summons/purchase-pack.js";
import { claimAfkDedicated, getAfkStatusDedicated } from "./modules/afk/afk.js";
import { claimMissionDedicated, getMissionsDedicated } from "./modules/missions/missions.js";
import { completeBattleDedicated } from "./modules/battle/battle.js";
import { ascendCardDedicated, upgradeCardDedicated } from "./modules/cards/service.js";
import {
  dismantleItemDedicated,
  equipItemDedicated,
  getEquipmentDedicated,
  upgradeItemDedicated,
} from "./modules/equipment/service.js";
import type {
  AscendCardInput,
  BootstrapResponse,
  ClaimAfkInput,
  ClaimMissionInput,
  CompleteBattleInput,
  DismantleItemInput,
  EquipItemInput,
  GodotAuthedRequestContext,
  PurchasePackInput,
  UpgradeCardInput,
  UpgradeItemInput,
} from "./contracts.js";

class BootstrapImplementedDomainService extends NotImplementedGodotDomainService {
  override async bootstrap(context: GodotAuthedRequestContext): Promise<BootstrapResponse> {
    return await bootstrapPlayer(context.accessToken, context.userId);
  }

  override async purchasePack(_context: GodotAuthedRequestContext, _input: PurchasePackInput): Promise<unknown> {
    return await purchasePackDedicated(_context, _input);
  }

  override async getAfkStatus(_context: GodotAuthedRequestContext): Promise<unknown> {
    return await getAfkStatusDedicated(_context);
  }

  override async claimAfk(_context: GodotAuthedRequestContext, _input: ClaimAfkInput): Promise<unknown> {
    return await claimAfkDedicated(_context, _input);
  }

  override async getMissions(_context: GodotAuthedRequestContext): Promise<unknown> {
    return await getMissionsDedicated(_context);
  }

  override async claimMission(_context: GodotAuthedRequestContext, _input: ClaimMissionInput): Promise<unknown> {
    return await claimMissionDedicated(_context, _input);
  }

  override async completeBattle(_context: GodotAuthedRequestContext, _input: CompleteBattleInput): Promise<unknown> {
    return await completeBattleDedicated(_context, _input);
  }

  override async upgradeCard(_context: GodotAuthedRequestContext, _input: UpgradeCardInput): Promise<unknown> {
    return await upgradeCardDedicated(_context, _input);
  }

  override async ascendCard(_context: GodotAuthedRequestContext, _input: AscendCardInput): Promise<unknown> {
    return await ascendCardDedicated(_context, _input);
  }

  override async getEquipment(_context: GodotAuthedRequestContext): Promise<unknown> {
    return await getEquipmentDedicated(_context);
  }

  override async equipItem(_context: GodotAuthedRequestContext, _input: EquipItemInput): Promise<unknown> {
    return await equipItemDedicated(_context, _input);
  }

  override async upgradeItem(_context: GodotAuthedRequestContext, _input: UpgradeItemInput): Promise<unknown> {
    return await upgradeItemDedicated(_context, _input);
  }

  override async dismantleItem(_context: GodotAuthedRequestContext, _input: DismantleItemInput): Promise<unknown> {
    return await dismantleItemDedicated(_context, _input);
  }
}

const app = createApp(new BootstrapImplementedDomainService());

serve(
  {
    fetch: app.fetch,
    port: env.PORT,
  },
  (info) => {
    console.log(`[godot-backend] listening on http://localhost:${info.port}`);
  },
);
