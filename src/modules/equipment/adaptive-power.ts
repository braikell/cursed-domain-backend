import { readFileSync } from "node:fs";

export type AdaptiveScaling = "PHYSICAL" | "MAGICAL" | "HYBRID" | "SUPPORT";
export interface AdaptivePowerBonus { ad: number; ap: number }

interface AdaptivePowerContract {
  schemaVersion: number;
  contractId: string;
  status: string;
  conversion: Record<AdaptiveScaling, AdaptivePowerBonus>;
}

const CONTRACT_PATH = new URL("../../../data/equipment_v2_adaptive_power.contract.json", import.meta.url);
const SCALINGS: AdaptiveScaling[] = ["PHYSICAL", "MAGICAL", "HYBRID", "SUPPORT"];
let cachedContract: AdaptivePowerContract | undefined;

function getContract(): AdaptivePowerContract {
  if (cachedContract != null) return cachedContract;
  const parsed = JSON.parse(readFileSync(CONTRACT_PATH, "utf8")) as AdaptivePowerContract;
  if (parsed.schemaVersion !== 1 || parsed.contractId !== "equipment-v2-adaptive-power") {
    throw new Error("Unsupported equipment V2 adaptive power contract");
  }
  for (const scaling of SCALINGS) {
    const weights = parsed.conversion?.[scaling];
    if (weights == null || ![0, 1].includes(weights.ad) || ![0, 1].includes(weights.ap)) {
      throw new Error(`Invalid equipment V2 scaling: ${scaling}`);
    }
  }
  cachedContract = parsed;
  return parsed;
}

export function convertAdaptivePower(adaptivePower: number, canonicalScaling: string): AdaptivePowerBonus {
  if (!Number.isSafeInteger(adaptivePower) || adaptivePower < 0) {
    throw new RangeError("adaptivePower must be a non-negative safe integer");
  }
  const scaling = canonicalScaling.trim().toUpperCase();
  if (!SCALINGS.includes(scaling as AdaptiveScaling)) {
    throw new RangeError(`Unknown canonical card scaling: ${canonicalScaling}`);
  }
  const weights = getContract().conversion[scaling as AdaptiveScaling];
  return { ad: adaptivePower * weights.ad, ap: adaptivePower * weights.ap };
}
