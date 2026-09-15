import { planPmV2LevelOneBalance } from "./pm-balance-planner.js";

const proposals = planPmV2LevelOneBalance();
if (process.argv.includes("--json")) {
  console.log(JSON.stringify(proposals, null, 2));
} else {
  console.log("| Carta | Tipo | Estado | PM V2 | Meta | PM propuesto | Estado propuesto | Escala | Pasos <=8% | AD | AP | HP | PM legacy |");
  console.log("| --- | --- | --- | ---: | ---: | ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: |");
  for (const row of proposals) {
    console.log(`| ${row.characterKey} | ${row.cardType} | ${row.previousStatus} | ${row.previousV2Pm} | ${row.targetPm} | ${row.proposedV2Pm} | ${row.proposedStatus} | ${row.scale} | ${row.stagedIterations} | ${row.before.ad}->${row.proposed.ad} | ${row.before.ap}->${row.proposed.ap} | ${row.before.hp}->${row.proposed.hp} | ${row.before.pm}->${row.proposed.pm} |`);
  }
}
