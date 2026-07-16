import type { BackendModuleName } from "./contracts.js";
import { HttpModuleError } from "./errors.js";

export interface RateLimitConfig {
  max: number;
  windowMs: number;
}

export interface RateLimitResult {
  limit: number;
  remaining: number;
  reset: number;
}

const RATE_LIMIT_CONFIGS: Partial<Record<BackendModuleName, RateLimitConfig>> = {
  summons: { max: 20, windowMs: 60_000 },
  battle_start: { max: 30, windowMs: 60_000 },
  battle_resolve: { max: 30, windowMs: 60_000 },
  pvp_start_match: { max: 20, windowMs: 60_000 },
  pvp_complete_match: { max: 20, windowMs: 60_000 },
  pvp_upsert_defense: { max: 20, windowMs: 60_000 },
  tower_complete_floor: { max: 20, windowMs: 60_000 },
};

interface RateLimitWindow {
  timestamps: number[];
}

const store = new Map<string, RateLimitWindow>();

function buildKey(userId: string, module: BackendModuleName): string {
  return `${userId}:${module}`;
}

function ensureWindow(key: string): RateLimitWindow {
  let win = store.get(key);
  if (!win) {
    win = { timestamps: [] };
    store.set(key, win);
  }
  return win;
}

function trimExpired(window: RateLimitWindow, now: number, windowMs: number): void {
  const cutoff = now - windowMs;
  let firstValid = 0;
  while (firstValid < window.timestamps.length && window.timestamps[firstValid] < cutoff) {
    firstValid++;
  }
  if (firstValid > 0) {
    window.timestamps.splice(0, firstValid);
  }
}

export function checkRateLimit(
  userId: string,
  module: BackendModuleName,
): RateLimitResult {
  const config = RATE_LIMIT_CONFIGS[module];
  if (!config) return { limit: Infinity, remaining: Infinity, reset: 0 };

  const now = Date.now();
  const key = buildKey(userId, module);
  const window = ensureWindow(key);

  trimExpired(window, now, config.windowMs);

  const remaining = config.max - window.timestamps.length;
  if (remaining <= 0) {
    const oldest = window.timestamps[0];
    const reset = oldest + config.windowMs;
    throw new HttpModuleError(
      429,
      "rate_limit_exceeded",
      module,
      `Rate limit exceeded. Try again in ${Math.ceil((reset - now) / 1000)}s.`,
      { limit: config.max, remaining: 0, reset },
    );
  }

  window.timestamps.push(now);
  const reset = now + config.windowMs;

  return { limit: config.max, remaining: remaining - 1, reset };
}

setInterval(() => {
  const now = Date.now();
  for (const [key, window] of store) {
    trimExpired(window, now, 60_000);
    if (window.timestamps.length === 0) {
      store.delete(key);
    }
  }
}, 60_000).unref();
