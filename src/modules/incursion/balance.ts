export const INCURSION_MAX_WAVES = 10;
export const INCURSION_SESSION_TTL_SECONDS = 900;
export const INCURSION_WAVE_DURATION_SECONDS = 30;

export const INCURSION_ENTRY_COSTS = {
  gold: 60000,
  gems: 750,
} as const;

export interface IncursionReward {
  gold: number;
  gems: number;
  xp: number;
}

// Recompensa acumulativa por oleada. No contiene tokens no persistidos.
export const INCURSION_WAVE_REWARDS: readonly IncursionReward[] = [
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

export function calculateIncursionRewards(waveReached: number): IncursionReward {
  const waveCount = Math.max(0, Math.min(Math.floor(waveReached), INCURSION_MAX_WAVES));
  return INCURSION_WAVE_REWARDS.slice(0, waveCount).reduce(
    (total, reward) => ({
      gold: total.gold + reward.gold,
      gems: total.gems + reward.gems,
      xp: total.xp + reward.xp,
    }),
    { gold: 0, gems: 0, xp: 0 },
  );
}
