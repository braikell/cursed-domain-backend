import { auditPmV2LevelOneCards } from "./pm-audit.js";

const report = auditPmV2LevelOneCards();

if (process.argv.includes("--json")) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log("| Carta | Tipo | Rareza | Rol | PM legacy | PM V2 | Ofensiva | Vida | Objetivo | Banda | Delta | Estado |");
  console.log("| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | --- | ---: | --- |");
  for (const row of report.rows) {
    console.log(`| ${row.characterKey} | ${row.cardType} | ${row.rarity} | ${row.role} | ${row.legacyPm} | ${row.v2Pm} | ${row.offensePm} | ${row.survivalPm} | ${row.targetPm} | ${row.minimumPm}-${row.maximumPm} | ${row.deltaFromTargetPm} | ${row.status} |`);
  }
  console.log(`\nTotal: ${report.summary.total}; BELOW: ${report.summary.below}; WITHIN: ${report.summary.within}; ABOVE: ${report.summary.above}.`);
}
