import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { PM_V2_RARITIES } from "./pm-contract.js";
import { planPmV2HeroTargets, type PmHeroBalanceProposal } from "./pm-hero-balance-planner.js";
import { PM_V2_HERO_TARGETS } from "./pm-hero-targets.js";

const balancePath = new URL("../../../../data/card_balance.json", import.meta.url);
const rollbackPath = new URL("../../../../../../docs/qa/card_power_rating_v2_hero_targets_rollback.json", import.meta.url);

if (!process.argv.includes("--write")) {
  throw new Error("Refusing to mutate balance without explicit --write");
}

const originalText = readFileSync(balancePath, "utf8");
const payload = JSON.parse(originalText) as {
  schemaVersion: number;
  definitions: Array<{
    characterKey: string;
    cardType: "BASE" | "DEFINITIVA";
    role: string;
    rarity: string;
    scaling: string;
    stats: Record<string, number>;
  }>;
};
const sourceVersion = PM_V2_HERO_TARGETS.sourceCardBalanceSchemaVersion;
const targetVersion = PM_V2_HERO_TARGETS.targetCardBalanceSchemaVersion;
if (payload.schemaVersion !== sourceVersion) {
  throw new Error(`Expected card balance schema ${sourceVersion}, got ${payload.schemaVersion}`);
}
if (!Array.isArray(payload.definitions) || payload.definitions.length !== 37) {
  throw new Error("Expected exactly 37 card definitions");
}

const proposals = planPmV2HeroTargets();
if (proposals.length !== 37 || proposals.some((row) => row.targetPm <= 0)) {
  throw new Error("Every canonical card must have a valid individual PM target");
}
const proposalByKey = new Map(proposals.map((row) => [`${row.characterKey}::${row.cardType}`, row]));

function effectiveAttack(row: PmHeroBalanceProposal, proposed: boolean): number {
  return proposed ? row.effectiveAttackAfter : row.effectiveAttackBefore;
}

for (const definition of payload.definitions) {
  const key = `${definition.characterKey}::${definition.cardType}`;
  const row = proposalByKey.get(key);
  if (row == null) throw new Error(`Missing proposal for ${key}`);
  if (definition.role !== row.role || definition.rarity !== row.rarity || definition.scaling !== row.scaling) {
    throw new Error(`Identity mismatch for ${key}`);
  }
  for (const stat of ["ad", "ap", "hp", "vel", "pm"] as const) {
    if (Number(definition.stats[stat]) !== row.before[stat]) {
      throw new Error(`Stale ${stat} for ${key}: expected ${row.before[stat]}, got ${definition.stats[stat]}`);
    }
  }
  if (row.proposed.vel !== row.before.vel) throw new Error(`VEL changed for ${key}`);
  if (row.scaling === "PHYSICAL" && row.proposed.ap !== row.before.ap) throw new Error(`AP changed for physical card ${key}`);
  if (row.scaling === "MAGICAL" && row.proposed.ad !== row.before.ad) throw new Error(`AD changed for magical card ${key}`);
  for (const stat of ["ad", "ap", "hp"] as const) {
    const delta = Math.abs(row.proposed[stat] - row.before[stat]) / Math.max(1, row.before[stat]);
    if (delta > 0.1) throw new Error(`${stat} changed by more than 10% for ${key}`);
  }
}

for (const cardType of ["BASE", "DEFINITIVA"] as const) {
  let previousMaximum = -Infinity;
  for (const rarity of PM_V2_RARITIES) {
    const values = proposals
      .filter((row) => row.cardType === cardType && row.rarity === rarity)
      .map((row) => row.targetPm);
    if (values.length === 0) continue;
    const minimum = Math.min(...values);
    const maximum = Math.max(...values);
    if (minimum <= previousMaximum) throw new Error(`Rarity ordering failed for ${cardType}/${rarity}`);
    previousMaximum = maximum;
  }
}

for (const definitive of proposals.filter((row) => row.cardType === "DEFINITIVA")) {
  const base = proposalByKey.get(`${definitive.characterKey}::BASE`);
  if (base == null) throw new Error(`Missing BASE for ${definitive.characterKey}`);
  if (definitive.proposed.hp <= base.proposed.hp || effectiveAttack(definitive, true) <= effectiveAttack(base, true)) {
    throw new Error(`DEFINITIVA is not statistically stronger than BASE for ${definitive.characterKey}`);
  }
}

const rollbackManifest = {
  schemaVersion: 1,
  migration: "card-pm-v2-individual-hero-targets",
  sourceCardBalanceSchemaVersion: sourceVersion,
  targetCardBalanceSchemaVersion: targetVersion,
  sourceSha256: createHash("sha256").update(originalText).digest("hex"),
  runtimePmV2Enabled: false,
  ultimatesChanged: false,
  speedChanged: false,
  entries: proposals,
};
writeFileSync(rollbackPath, `${JSON.stringify(rollbackManifest, null, 2)}\n`, "utf8");

for (const definition of payload.definitions) {
  const row = proposalByKey.get(`${definition.characterKey}::${definition.cardType}`)!;
  definition.stats.ad = row.proposed.ad;
  definition.stats.ap = row.proposed.ap;
  definition.stats.hp = row.proposed.hp;
  definition.stats.vel = row.proposed.vel;
  definition.stats.pm = row.proposed.pm;
  if (row.proposed.basicAttackPower != null) definition.stats.basicAttackPower = row.proposed.basicAttackPower;
}
payload.schemaVersion = targetVersion;
writeFileSync(balancePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");

console.log(`Applied 37 individual PM V2 targets; schema ${sourceVersion} -> ${targetVersion}.`);
console.log(`Rollback manifest: ${rollbackPath.pathname}`);
