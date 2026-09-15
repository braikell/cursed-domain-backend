import { planPmV2HeroTargets } from "./pm-hero-balance-planner.js";

const proposals = planPmV2HeroTargets();
if (process.argv.includes("--json")) {
  console.log(JSON.stringify(proposals, null, 2));
} else {
  console.log("| Carta | Tipo | Identidad | PM actual | PM objetivo | AD | AP | HP | VEL |");
  console.log("| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |");
  for (const row of proposals) {
    console.log(
      "| " + row.characterKey
      + " | " + row.cardType
      + " | " + row.identity
      + " | " + row.currentPm
      + " | " + row.targetPm
      + " | " + row.before.ad + "->" + row.proposed.ad
      + " | " + row.before.ap + "->" + row.proposed.ap
      + " | " + row.before.hp + "->" + row.proposed.hp
      + " | " + row.before.vel
      + " |",
    );
  }
}
