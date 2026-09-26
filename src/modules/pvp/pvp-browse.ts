import type { SupabaseClient } from "@supabase/supabase-js";
import { HttpModuleError } from "../../errors.js";
import { PM_V2_RUNTIME_POLICY } from "../cards/power-rating-v2/pm-runtime-policy.js";

export type PvpBrowseInput = { page?: string; cursor?: string; league?: string; search?: string; since?: string };
type Cursor = { id: string; rating: number; at: string; league: string; search: string; ranking: boolean };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function parsePvpBrowse(input: PvpBrowseInput = {}) {
  const page = input.page ?? "";
  const league = input.league ?? "";
  const search = (input.search ?? "").trim();
  if (!["", "rivals", "ranking", "changes"].includes(page) || !["", "bronze", "silver", "gold"].includes(league) || search.length > 40 || (input.cursor?.length ?? 0) > 1024) {
    throw new HttpModuleError(400, "invalid_pvp_browse", "pvp_status", "Filtros de arena inválidos.");
  }
  // Only letters, numbers and whitespace: never interpolate PostgREST filter syntax.
  if (search && !/^[\p{L}\p{N}\s_-]+$/u.test(search)) {
    throw new HttpModuleError(400, "invalid_pvp_search", "pvp_status", "Usa letras o números para buscar.");
  }
  if (page === "changes" && (!input.since || !/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(input.since) || !Number.isFinite(Date.parse(input.since)))) {
    throw new HttpModuleError(400, "invalid_pvp_since", "pvp_status", "Actualiza la arena.");
  }
  let cursor: Cursor | null = null;
  if (input.cursor) {
    try {
      cursor = JSON.parse(Buffer.from(input.cursor, "base64url").toString("utf8")) as Cursor;
      if (!cursor || !UUID.test(cursor.id) || !Number.isSafeInteger(cursor.rating) || typeof cursor.at !== "string" || !/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(cursor.at) || !Number.isFinite(Date.parse(cursor.at)) || cursor.league !== league || cursor.search !== search || cursor.ranking !== (page === "ranking")) throw new Error();
    } catch {
      throw new HttpModuleError(400, "invalid_pvp_cursor", "pvp_status", "Actualiza la lista de rivales.");
    }
  }
  return { page, league, search, cursor };
}
export async function loadPvpBrowsePage(supabase: SupabaseClient, userId: string, select: string, input: PvpBrowseInput, ranking = false) {
  const options = parsePvpBrowse({ ...input, page: ranking ? "ranking" : "rivals" });
  const at = options.cursor?.at ?? new Date().toISOString();
  let query = supabase.from("user_pvp_profiles").select(select)
    .gt("defense_power", 0)
    .eq("defense_snapshot->>pmVersion", PM_V2_RUNTIME_POLICY.mode === "v2" ? "v2" : "legacy")
    .lte("defense_updated_at", at);
  if (!ranking) query = query.neq("user_id", userId);
  if (options.league) query = query.eq("league", options.league);
  if (options.search) query = query.ilike("display_name", "%" + options.search.replace(/[_%]/g, "\\$&") + "%");
  if (ranking) {
    query = query.order("rating", { ascending: false }).order("user_id", { ascending: true });
    if (options.cursor) query = query.or("rating.lt." + options.cursor.rating + ",and(rating.eq." + options.cursor.rating + ",user_id.gt." + options.cursor.id + ")");
  } else {
    // UUID order is immutable: rating changes cannot reshuffle a browsing session.
    query = query.order("user_id", { ascending: true });
    if (options.cursor) query = query.gt("user_id", options.cursor.id);
  }
  const { data, error } = await query.limit(21);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as unknown as Array<{ user_id: string; rating: number }>;
  const hasMore = rows.length > 20;
  const items = rows.slice(0, 20);
  const last = items.at(-1);
  const cursor = hasMore && last ? Buffer.from(JSON.stringify({ id: last.user_id, rating: last.rating, at, league: options.league, search: options.search, ranking } satisfies Cursor)).toString("base64url") : "";
  return { items, page: { hasMore, cursor } };
}
