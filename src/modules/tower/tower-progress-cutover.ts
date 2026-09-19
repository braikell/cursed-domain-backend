import type { SupabaseClient } from "@supabase/supabase-js";

import {
  createInitialGameSave,
  normalizeGameSave,
  TOWER_PROGRESS_CUTOVER_VERSION,
  type GameSaveSnapshot,
} from "../bootstrap/game-save.js";

export function needsTowerProgressCutover(save: GameSaveSnapshot): boolean {
  return save.towerProgressCutoverVersion < TOWER_PROGRESS_CUTOVER_VERSION;
}

export async function applyTowerProgressCutover(
  supabase: SupabaseClient,
  userId: string,
  save: GameSaveSnapshot,
): Promise<boolean> {
  if (!needsTowerProgressCutover(save)) return false;

  const { error: clearsError } = await supabase
    .from("user_tower_floor_clears")
    .delete()
    .eq("user_id", userId);
  if (clearsError) throw new Error(clearsError.message);

  const { error: progressError } = await supabase
    .from("user_tower_progress")
    .delete()
    .eq("user_id", userId);
  if (progressError) throw new Error(progressError.message);

  save.towerProgressCutoverVersion = TOWER_PROGRESS_CUTOVER_VERSION;
  return true;
}

export async function ensureTowerProgressCutoverForUser(
  supabase: SupabaseClient,
  userId: string,
): Promise<void> {
  const { data, error } = await supabase
    .from("player_saves")
    .select("save")
    .eq("user_id", userId)
    .maybeSingle<{ save: GameSaveSnapshot }>();
  if (error) throw new Error(error.message);

  const save = normalizeGameSave(data?.save ?? createInitialGameSave());
  if (!await applyTowerProgressCutover(supabase, userId, save)) return;

  const { error: saveError } = await supabase.from("player_saves").upsert({
    user_id: userId,
    save,
    save_version: save.schemaVersion,
    updated_at: new Date().toISOString(),
  }, { onConflict: "user_id" });
  if (saveError) throw new Error(saveError.message);
}
