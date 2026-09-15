import { readFileSync } from "node:fs";
import { PM_V2_CONTRACT } from "./pm-contract.js";

export type PmRuntimeMode = "legacy" | "shadow" | "v2";

export interface PmV2RuntimePolicy {
  schemaVersion: 1;
  contractId: string;
  mode: PmRuntimeMode;
  fallbackMode: "legacy";
  thresholdMigrationStatus: "pending" | "calibrated" | "certified";
  requireGodotParity: boolean;
  requireRollback: boolean;
}

const POLICY_PATH = new URL("../../../../data/card_power_rating_v2.rollout.json", import.meta.url);

export function validatePmV2RuntimePolicy(
  candidate: unknown,
  contractEnabled = Boolean(PM_V2_CONTRACT.runtimeEnabled),
): Readonly<PmV2RuntimePolicy> {
  if (candidate == null || typeof candidate !== "object" || Array.isArray(candidate)) {
    throw new Error("PM V2 rollout policy must be an object");
  }
  const policy = candidate as PmV2RuntimePolicy;
  if (policy.schemaVersion !== 1 || policy.contractId !== PM_V2_CONTRACT.contractId) {
    throw new Error("Unsupported PM V2 rollout policy");
  }
  if (!["legacy", "shadow", "v2"].includes(policy.mode)) {
    throw new Error("Unknown PM runtime mode: " + String(policy.mode));
  }
  if (policy.fallbackMode !== "legacy" || !["pending", "calibrated", "certified"].includes(policy.thresholdMigrationStatus)) {
    throw new Error("Invalid PM V2 rollback or threshold policy");
  }
  if (policy.mode === "v2" && (!contractEnabled || policy.thresholdMigrationStatus !== "certified")) {
    throw new Error("PM V2 cannot become authoritative before contract activation and threshold certification");
  }
  return Object.freeze(policy);
}

function loadPolicy(): Readonly<PmV2RuntimePolicy> {
  return validatePmV2RuntimePolicy(JSON.parse(readFileSync(POLICY_PATH, "utf8")));
}

export const PM_V2_RUNTIME_POLICY = loadPolicy();

export function selectRuntimePm(legacyPm: number, v2Pm: number): number {
  return PM_V2_RUNTIME_POLICY.mode === "v2" ? v2Pm : legacyPm;
}
