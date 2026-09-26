export const INCURSION_MAX_WAVES = 21;
export const INCURSION_SESSION_TTL_SECONDS = 1800;
export const INCURSION_WAVE_DURATION_SECONDS = 30;
export const INCURSION_BOSS_WAVES = [7, 14, 21] as const;
export const INCURSION_ACTIVE_ENEMY_CAPS = [
  8, 10, 12, 14, 16, 18, 20,
  22, 24, 28, 30, 32, 34, 36,
  38, 40, 42, 44, 48, 51, 54,
] as const;
export const INCURSION_WAVE_DURATIONS_SECONDS = [
  25, 25, 30, 30, 35, 35, 90,
  30, 30, 30, 35, 35, 35, 120,
  35, 35, 35, 40, 40, 40, 150,
] as const;

if (INCURSION_WAVE_DURATIONS_SECONDS.length !== INCURSION_MAX_WAVES) {
  throw new Error("Incursion wave contract is not aligned with max waves.");
}
if (INCURSION_ACTIVE_ENEMY_CAPS.length !== INCURSION_MAX_WAVES) {
  throw new Error("Incursion active-enemy cap contract is not aligned with max waves.");
}

export function getIncursionWaveDuration(wave: number): number {
  if (wave <= 0) return 0;
  const index = Math.max(0, Math.min(Math.floor(wave) - 1, INCURSION_WAVE_DURATIONS_SECONDS.length - 1));
  return INCURSION_WAVE_DURATIONS_SECONDS[index];
}

export function getIncursionDeclaredDurationThroughWave(wave: number): number {
  const waveCount = Math.max(0, Math.min(Math.floor(wave), INCURSION_MAX_WAVES));
  return INCURSION_WAVE_DURATIONS_SECONDS.slice(0, waveCount).reduce((total, duration) => total + duration, 0);
}

export const INCURSION_ENTRY_COSTS = {
  gold: 60000,
  gems: 750,
} as const;

export const INCURSION_DEFEAT_REWARD: IncursionReward = {
  gold: 5000,
  gems: 10,
  xp: 0,
};

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
  // Provisional continuation; economy tuning belongs to the next phase.
  { gold: 500000, gems: 1900, xp: 1150 },
  { gold: 550000, gems: 2000, xp: 1220 },
  { gold: 605000, gems: 2100, xp: 1290 },
  { gold: 665000, gems: 2200, xp: 1360 },
  { gold: 732000, gems: 2310, xp: 1430 },
  { gold: 805000, gems: 2430, xp: 1500 },
  { gold: 886000, gems: 2550, xp: 1580 },
  { gold: 975000, gems: 2680, xp: 1660 },
  { gold: 1073000, gems: 2810, xp: 1740 },
  { gold: 1180000, gems: 2950, xp: 1830 },
  { gold: 1298000, gems: 3100, xp: 1920 },
];

export function calculateIncursionRewards(waveReached: number, resultType: "defeat" | "extraction" | "victory" | "abandoned" = "extraction"): IncursionReward {
  if (resultType === "abandoned") return { gold: 0, gems: 0, xp: 0 };
  if (resultType === "defeat") {
    return { ...INCURSION_DEFEAT_REWARD };
  }
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
