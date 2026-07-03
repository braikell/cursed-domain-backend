import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  GodotAuthedRequestContext,
  SocialRemoveFriendInput,
  SocialRespondRequestInput,
  SocialSearchInput,
  SocialSendRequestInput,
} from "../../contracts.js";
import { HttpModuleError } from "../../errors.js";
import { createServiceSupabaseClient } from "../../supabase.js";

interface ProfileRow {
  id: string;
  display_name: string | null;
  email: string | null;
}

interface FriendRow {
  user_id: string;
  friend_user_id: string;
  created_at: string;
}

interface FriendRequestRow {
  id: string;
  requester_id: string;
  addressee_id: string;
  status: "pending" | "accepted" | "declined" | "canceled";
  created_at: string;
  updated_at: string;
}

interface PvpRow {
  user_id: string;
  league: string;
  rating: number;
  defense_power: number;
}

const SOCIAL_LIMIT = 50;
const SEARCH_LIMIT = 12;

export async function getSocialStatusDedicated(context: GodotAuthedRequestContext): Promise<unknown> {
  const supabase = createServiceSupabaseClient();
  const [friends, incoming, outgoing] = await Promise.all([
    loadFriends(supabase, context.userId),
    loadRequests(supabase, "addressee_id", context.userId),
    loadRequests(supabase, "requester_id", context.userId),
  ]);
  const relatedIds = uniqueIds([
    ...friends.map((row) => row.friend_user_id),
    ...incoming.map((row) => row.requester_id),
    ...outgoing.map((row) => row.addressee_id),
  ]);
  const [profiles, pvpProfiles] = await Promise.all([
    loadProfiles(supabase, relatedIds),
    loadPvpProfiles(supabase, relatedIds),
  ]);
  return {
    ok: true as const,
    friends: friends.map((row) => ({
      ...toPlayerSummary(row.friend_user_id, profiles, pvpProfiles),
      friendsSince: row.created_at,
    })),
    incomingRequests: incoming.map((row) => toRequestSummary(row, row.requester_id, profiles, pvpProfiles)),
    outgoingRequests: outgoing.map((row) => toRequestSummary(row, row.addressee_id, profiles, pvpProfiles)),
  };
}

export async function searchSocialPlayersDedicated(
  context: GodotAuthedRequestContext,
  input: SocialSearchInput,
): Promise<unknown> {
  const query = input.query.trim();
  if (query.length < 2) {
    return { ok: true as const, players: [] };
  }
  const supabase = createServiceSupabaseClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("id,display_name,email")
    .neq("id", context.userId)
    .ilike("display_name", `%${query}%`)
    .limit(SEARCH_LIMIT)
    .returns<ProfileRow[]>();
  if (error) throw new Error(error.message);
  const ids = uniqueIds((data ?? []).map((row) => row.id));
  const [pvpProfiles, friends, incoming, outgoing] = await Promise.all([
    loadPvpProfiles(supabase, ids),
    loadFriends(supabase, context.userId),
    loadRequests(supabase, "addressee_id", context.userId),
    loadRequests(supabase, "requester_id", context.userId),
  ]);
  const friendIds = new Set(friends.map((row) => row.friend_user_id));
  const incomingIds = new Set(incoming.filter((row) => row.status === "pending").map((row) => row.requester_id));
  const outgoingIds = new Set(outgoing.filter((row) => row.status === "pending").map((row) => row.addressee_id));
  return {
    ok: true as const,
    players: (data ?? []).map((row) => ({
      ...toProfileSummary(row, pvpProfiles.get(row.id)),
      relation: friendIds.has(row.id)
        ? "friend"
        : outgoingIds.has(row.id)
          ? "outgoing"
          : incomingIds.has(row.id)
            ? "incoming"
            : "none",
    })),
  };
}

export async function sendFriendRequestDedicated(
  context: GodotAuthedRequestContext,
  input: SocialSendRequestInput,
): Promise<unknown> {
  assertRequestId(input.requestId, "social_send_request");
  const supabase = createServiceSupabaseClient();
  const targetUserId = await resolveTargetUserId(supabase, context.userId, input);
  if (targetUserId === context.userId) {
    throw new HttpModuleError(400, "social_self_request", "social_send_request", "No puedes agregarte a ti mismo.");
  }
  if (await areFriends(supabase, context.userId, targetUserId)) {
    throw new HttpModuleError(409, "social_already_friends", "social_send_request", "Ese jugador ya esta en tu lista de amigos.");
  }
  const existing = await findPendingRequest(supabase, context.userId, targetUserId);
  if (existing != null) {
    return { ok: true as const, request: toRequestRaw(existing), alreadyPending: true };
  }
  const { data, error } = await supabase
    .from("friend_requests")
    .insert({
      requester_id: context.userId,
      addressee_id: targetUserId,
      status: "pending",
    })
    .select("id,requester_id,addressee_id,status,created_at,updated_at")
    .single<FriendRequestRow>();
  if (error) throw new Error(error.message);
  return { ok: true as const, request: toRequestRaw(data) };
}

export async function respondFriendRequestDedicated(
  context: GodotAuthedRequestContext,
  input: SocialRespondRequestInput,
): Promise<unknown> {
  assertRequestId(input.requestId, "social_respond_request");
  const supabase = createServiceSupabaseClient();
  const { data: request, error } = await supabase
    .from("friend_requests")
    .select("id,requester_id,addressee_id,status,created_at,updated_at")
    .eq("id", input.requestIdToRespond)
    .maybeSingle<FriendRequestRow>();
  if (error) throw new Error(error.message);
  if (request == null || request.status !== "pending") {
    throw new HttpModuleError(404, "social_request_not_found", "social_respond_request", "Solicitud no encontrada o ya resuelta.");
  }
  if (input.action === "cancel" && request.requester_id !== context.userId) {
    throw new HttpModuleError(403, "social_not_request_owner", "social_respond_request", "Solo puedes cancelar solicitudes enviadas por ti.");
  }
  if (input.action !== "cancel" && request.addressee_id !== context.userId) {
    throw new HttpModuleError(403, "social_not_addressee", "social_respond_request", "Solo puedes responder solicitudes recibidas por ti.");
  }
  const nextStatus = input.action === "accept" ? "accepted" : input.action === "decline" ? "declined" : "canceled";
  const { error: updateError } = await supabase
    .from("friend_requests")
    .update({ status: nextStatus })
    .eq("id", request.id);
  if (updateError) throw new Error(updateError.message);
  if (input.action === "accept") {
    const { error: friendshipError } = await supabase.from("user_friends").upsert(
      [
        { user_id: request.requester_id, friend_user_id: request.addressee_id },
        { user_id: request.addressee_id, friend_user_id: request.requester_id },
      ],
      { onConflict: "user_id,friend_user_id" },
    );
    if (friendshipError) throw new Error(friendshipError.message);
  }
  return { ok: true as const, status: nextStatus };
}

export async function removeFriendDedicated(
  context: GodotAuthedRequestContext,
  input: SocialRemoveFriendInput,
): Promise<unknown> {
  assertRequestId(input.requestId, "social_remove_friend");
  const friendUserId = input.friendUserId.trim();
  const supabase = createServiceSupabaseClient();
  const { error } = await supabase
    .from("user_friends")
    .delete()
    .or(`and(user_id.eq.${context.userId},friend_user_id.eq.${friendUserId}),and(user_id.eq.${friendUserId},friend_user_id.eq.${context.userId})`);
  if (error) throw new Error(error.message);
  return { ok: true as const };
}

async function loadFriends(supabase: SupabaseClient, userId: string) {
  const { data, error } = await supabase
    .from("user_friends")
    .select("user_id,friend_user_id,created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(SOCIAL_LIMIT)
    .returns<FriendRow[]>();
  if (error) throw new Error(error.message);
  return data ?? [];
}

async function loadRequests(supabase: SupabaseClient, column: "requester_id" | "addressee_id", userId: string) {
  const { data, error } = await supabase
    .from("friend_requests")
    .select("id,requester_id,addressee_id,status,created_at,updated_at")
    .eq(column, userId)
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(SOCIAL_LIMIT)
    .returns<FriendRequestRow[]>();
  if (error) throw new Error(error.message);
  return data ?? [];
}

async function loadProfiles(supabase: SupabaseClient, userIds: string[]) {
  const map = new Map<string, ProfileRow>();
  if (userIds.length === 0) return map;
  const { data, error } = await supabase
    .from("profiles")
    .select("id,display_name,email")
    .in("id", userIds)
    .returns<ProfileRow[]>();
  if (error) throw new Error(error.message);
  for (const row of data ?? []) map.set(row.id, row);
  return map;
}

async function loadPvpProfiles(supabase: SupabaseClient, userIds: string[]) {
  const map = new Map<string, PvpRow>();
  if (userIds.length === 0) return map;
  const { data, error } = await supabase
    .from("user_pvp_profiles")
    .select("user_id,league,rating,defense_power")
    .in("user_id", userIds)
    .returns<PvpRow[]>();
  if (error) return map;
  for (const row of data ?? []) map.set(row.user_id, row);
  return map;
}

async function resolveTargetUserId(supabase: SupabaseClient, selfUserId: string, input: SocialSendRequestInput) {
  const direct = input.targetUserId?.trim();
  if (direct) return direct;
  const query = input.targetQuery?.trim() ?? "";
  if (query.length < 2) {
    throw new HttpModuleError(400, "social_target_required", "social_send_request", "Busca un jugador por nombre primero.");
  }
  const { data, error } = await supabase
    .from("profiles")
    .select("id,display_name,email")
    .neq("id", selfUserId)
    .ilike("display_name", query)
    .limit(1)
    .maybeSingle<ProfileRow>();
  if (error) throw new Error(error.message);
  if (data == null) {
    throw new HttpModuleError(404, "social_target_not_found", "social_send_request", "Jugador no encontrado.");
  }
  return data.id;
}

async function areFriends(supabase: SupabaseClient, userId: string, friendUserId: string) {
  const { data, error } = await supabase
    .from("user_friends")
    .select("user_id")
    .eq("user_id", userId)
    .eq("friend_user_id", friendUserId)
    .maybeSingle<{ user_id: string }>();
  if (error) throw new Error(error.message);
  return data != null;
}

async function findPendingRequest(supabase: SupabaseClient, a: string, b: string) {
  const { data, error } = await supabase
    .from("friend_requests")
    .select("id,requester_id,addressee_id,status,created_at,updated_at")
    .eq("status", "pending")
    .or(`and(requester_id.eq.${a},addressee_id.eq.${b}),and(requester_id.eq.${b},addressee_id.eq.${a})`)
    .limit(1)
    .maybeSingle<FriendRequestRow>();
  if (error) throw new Error(error.message);
  return data;
}

function toPlayerSummary(userId: string, profiles: Map<string, ProfileRow>, pvpProfiles: Map<string, PvpRow>) {
  const profile = profiles.get(userId);
  return toProfileSummary(profile ?? { id: userId, display_name: null, email: null }, pvpProfiles.get(userId));
}

function toProfileSummary(profile: ProfileRow, pvp?: PvpRow) {
  return {
    userId: profile.id,
    displayName: profile.display_name?.trim() || profile.email || "Jugador",
    friendCode: profile.id.slice(0, 8).toUpperCase(),
    pvpLeague: pvp?.league ?? "bronze",
    pvpRating: pvp?.rating ?? 1000,
    defensePower: pvp?.defense_power ?? 0,
    hasPvpDefense: (pvp?.defense_power ?? 0) > 0,
  };
}

function toRequestSummary(
  request: FriendRequestRow,
  targetUserId: string,
  profiles: Map<string, ProfileRow>,
  pvpProfiles: Map<string, PvpRow>,
) {
  return {
    ...toPlayerSummary(targetUserId, profiles, pvpProfiles),
    requestId: request.id,
    status: request.status,
    createdAt: request.created_at,
  };
}

function toRequestRaw(request: FriendRequestRow) {
  return {
    requestId: request.id,
    requesterId: request.requester_id,
    addresseeId: request.addressee_id,
    status: request.status,
    createdAt: request.created_at,
  };
}

function uniqueIds(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean))).slice(0, SOCIAL_LIMIT * 3);
}

function assertRequestId(requestId: string, module: "social_send_request" | "social_respond_request" | "social_remove_friend") {
  if (!/^[a-zA-Z0-9_-]{8,80}$/.test(requestId.trim())) {
    throw new HttpModuleError(400, "invalid_request_id", module, "Invalid requestId.");
  }
}
