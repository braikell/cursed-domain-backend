import { readFileSync } from "node:fs";
import {
  convertLegacyThresholdWithAnchors,
  type PmThresholdAnchor,
} from "./pm-threshold-calibration.js";
import { PM_V2_RUNTIME_POLICY } from "./pm-runtime-policy.js";

interface PmV2ThresholdContract {
  schemaVersion: number;
  contractId: string;
  status: string;
  runtimeEnabled: boolean;
  authoritativeVersion: string;
  teamSize: number;
  anchors: PmThresholdAnchor[];
  conversionVectors: Array<{ legacyPm: number; v2Pm: number }>;
  rules: { monotonic: boolean; rollbackVersion: string };
}

const THRESHOLD_PATH = new URL("../../../../data/card_power_rating_v2.thresholds.json", import.meta.url);

function loadThresholdContract(): Readonly<PmV2ThresholdContract> {
  const contract = JSON.parse(readFileSync(THRESHOLD_PATH, "utf8")) as PmV2ThresholdContract;
  if (
    contract.schemaVersion !== 1
    || contract.contractId !== PM_V2_RUNTIME_POLICY.contractId
    || contract.status !== "certified"
    || contract.runtimeEnabled !== true
    || contract.authoritativeVersion !== "v2"
    || contract.teamSize !== 3
    || contract.rules?.monotonic !== true
    || contract.rules?.rollbackVersion !== "legacy"
  ) {
    throw new Error("Unsupported PM V2 threshold contract");
  }
  if (!Array.isArray(contract.anchors) || contract.anchors.length < 2) {
    throw new Error("PM V2 threshold contract requires at least two anchors");
  }
  for (let index = 0; index < contract.anchors.length; index += 1) {
    const anchor = contract.anchors[index];
    if (
      !Number.isFinite(anchor.legacyPm)
      || !Number.isFinite(anchor.v2Pm)
      || anchor.legacyPm <= 0
      || anchor.v2Pm <= 0
      || (index > 0 && (
        anchor.legacyPm <= contract.anchors[index - 1].legacyPm
        || anchor.v2Pm <= contract.anchors[index - 1].v2Pm
      ))
    ) {
      throw new Error("PM V2 threshold anchors must be finite, positive and strictly increasing");
    }
  }
  return Object.freeze(contract);
}

export const PM_V2_THRESHOLD_CONTRACT = loadThresholdContract();

export function convertLegacyThresholdToV2(legacyPm: number): number {
  return convertLegacyThresholdWithAnchors(legacyPm, PM_V2_THRESHOLD_CONTRACT.anchors);
}

export function describeRuntimeThreshold(legacyPm: number) {
  const normalizedLegacy = Math.max(1, Math.round(legacyPm));
  const v2Pm = convertLegacyThresholdToV2(normalizedLegacy);
  const authoritativeVersion = PM_V2_RUNTIME_POLICY.mode === "v2" ? "v2" : "legacy";
  return {
    pm: authoritativeVersion === "v2" ? v2Pm : normalizedLegacy,
    pmLegacy: normalizedLegacy,
    pmV2: v2Pm,
    pmVersion: authoritativeVersion,
    pmRuntimeMode: PM_V2_RUNTIME_POLICY.mode,
  } as const;
}
