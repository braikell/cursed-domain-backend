import { readFileSync } from "node:fs";

export type PmHeroIdentity = "OFFENSE" | "SURVIVAL" | "BALANCED";

export interface PmHeroTarget {
  characterKey: string;
  cardType: "BASE" | "DEFINITIVA";
  targetPm: number;
  identity: PmHeroIdentity;
  minimumEffectiveAttack?: number;
  maximumEffectiveAttack?: number;
}

interface PmHeroTargetContract {
  schemaVersion: number;
  sourceCardBalanceSchemaVersion: number;
  targetCardBalanceSchemaVersion: number;
  contractId: string;
  entries: PmHeroTarget[];
}

const TARGET_PATH = new URL("../../../../data/card_power_rating_v2.hero_targets.json", import.meta.url);

function loadTargets(): Readonly<PmHeroTargetContract> {
  const contract = JSON.parse(readFileSync(TARGET_PATH, "utf8")) as PmHeroTargetContract;
  if (
    contract.schemaVersion !== 1
    || contract.sourceCardBalanceSchemaVersion !== 6
    || contract.targetCardBalanceSchemaVersion !== 7
    || contract.contractId !== "card-pm-v2-statistical"
    || !Array.isArray(contract.entries)
    || contract.entries.length !== 37
  ) {
    throw new Error("Unsupported PM V2 hero-target contract");
  }
  const keys = new Set<string>();
  for (const entry of contract.entries) {
    const key = entry.characterKey + "::" + entry.cardType;
    if (
      keys.has(key)
      || !["BASE", "DEFINITIVA"].includes(entry.cardType)
      || !["OFFENSE", "SURVIVAL", "BALANCED"].includes(entry.identity)
      || !Number.isInteger(entry.targetPm)
      || entry.targetPm <= 0
      || (entry.minimumEffectiveAttack != null && (!Number.isFinite(entry.minimumEffectiveAttack) || entry.minimumEffectiveAttack < 0))
      || (entry.maximumEffectiveAttack != null && (!Number.isFinite(entry.maximumEffectiveAttack) || entry.maximumEffectiveAttack < 0))
      || (entry.minimumEffectiveAttack != null && entry.maximumEffectiveAttack != null
        && entry.minimumEffectiveAttack > entry.maximumEffectiveAttack)
    ) {
      throw new Error("Invalid PM V2 hero target: " + key);
    }
    keys.add(key);
  }
  return Object.freeze(contract);
}

export const PM_V2_HERO_TARGETS = loadTargets();
export const PM_V2_HERO_TARGET_BY_KEY = new Map(
  PM_V2_HERO_TARGETS.entries.map((entry) => [entry.characterKey + "::" + entry.cardType, entry] as const),
);
