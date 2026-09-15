import { createHash } from "node:crypto";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";

const dataRoot = new URL("../../../../data/", import.meta.url);
const contractPath = new URL("card_power_rating_v2.contract.json", dataRoot);
const rolloutPath = new URL("card_power_rating_v2.rollout.json", dataRoot);
const thresholdPath = new URL("card_power_rating_v2.thresholds.json", dataRoot);
const catalogPath = new URL("card_balance.json", dataRoot);
const targetPath = new URL("card_power_rating_v2.hero_targets.json", dataRoot);
const rollbackPath = new URL("../../../../../../docs/qa/card_power_rating_v2_cutover_rollback.json", import.meta.url);

if (!process.argv.includes("--write")) throw new Error("PM V2 cutover requires explicit --write");
if (existsSync(rollbackPath)) throw new Error("Cutover rollback already exists; refusing a second activation");

const originals = {
  contract: readFileSync(contractPath, "utf8"),
  rollout: readFileSync(rolloutPath, "utf8"),
  thresholds: readFileSync(thresholdPath, "utf8"),
};
const contract = JSON.parse(originals.contract);
const rollout = JSON.parse(originals.rollout);
const thresholds = JSON.parse(originals.thresholds);
const catalog = JSON.parse(readFileSync(catalogPath, "utf8"));
const targets = JSON.parse(readFileSync(targetPath, "utf8"));

if (contract.status !== "specified" || contract.runtimeEnabled !== false) throw new Error("Contract is not ready for first cutover");
if (rollout.mode !== "shadow" || rollout.thresholdMigrationStatus !== "calibrated" || rollout.fallbackMode !== "legacy") throw new Error("Rollout is not in safe calibrated shadow mode");
if (!rollout.requireGodotParity || !rollout.requireRollback) throw new Error("Cutover safety gates are disabled");
if (thresholds.status !== "calibrated" || thresholds.runtimeEnabled !== false || thresholds.authoritativeVersion !== "legacy") throw new Error("Thresholds are not ready for certification");
if (catalog.schemaVersion !== 7 || catalog.definitions?.length !== 37 || targets.entries?.length !== 37) throw new Error("Canonical 37-card schema-7 balance is incomplete");
for (const required of [
  new URL("../../../../../../docs/qa/card_power_rating_v2_hero_targets_rollback.json", import.meta.url),
  new URL("../../../../../../docs/qa/card_power_rating_v2_specialization_rollback.json", import.meta.url),
]) {
  if (!existsSync(required)) throw new Error("Required statistical rollback is missing");
}

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");
writeFileSync(rollbackPath, `${JSON.stringify({
  schemaVersion: 1,
  migration: "card-pm-v2-authoritative-cutover",
  rollbackMode: "legacy",
  sourceSha256: {
    contract: sha256(originals.contract),
    rollout: sha256(originals.rollout),
    thresholds: sha256(originals.thresholds),
  },
  originals: {
    contract: JSON.parse(originals.contract),
    rollout: JSON.parse(originals.rollout),
    thresholds: JSON.parse(originals.thresholds),
  },
}, null, 2)}\n`, "utf8");

contract.status = "active";
contract.runtimeEnabled = true;
thresholds.status = "certified";
thresholds.runtimeEnabled = true;
thresholds.authoritativeVersion = "v2";
thresholds.domains.campaign.mode = "v2";
thresholds.domains.tower.mode = "v2";
thresholds.domains.pvp.mode = "v2";
thresholds.domains.pvp.strategy = "require-v2-defense-republish";
rollout.mode = "v2";
rollout.thresholdMigrationStatus = "certified";

function atomicWrite(url: URL, value: unknown): void {
  const temporary = new URL(url.pathname + ".cutover.tmp", "file://");
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  renameSync(temporary, url);
}

// Rollout is written last: partial completion remains non-authoritative.
atomicWrite(contractPath, contract);
atomicWrite(thresholdPath, thresholds);
atomicWrite(rolloutPath, rollout);
console.log("PM V2 cutover completed: contract active, thresholds certified, runtime v2; legacy rollback retained.");
