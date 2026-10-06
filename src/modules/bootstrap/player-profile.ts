import type { SupabaseClient } from "@supabase/supabase-js";
import { createAuthSupabaseClient } from "../../supabase.js";

export async function ensurePlayerProfile(accessToken: string, userId: string, service: SupabaseClient): Promise<Record<string, unknown>> {
  const authClient = createAuthSupabaseClient();
  const authResult = await (authClient.auth as {
    getUser: (jwt: string) => Promise<{
      data: {
        user: {
          id: string;
          email?: string | null;
          user_metadata?: Record<string, unknown> | null;
        } | null;
      };
      error: { message?: string } | null;
    }>;
  }).getUser(accessToken);
  const user = authResult.data.user;
  if (authResult.error != null || user == null || user.id !== userId) {
    throw new Error("Unauthorized");
  }

  const email = user.email ?? null;
  const displayName =
    typeof user.user_metadata?.full_name === "string"
      ? user.user_metadata.full_name
      : typeof user.user_metadata?.name === "string"
        ? user.user_metadata.name
        : null;
  const avatarUrl = typeof user.user_metadata?.avatar_url === "string" ? user.user_metadata.avatar_url : null;

  const { data: existingProfile, error: existingProfileError } = await service
    .from("profiles")
    .select("display_name, avatar_url, avatar_card_id, profile_created_at, display_name_changed_at, profile_backdrop")
    .eq("id", user.id)
    .maybeSingle<{
      display_name: string | null;
      avatar_url: string | null;
      avatar_card_id: string | null;
      profile_created_at: string | null;
      display_name_changed_at: string | null;
      profile_backdrop: string | null;
    }>();
  const profileMetadataColumnsAvailable =
    existingProfileError == null ||
    !(
      existingProfileError.message.includes("profile_created_at") ||
      existingProfileError.message.includes("display_name_changed_at") ||
      existingProfileError.message.includes("profile_backdrop") ||
      existingProfileError.message.includes("schema cache")
    );
  if (existingProfileError && profileMetadataColumnsAvailable) throw new Error(existingProfileError.message);

  const profilePayload: Record<string, unknown> = {
    id: user.id,
    email,
    display_name: existingProfile?.display_name ?? displayName,
    avatar_url: existingProfile?.avatar_url ?? avatarUrl,
    updated_at: new Date().toISOString(),
  };
  if (profileMetadataColumnsAvailable) {
    profilePayload.profile_created_at = existingProfile?.profile_created_at ?? new Date().toISOString();
    profilePayload.display_name_changed_at = existingProfile?.display_name_changed_at ?? null;
    profilePayload.profile_backdrop = existingProfile?.profile_backdrop ?? "eclipse";
  }

  const { error } = await service.from("profiles").upsert(profilePayload, { onConflict: "id" });
  if (error) throw new Error(error.message);
  // Return the stored choice without writing it back from a potentially older read.
  return { ...profilePayload, avatar_card_id: existingProfile?.avatar_card_id ?? null };
}

