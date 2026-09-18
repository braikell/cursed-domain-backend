import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { getCardFinalStats } from "../cards/balance.js";
import { convertAdaptivePower } from "./adaptive-power.js";

const contract = JSON.parse(
  readFileSync(new URL("../../../data/equipment_v2_adaptive_power.contract.json", import.meta.url), "utf8"),
) as { goldenVectors: Array<{ scaling: string; adaptivePower: number; ad: number; ap: number }> };

describe("equipment V2 adaptive power", () => {
  it.each(contract.goldenVectors)("matches shared vector $scaling/$adaptivePower", (vector) => {
    expect(convertAdaptivePower(vector.adaptivePower, vector.scaling)).toEqual({ ad: vector.ad, ap: vector.ap });
  });

  it("preserves one point of effective hybrid attack per adaptive point", () => {
    const bonus = convertAdaptivePower(31, "HYBRID");
    expect((bonus.ad + bonus.ap) / 2).toBe(31);
  });

  it("rejects missing or unknown canonical scaling", () => {
    expect(() => convertAdaptivePower(19, "")).toThrow();
    expect(() => convertAdaptivePower(19, "DPS_FISICO")).toThrow();
  });

  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])("rejects invalid power %s", (power) => {
    expect(() => convertAdaptivePower(power, "PHYSICAL")).toThrow();
  });

  it("adds a flat post-progression bonus and updates PM V2 for each scaling", () => {
    const representatives = [
      { key: "yuji", scaling: "PHYSICAL" },
      { key: "gojo", scaling: "MAGICAL" },
      { key: "megumi", scaling: "HYBRID" },
      { key: "utahime", scaling: "SUPPORT" },
    ] as const;
    for (const representative of representatives) {
      const before = getCardFinalStats(representative.key, "BASE", 1, 0);
      const bonus = convertAdaptivePower(19, representative.scaling);
      const after = getCardFinalStats(representative.key, "BASE", 1, 0, bonus);
      expect(after.ad - before.ad).toBe(bonus.ad);
      expect(after.ap - before.ap).toBe(bonus.ap);
      expect(after.hp).toBe(before.hp);
      expect(after.pm_v2).toBeGreaterThan(before.pm_v2);
      if (representative.scaling === "SUPPORT") {
        expect(after.basicAttackPower).toBeGreaterThan(before.basicAttackPower ?? 0);
      }
    }
  });
});
