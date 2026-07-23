import type { CompleteIncursionInput, GodotAuthedRequestContext } from "../../contracts.js";
import { HttpModuleError } from "../../errors.js";
import { logger } from "../../safe-logger.js";
import { createServiceSupabaseClient } from "../../supabase.js";
import {
  beginIdempotentOperation,
  completeIdempotentOperation,
} from "../battle/battle.js";
import {
  grantPlayerXpReward,
  type PlayerProgressionRewardResult,
} from "../progression/player-progression.js";

const WAVE_REWARDS = [
  { gold: 5000, gems: 30, xp: 35 },
  { gold: 15000, gems: 70, xp: 75 },
  { gold: 35000, gems: 150, xp: 102 },
  { gold: 65000, gems: 300, xp: 140 },
  { gold: 75000, gems: 350, xp: 200 },
  { gold: 95000, gems: 400, xp: 280 },
  { gold: 125000, gems: 520, xp: 350 },
  { gold: 185000, gems: 600, xp: 430 },
  { gold: 275000, gems: 780, xp: 580 },
  { gold: 455000, gems: 1800, xp: 1080 },
];

const MAX_POSSIBLE_KILLS_PER_WAVE = 56;

function calculateRewards(waveReached: number): { gold: number; gems: number; xp: number } {
  let gold = 0;
  let gems = 0;
  let xp = 0;
  const waves = Math.min(waveReached, WAVE_REWARDS.length);
  for (let i = 0; i < waves; i++) {
    gold += WAVE_REWARDS[i].gold;
    gems += WAVE_REWARDS[i].gems;
    xp += WAVE_REWARDS[i].xp;
  }
  return { gold, gems, xp };
}

function validateInput(waveReached: number, kills: number): void {
  if (waveReached < 0 || waveReached > 10) {
    throw new HttpModuleError(400, "invalid_wave", "incursion_complete", "Invalid wave number.");
  }
  if (kills < 0) {
    throw new HttpModuleError(400, "invalid_kills", "incursion_complete", "Invalid kill count.");
  }
  const maxKills = (waveReached + 1) * MAX_POSSIBLE_KILLS_PER_WAVE;
  if (kills > maxKills) {
    logger.warn("suspicious_kill_count", { waveReached, kills, maxKills });
  }
}

export async function completeIncursionDedicated(
  context: GodotAuthedRequestContext,
  input: CompleteIncursionInput,
): Promise<unknown> {
  const supabase = createServiceSupabaseClient();
  const userId = context.userId;
  const requestId = input.requestId;

  try {
    const idempotent = await beginIdempotentOperation(
      supabase,
      userId,
      `incursion_complete:${requestId}`,
      requestId,
    );
    if (idempotent.status === "replayed") {
      logger.info("incursion_idempotent_replay", { userId, requestId });
      return idempotent.response ?? { ok: true, replay: true };
    }

    const waveReached = Math.max(0, Math.min(input.waveReached, 10));
    const kills = Math.max(0, input.kills ?? 0);

    validateInput(waveReached, kills);

    const rewards = calculateRewards(waveReached);
    const gold = rewards.gold;
    const gems = rewards.gems;
    const xp = rewards.xp;

    if (gold === 0 && gems === 0 && xp === 0) {
      const empty = { ok: true, waveReached, kills, save: null };
      await completeIdempotentOperation(supabase, userId, requestId, empty);
      return empty;
    }

    const xpResult: PlayerProgressionRewardResult = await grantPlayerXpReward(supabase, {
      userId,
      source: "incursion",
      sourceId: `wave_${waveReached}`,
      requestId,
      xpAmount: xp,
      economyReward: { gold, gems },
    });

    const response = {
      ok: true,
      waveReached,
      kills,
      rewards: { gold, gems, xp },
      progression: {
        previousPlayerLevel: xpResult.levelBefore,
        currentPlayerLevel: xpResult.levelAfter,
        currentXp: xpResult.xpAfter,
        levelUpRewards: xpResult.levelUpRewards,
        gemsGranted: xpResult.gemsGranted,
      },
      save: xpResult.save,
    };

    await completeIdempotentOperation(supabase, userId, requestId, response);
    return response;
  } catch (error) {
    logger.error("incursion_complete_failed", {
      userId,
      requestId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw new HttpModuleError(500, "incursion_complete_failed", "incursion_complete", "Failed to complete incursion.");
  }
}
