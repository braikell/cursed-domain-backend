import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import { createInitialGameSave, TOWER_PROGRESS_CUTOVER_VERSION } from "../bootstrap/game-save.js";
import { applyTowerProgressCutover, needsTowerProgressCutover } from "./tower-progress-cutover.js";

describe("tower progress cutover", () => {
  it("does not reset newly created accounts", () => {
    expect(needsTowerProgressCutover(createInitialGameSave())).toBe(false);
  });

  it("marks accounts from the previous contract for exactly one reset", () => {
    const save = createInitialGameSave();
    save.towerProgressCutoverVersion = TOWER_PROGRESS_CUTOVER_VERSION - 1;
    expect(needsTowerProgressCutover(save)).toBe(true);
  });

  it("deletes only Tower clears and progress, then becomes idempotent", async () => {
    const deletedTables: string[] = [];
    const supabase = {
      from(table: string) {
        return {
          delete() {
            return {
              async eq(column: string, userId: string) {
                expect(column).toBe("user_id");
                expect(userId).toBe("user-1");
                deletedTables.push(table);
                return { error: null };
              },
            };
          },
        };
      },
    } as unknown as SupabaseClient;
    const save = createInitialGameSave();
    save.towerProgressCutoverVersion = 0;

    expect(await applyTowerProgressCutover(supabase, "user-1", save)).toBe(true);
    expect(deletedTables).toEqual(["user_tower_floor_clears", "user_tower_progress"]);
    expect(save.towerProgressCutoverVersion).toBe(TOWER_PROGRESS_CUTOVER_VERSION);
    expect(await applyTowerProgressCutover(supabase, "user-1", save)).toBe(false);
    expect(deletedTables).toHaveLength(2);
  });
});
