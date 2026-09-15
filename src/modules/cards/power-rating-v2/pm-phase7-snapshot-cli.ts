import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { CARD_BALANCE_SCHEMA_VERSION } from "../balance.js";
import { auditPmV2LevelOneCards } from "./pm-audit.js";

if (!process.argv.includes("--write")) {
  throw new Error("Snapshot generation requires --write");
}
if (CARD_BALANCE_SCHEMA_VERSION !== 6) {
  throw new Error("Expected card balance schema 6, received " + CARD_BALANCE_SCHEMA_VERSION);
}

const report = auditPmV2LevelOneCards();
if (report.totalCards !== 37 || report.summary.within !== 37 || report.summary.below !== 0 || report.summary.above !== 0) {
  throw new Error("Phase-7 audit is not certified: " + JSON.stringify(report.summary));
}

const cards = Object.fromEntries(report.rows.map((row) => [
  row.characterKey + "::" + row.cardType,
  { pm: row.v2Pm, status: row.status },
]));
const snapshot = {
  schemaVersion: 1,
  contractId: report.contractId,
  cardBalanceSchemaVersion: CARD_BALANCE_SCHEMA_VERSION,
  level: report.level,
  ascension: report.ascension,
  equipment: report.equipment,
  cards,
};
const outputUrl = new URL("../../../../../../tools/card_power_rating_v2_phase7_snapshot.json", import.meta.url);
writeFileSync(outputUrl, JSON.stringify(snapshot, null, 2) + "\n", "utf8");
console.log("Wrote " + Object.keys(cards).length + "-card phase-7 snapshot to " + fileURLToPath(outputUrl));
