import { CARD_BALANCE_DEFINITIONS, calculateCardFinalStats } from "../balance.js";
import { calculateCardPmV2Preview } from "./pm-card-adapter.js";
import { PM_V2_CONTRACT, type PmV2Rarity, type PmV2Role } from "./pm-contract.js";
import type { PmV2BandStatus } from "./pm-rarity-bands.js";

export interface PmV2AuditRow {
  characterKey: string;
  cardType: string;
  rarity: PmV2Rarity;
  role: PmV2Role;
  legacyPm: number;
  v2Pm: number;
  attackPower: number;
  basicDps: number;
  offensePm: number;
  survivalPm: number;
  ultimatePm: 0;
  targetPm: number;
  minimumPm: number;
  maximumPm: number;
  deltaFromTargetPm: number;
  deltaPercent: number;
  distanceToBandPm: number;
  status: PmV2BandStatus;
}

export interface PmV2AuditBucket {
  total: number;
  below: number;
  within: number;
  above: number;
}

export interface PmV2AuditReport {
  contractId: string;
  contractSchemaVersion: number;
  runtimeEnabled: boolean;
  level: 1;
  ascension: 0;
  equipment: "NONE";
  totalCards: number;
  summary: PmV2AuditBucket;
  byRole: Record<string, PmV2AuditBucket>;
  byRarity: Record<string, PmV2AuditBucket>;
  rows: PmV2AuditRow[];
}

function createBucket(): PmV2AuditBucket {
  return { total: 0, below: 0, within: 0, above: 0 };
}

function addToBucket(bucket: PmV2AuditBucket, status: PmV2BandStatus): void {
  bucket.total += 1;
  bucket[status.toLowerCase() as "below" | "within" | "above"] += 1;
}

function round(value: number, decimals = 2): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

export function auditPmV2LevelOneCards(): PmV2AuditReport {
  const rows: PmV2AuditRow[] = CARD_BALANCE_DEFINITIONS.map((definition) => {
    const stats = calculateCardFinalStats(definition, 1, 0);
    const result = calculateCardPmV2Preview(definition, stats);
    if (!result.ok) {
      throw new Error(`${definition.characterKey} ${definition.cardType}: ${result.errors.join(", ")}`);
    }
    const evaluation = result.rarityEvaluation;
    return {
      characterKey: definition.characterKey,
      cardType: definition.cardType,
      rarity: definition.rarity,
      role: definition.role as PmV2Role,
      legacyPm: stats.pm_legacy,
      v2Pm: result.pm,
      attackPower: round(result.breakdown.attackPower),
      basicDps: round(result.breakdown.basicDps),
      offensePm: round(PM_V2_CONTRACT.constants.referencePm * result.breakdown.offenseContribution),
      survivalPm: round(PM_V2_CONTRACT.constants.referencePm * result.breakdown.survivalContribution),
      ultimatePm: 0,
      targetPm: evaluation.targetPm,
      minimumPm: evaluation.minimumPm,
      maximumPm: evaluation.maximumPm,
      deltaFromTargetPm: evaluation.deltaFromTargetPm,
      deltaPercent: round(evaluation.deltaPercent * 100),
      distanceToBandPm: evaluation.distanceToBandPm,
      status: evaluation.status,
    };
  });

  const summary = createBucket();
  const byRole: Record<string, PmV2AuditBucket> = {};
  const byRarity: Record<string, PmV2AuditBucket> = {};
  for (const row of rows) {
    byRole[row.role] ??= createBucket();
    byRarity[row.rarity] ??= createBucket();
    addToBucket(summary, row.status);
    addToBucket(byRole[row.role], row.status);
    addToBucket(byRarity[row.rarity], row.status);
  }

  return {
    contractId: PM_V2_CONTRACT.contractId,
    contractSchemaVersion: PM_V2_CONTRACT.schemaVersion,
    runtimeEnabled: PM_V2_CONTRACT.runtimeEnabled,
    level: 1,
    ascension: 0,
    equipment: "NONE",
    totalCards: rows.length,
    summary,
    byRole,
    byRarity,
    rows,
  };
}
