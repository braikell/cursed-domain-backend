import type { Context } from "hono";
import { Hono } from "hono";
import { z } from "zod";

import { requireAuthedGodotUser } from "./auth.js";
import type { BackendModuleName } from "./contracts.js";
import type { GodotDomainService } from "./domain-service.js";
import { buildErrorEnvelope, HttpModuleError } from "./errors.js";
import { resolveRequestId } from "./request-id.js";

const purchasePackInputSchema = z.object({
  packId: z.enum(["basicPack", "epicPack", "legendaryPack", "mythicPack"]),
  purchaseCurrency: z.enum(["gold", "gems"]),
  count: z.union([z.literal(1), z.literal(10)]),
  requestId: z.string().min(8).max(80),
});

const claimAfkInputSchema = z.object({
  requestId: z.string().min(8).max(80),
});

const claimMissionInputSchema = z.object({
  requestId: z.string().min(8).max(80),
  missionId: z.string().min(1).max(120),
});

const completeBattleInputSchema = z.object({
  stageId: z.string().min(1),
  result: z.literal("win"),
  requestId: z.string().min(8).max(80),
});

const completeTowerFloorInputSchema = z.object({
  floorNumber: z.number().int().positive().max(5000),
  result: z.literal("win"),
  requestId: z.string().min(8).max(80),
});

const upgradeCardInputSchema = z.object({
  userCardId: z.string().min(1).max(120),
  requestId: z.string().min(8).max(80),
});

const ascendCardInputSchema = z.object({
  userCardId: z.string().min(1).max(120),
  requestId: z.string().min(8).max(80),
});

const equipItemInputSchema = z.object({
  itemId: z.string().min(1).max(120),
  requestId: z.string().min(8).max(80),
  targetCharacterId: z.string().min(1).max(120).optional(),
});

const unequipItemInputSchema = z.object({
  requestId: z.string().min(8).max(80),
  itemId: z.string().min(1).max(120).optional(),
  targetCharacterId: z.string().min(1).max(120).optional(),
  slot: z.string().min(1).max(40).optional(),
  clearAll: z.boolean().optional(),
});

const upgradeItemInputSchema = z.object({
  itemId: z.string().min(1).max(120),
  requestId: z.string().min(8).max(80),
});

const dismantleItemInputSchema = z.object({
  itemId: z.string().min(1).max(120),
  requestId: z.string().min(8).max(80),
});

export function createApp(domainService: GodotDomainService) {
  const app = new Hono();

  app.get("/health", (context) =>
    context.json({
      ok: true,
      service: "godot-dedicated-backend",
    }),
  );

  app.post("/api/godot/bootstrap", async (context) =>
    withModule(context, "bootstrap", async () => {
      const authed = await requireAuthedGodotUser(context, "bootstrap");
      const response = await domainService.bootstrap(authed);
      return context.json(response);
    }),
  );

  app.post("/api/godot/purchase-pack-v1", async (context) =>
    withModule(context, "summons", async () => {
      const authed = await requireAuthedGodotUser(context, "summons");
      const body = await context.req.json().catch(() => null);
      const parsed = purchasePackInputSchema.safeParse(body);
      if (!parsed.success) {
        throw new HttpModuleError(400, "invalid_request_payload", "summons", "Invalid request payload.");
      }
      const response = await domainService.purchasePack(authed, parsed.data);
      return context.json(response);
    }),
  );

  app.get("/api/godot/afk/status", async (context) =>
    withModule(context, "afk_status", async () => {
      const authed = await requireAuthedGodotUser(context, "afk_status");
      const response = await domainService.getAfkStatus(authed);
      return context.json(response);
    }),
  );

  app.post("/api/godot/claim-afk", async (context) =>
    withModule(context, "afk_claim", async () => {
      const authed = await requireAuthedGodotUser(context, "afk_claim");
      const body = await context.req.json().catch(() => null);
      const parsed = claimAfkInputSchema.safeParse(body);
      if (!parsed.success) {
        throw new HttpModuleError(400, "invalid_request_payload", "afk_claim", "Invalid request payload.");
      }
      const response = await domainService.claimAfk(authed, parsed.data);
      return context.json(response);
    }),
  );

  app.get("/api/godot/missions", async (context) =>
    withModule(context, "missions_status", async () => {
      const authed = await requireAuthedGodotUser(context, "missions_status");
      const response = await domainService.getMissions(authed);
      return context.json(response);
    }),
  );

  app.post("/api/godot/claim-mission", async (context) =>
    withModule(context, "mission_claim", async () => {
      const authed = await requireAuthedGodotUser(context, "mission_claim");
      const body = await context.req.json().catch(() => null);
      const parsed = claimMissionInputSchema.safeParse(body);
      if (!parsed.success) {
        throw new HttpModuleError(400, "invalid_request_payload", "mission_claim", "Invalid request payload.");
      }
      const response = await domainService.claimMission(authed, parsed.data);
      return context.json(response);
    }),
  );

  app.post("/api/godot/complete-battle", async (context) =>
    withModule(context, "battle_resolve", async () => {
      const authed = await requireAuthedGodotUser(context, "battle_resolve");
      const body = await context.req.json().catch(() => null);
      const parsed = completeBattleInputSchema.safeParse(body);
      if (!parsed.success) {
        throw new HttpModuleError(400, "invalid_request_payload", "battle_resolve", "Invalid request payload.");
      }
      const response = await domainService.completeBattle(authed, parsed.data);
      return context.json(response);
    }),
  );

  app.get("/api/godot/tower/status", async (context) =>
    withModule(context, "tower_status", async () => {
      const authed = await requireAuthedGodotUser(context, "tower_status");
      const response = await domainService.getTowerStatus(authed);
      return context.json(response);
    }),
  );

  app.post("/api/godot/tower/complete-floor", async (context) =>
    withModule(context, "tower_complete_floor", async () => {
      const authed = await requireAuthedGodotUser(context, "tower_complete_floor");
      const body = await context.req.json().catch(() => null);
      const parsed = completeTowerFloorInputSchema.safeParse(body);
      if (!parsed.success) {
        throw new HttpModuleError(400, "invalid_request_payload", "tower_complete_floor", "Invalid request payload.");
      }
      const response = await domainService.completeTowerFloor(authed, parsed.data);
      return context.json(response);
    }),
  );

  app.post("/api/godot/cards/upgrade", async (context) =>
    withModule(context, "cards_upgrade", async () => {
      const authed = await requireAuthedGodotUser(context, "cards_upgrade");
      const body = await context.req.json().catch(() => null);
      const parsed = upgradeCardInputSchema.safeParse(body);
      if (!parsed.success) {
        throw new HttpModuleError(400, "invalid_request_payload", "cards_upgrade", "Invalid request payload.");
      }
      const response = await domainService.upgradeCard(authed, parsed.data);
      return context.json(response);
    }),
  );

  app.post("/api/godot/cards/ascend", async (context) =>
    withModule(context, "cards_ascend", async () => {
      const authed = await requireAuthedGodotUser(context, "cards_ascend");
      const body = await context.req.json().catch(() => null);
      const parsed = ascendCardInputSchema.safeParse(body);
      if (!parsed.success) {
        throw new HttpModuleError(400, "invalid_request_payload", "cards_ascend", "Invalid request payload.");
      }
      const response = await domainService.ascendCard(authed, parsed.data);
      return context.json(response);
    }),
  );

  app.get("/api/godot/equipment", async (context) =>
    withModule(context, "equipment_status", async () => {
      const authed = await requireAuthedGodotUser(context, "equipment_status");
      const response = await domainService.getEquipment(authed);
      return context.json(response);
    }),
  );

  app.post("/api/godot/equipment/equip", async (context) =>
    withModule(context, "equipment_equip", async () => {
      const authed = await requireAuthedGodotUser(context, "equipment_equip");
      const body = await context.req.json().catch(() => null);
      const parsed = equipItemInputSchema.safeParse(body);
      if (!parsed.success) {
        throw new HttpModuleError(400, "invalid_request_payload", "equipment_equip", "Invalid request payload.");
      }
      const response = await domainService.equipItem(authed, parsed.data);
      return context.json(response);
    }),
  );

  app.post("/api/godot/equipment/unequip", async (context) =>
    withModule(context, "equipment_unequip", async () => {
      const authed = await requireAuthedGodotUser(context, "equipment_unequip");
      const body = await context.req.json().catch(() => null);
      const parsed = unequipItemInputSchema.safeParse(body);
      if (!parsed.success) {
        throw new HttpModuleError(400, "invalid_request_payload", "equipment_unequip", "Invalid request payload.");
      }
      const response = await domainService.unequipItem(authed, parsed.data);
      return context.json(response);
    }),
  );

  app.post("/api/godot/equipment/upgrade", async (context) =>
    withModule(context, "equipment_upgrade", async () => {
      const authed = await requireAuthedGodotUser(context, "equipment_upgrade");
      const body = await context.req.json().catch(() => null);
      const parsed = upgradeItemInputSchema.safeParse(body);
      if (!parsed.success) {
        throw new HttpModuleError(400, "invalid_request_payload", "equipment_upgrade", "Invalid request payload.");
      }
      const response = await domainService.upgradeItem(authed, parsed.data);
      return context.json(response);
    }),
  );

  app.post("/api/godot/equipment/dismantle", async (context) =>
    withModule(context, "equipment_dismantle", async () => {
      const authed = await requireAuthedGodotUser(context, "equipment_dismantle");
      const body = await context.req.json().catch(() => null);
      const parsed = dismantleItemInputSchema.safeParse(body);
      if (!parsed.success) {
        throw new HttpModuleError(400, "invalid_request_payload", "equipment_dismantle", "Invalid request payload.");
      }
      const response = await domainService.dismantleItem(authed, parsed.data);
      return context.json(response);
    }),
  );

  return app;
}

async function withModule(
  context: Context,
  module: BackendModuleName,
  action: () => Promise<Response>,
) {
  const requestId = resolveRequestId(context);
  context.header("x-request-id", requestId);

  try {
    return await action();
  } catch (error) {
    const built = buildErrorEnvelope(error, module, requestId);
    return context.json(built.body, { status: built.status as 200 | 400 | 401 | 500 | 501 });
  }
}
