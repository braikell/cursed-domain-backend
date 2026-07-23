import type { SupabaseClient } from "@supabase/supabase-js";

import type { CompleteIncursionInput, GodotAuthedRequestContext } from "../../contracts.js";
import { HttpModuleError } from "../../errors.js";
import { logger } from "../../safe-logger.js";
import {
  beginIdempotentOperation,
  completeIdempotentOperation,
} from "../battle/battle.js";
import {
  grantPlayerXpReward,
  type PlayerProgressionRewardResult,
} from "../progression/player-progression.js";

function createServiceSupabaseClient(): SupabaseClient {
  const { createClient } = require("@supabase/supabase-js");
  const { env } = require("../../env.js");
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
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
    if (idempotent !== "proceed") {
      logger.info("incursion_idempotent_replay", { userId, requestId, operation: idempotent });
      return idempotent;
    }

    const waveReached = Math.max(0, Math.min(input.waveReached, 10));
    const kills = Math.max(0, input.kills ?? 0);
    const gold = Math.max(0, input.rewards?.gold ?? 0);
    const gems = Math.max(0, input.rewards?.gems ?? 0);
    const xp = Math.max(0, input.rewards?.xp ?? 0);

    if (gold === 0 && gems === 0 && xp === 0) {
      const empty = { ok: true, waveReached, kills, save: null };
      await completeIdempotentOperation(supabase, userId, `incursion_complete:${requestId}`, requestId, empty);
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

    await completeIdempotentOperation(supabase, userId, `incursion_complete:${requestId}`, requestId, response);
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
