import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { planPmV2LevelOneBalance } from "./pm-balance-planner.js";

const SOURCE_SCHEMA_VERSION = 5;
const TARGET_SCHEMA_VERSION = 6;
const balancePath = new URL("../../../../data/card_balance.json", import.meta.url);
const rollbackPath = new URL("../../../../../../docs/qa/card_power_rating_v2_phase7_rollback.json", import.meta.url);

if (!process.argv.includes("--write")) {
  throw new Error("Refusing to mutate balance without explicit --write");
}

const originalText = readFileSync(balancePath, "utf8");
const payload = JSON.parse(originalText) as {
  schemaVersion: number;
  definitions: Array<{
    characterKey: string;
    cardType: string;
    role: string;
    rarity: string;
    scaling: string;
    stats: Record<string, number>;
  }>;
};
if (payload.schemaVersion !== SOURCE_SCHEMA_VERSION) {
  throw new Error(`Expected card balance schema ${SOURCE_SCHEMA_VERSION}, got ${payload.schemaVersion}`);
}
if (!Array.isArray(payload.definitions) || payload.definitions.length !== 37) {
  throw new Error("Expected exactly 37 card definitions");
}

const proposals = planPmV2LevelOneBalance();
if (proposals.length !== 37 || proposals.some((proposal) => proposal.proposedStatus !== "WITHIN")) {
  throw new Error("Every proposal must finish inside its rarity band");
}
const proposalByKey = new Map(proposals.map((proposal) => [`${proposal.characterKey}::${proposal.cardType}`, proposal]));

for (const definition of payload.definitions) {
  const key = `${definition.characterKey}::${definition.cardType}`;
  const proposal = proposalByKey.get(key);
  if (proposal == null) throw new Error(`Missing proposal for ${key}`);
  if (definition.role !== proposal.role || definition.rarity !== proposal.rarity || definition.scaling !== proposal.scaling) {
    throw new Error(`Identity mismatch for ${key}`);
  }
  for (const stat of ["ad", "ap", "hp", "vel", "pm"] as const) {
    if (Number(definition.stats[stat]) !== proposal.before[stat]) {
      throw new Error(`Stale ${stat} for ${key}: expected ${proposal.before[stat]}, got ${definition.stats[stat]}`);
    }
  }
  if (proposal.before.vel !== proposal.proposed.vel) throw new Error(`VEL changed for ${key}`);
}

const rollbackManifest = {
  schemaVersion: 1,
  migration: "card-pm-v2-phase7",
  sourceCardBalanceSchemaVersion: SOURCE_SCHEMA_VERSION,
  targetCardBalanceSchemaVersion: TARGET_SCHEMA_VERSION,
  sourceSha256: createHash("sha256").update(originalText).digest("hex"),
  runtimePmV2Enabled: false,
  ultimatesChanged: false,
  entries: proposals,
};
writeFileSync(rollbackPath, `${JSON.stringify(rollbackManifest, null, 2)}\n`, "utf8");

for (const definition of payload.definitions) {
  const proposal = proposalByKey.get(`${definition.characterKey}::${definition.cardType}`)!;
  definition.stats.ad = proposal.proposed.ad;
  definition.stats.ap = proposal.proposed.ap;
  definition.stats.hp = proposal.proposed.hp;
  definition.stats.vel = proposal.proposed.vel;
  definition.stats.pm = proposal.proposed.pm;
  if (proposal.proposed.basicAttackPower != null) {
    definition.stats.basicAttackPower = proposal.proposed.basicAttackPower;
  }
}
payload.schemaVersion = TARGET_SCHEMA_VERSION;
writeFileSync(balancePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");

console.log(`Applied PM V2 phase-7 balance to ${payload.definitions.length} cards; schema ${SOURCE_SCHEMA_VERSION} -> ${TARGET_SCHEMA_VERSION}.`);
console.log(`Rollback manifest: ${rollbackPath.pathname}`);
