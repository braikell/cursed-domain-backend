import {
  CARD_BALANCE_DEFINITIONS,
  calculateCardFinalStats,
} from "../balance.js";

export interface PmThresholdAnchor {
  level: number;
  ascension: number;
  legacyPm: number;
  v2Pm: number;
  medianRatio: number;
  p10Ratio: number;
  p90Ratio: number;
  formationSamples: number;
}

export function convertLegacyThresholdWithAnchors(
  legacyPm: number,
  anchors: ReadonlyArray<Pick<PmThresholdAnchor, "legacyPm" | "v2Pm" | "medianRatio">>,
): number {
  const value = Math.max(1, Math.round(legacyPm));
  if (anchors.length === 0) throw new Error("PM V2 threshold anchors are empty");
  const first = anchors[0];
  const last = anchors[anchors.length - 1];
  if (value <= first.legacyPm) return Math.max(1, Math.round(value * first.v2Pm / first.legacyPm));
  if (value >= last.legacyPm) return Math.max(1, Math.round(value * last.v2Pm / last.legacyPm));
  for (let index = 1; index < anchors.length; index += 1) {
    const upper = anchors[index];
    const lower = anchors[index - 1];
    if (value > upper.legacyPm) continue;
    const progress = (value - lower.legacyPm) / (upper.legacyPm - lower.legacyPm);
    return Math.max(1, Math.round(lower.v2Pm + (upper.v2Pm - lower.v2Pm) * progress));
  }
  throw new Error("Unable to interpolate PM V2 threshold");
}

const CHECKPOINTS = [
  { level: 1, ascension: 0 },
  { level: 20, ascension: 0 },
  { level: 40, ascension: 1 },
  { level: 60, ascension: 2 },
  { level: 80, ascension: 3 },
] as const;

function percentile(sorted: number[], fraction: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * fraction)));
  return sorted[index];
}

function round(value: number, decimals = 4): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

export function buildPmV2ThresholdCalibration() {
  const anchors: PmThresholdAnchor[] = CHECKPOINTS.map((checkpoint) => {
    const cards = CARD_BALANCE_DEFINITIONS.map((definition) => ({
      characterKey: definition.characterKey,
      stats: calculateCardFinalStats(definition, checkpoint.level, checkpoint.ascension),
    }));
    const legacyTotals: number[] = [];
    const v2Totals: number[] = [];
    const ratios: number[] = [];
    for (let first = 0; first < cards.length - 2; first += 1) {
      for (let second = first + 1; second < cards.length - 1; second += 1) {
        if (cards[first].characterKey === cards[second].characterKey) continue;
        for (let third = second + 1; third < cards.length; third += 1) {
          if (
            cards[first].characterKey === cards[third].characterKey
            || cards[second].characterKey === cards[third].characterKey
          ) continue;
          const legacy = cards[first].stats.pm_legacy + cards[second].stats.pm_legacy + cards[third].stats.pm_legacy;
          const v2 = cards[first].stats.pm_v2 + cards[second].stats.pm_v2 + cards[third].stats.pm_v2;
          legacyTotals.push(legacy);
          v2Totals.push(v2);
          ratios.push(v2 / legacy);
        }
      }
    }
    legacyTotals.sort((a, b) => a - b);
    v2Totals.sort((a, b) => a - b);
    ratios.sort((a, b) => a - b);
    return {
      ...checkpoint,
      legacyPm: percentile(legacyTotals, 0.5),
      v2Pm: percentile(v2Totals, 0.5),
      medianRatio: round(percentile(ratios, 0.5)),
      p10Ratio: round(percentile(ratios, 0.1)),
      p90Ratio: round(percentile(ratios, 0.9)),
      formationSamples: ratios.length,
    };
  });

  const conversionVectors = [400, 500, 999, 2004, 2765, 3687, 7000, 12000].map((legacyPm) => ({
    legacyPm,
    v2Pm: convertLegacyThresholdWithAnchors(legacyPm, anchors),
  }));

  return {
    schemaVersion: 1,
    contractId: "card-pm-v2-statistical",
    status: "certified",
    runtimeEnabled: true,
    authoritativeVersion: "v2",
    teamSize: 3,
    method: "median-of-all-distinct-character-formations",
    equipment: "NONE",
    anchors,
    conversionVectors,
    domains: {
      campaign: { legacyMinimum: 400, legacyMaximum: 7000, mode: "v2" },
      tower: { legacyMinimum: 500, legacyMaximum: 12000, mode: "v2" },
      pvp: { strategy: "require-v2-defense-republish", mode: "v2" },
    },
    rules: {
      interpolation: "linear-between-anchors",
      belowFirstAnchor: "first-anchor-ratio",
      aboveLastAnchor: "last-anchor-ratio",
      monotonic: true,
      unknownVersionIsError: true,
      rollbackVersion: "legacy",
    },
  } as const;
}
