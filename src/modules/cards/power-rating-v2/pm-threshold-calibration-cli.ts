import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { buildPmV2ThresholdCalibration } from "./pm-threshold-calibration.js";

if (!process.argv.includes("--write")) {
  throw new Error("Threshold calibration requires --write");
}

const calibration = buildPmV2ThresholdCalibration();
const outputUrl = new URL("../../../../data/card_power_rating_v2.thresholds.json", import.meta.url);
writeFileSync(outputUrl, JSON.stringify(calibration, null, 2) + "\n", "utf8");
console.log(
  "Wrote " + calibration.anchors.length + " PM V2 threshold anchors to " + fileURLToPath(outputUrl),
);
