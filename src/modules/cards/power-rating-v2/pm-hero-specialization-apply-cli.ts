import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { planPmV2HeroTargets } from "./pm-hero-balance-planner.js";

const balancePath = new URL("../../../../data/card_balance.json", import.meta.url);
const rollbackPath = new URL("../../../../../../docs/qa/card_power_rating_v2_specialization_rollback.json", import.meta.url);
if (!process.argv.includes("--write")) throw new Error("Refusing to mutate balance without explicit --write");

const originalText = readFileSync(balancePath, "utf8");
const payload = JSON.parse(originalText) as {
  schemaVersion: number;
  definitions: Array<{ characterKey: string; cardType: string; stats: Record<string, number> }>;
};
if (payload.schemaVersion !== 7 || payload.definitions.length !== 37) {
  throw new Error("Specialization correction requires the complete schema-7 catalog");
}
const proposals = planPmV2HeroTargets();
const changed = proposals.filter((row) => JSON.stringify(row.before) !== JSON.stringify(row.proposed));
const allowed = new Set(["maki::BASE", "naoya::BASE"]);
if (changed.length !== 2 || changed.some((row) => !allowed.has(`${row.characterKey}::${row.cardType}`))) {
  throw new Error("Expected only the guarded Maki/Naoya specialization correction");
}
if (changed.some((row) => row.proposed.vel !== row.before.vel)) throw new Error("VEL must remain unchanged");

writeFileSync(rollbackPath, `${JSON.stringify({
  schemaVersion: 1,
  migration: "card-pm-v2-maki-naoya-specialization",
  sourceSha256: createHash("sha256").update(originalText).digest("hex"),
  runtimePmV2Enabled: false,
  ultimatesChanged: false,
  entries: changed,
}, null, 2)}\n`, "utf8");

const byKey = new Map(changed.map((row) => [`${row.characterKey}::${row.cardType}`, row]));
for (const definition of payload.definitions) {
  const row = byKey.get(`${definition.characterKey}::${definition.cardType}`);
  if (row == null) continue;
  definition.stats.ad = row.proposed.ad;
  definition.stats.ap = row.proposed.ap;
  definition.stats.hp = row.proposed.hp;
  definition.stats.pm = row.proposed.pm;
}
writeFileSync(balancePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
console.log("Applied guarded Maki/Naoya specialization correction without changing PM or VEL.");
