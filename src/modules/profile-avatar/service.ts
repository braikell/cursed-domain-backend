import type { GodotAuthedRequestContext, ProfileAvatarInput } from "../../contracts.js";
import { createServiceSupabaseClient } from "../../supabase.js";
import { HttpModuleError } from "../../errors.js";

export async function getProfileAvatarDedicated(context: GodotAuthedRequestContext): Promise<unknown> {
  const service = createServiceSupabaseClient();
  const { data, error } = await service.rpc("get_player_profile_avatar_v1", { p_user_id: context.userId });
  if (!error) {
    if (!data) throw new HttpModuleError(404,"profile_not_ready","profile_avatar_status","El perfil todavía no está preparado.");
    return data;
  }
  // Read compatibility while the ownership migration is being published. Writes never fall back.
  if (!["PGRST202","42883"].includes(error.code ?? "") || !/profile_avatar/i.test(error.message ?? "")) {
    throw new HttpModuleError(503,"profile_avatar_unavailable","profile_avatar_status","No se pudo cargar tu foto de perfil. Reintenta.");
  }
  const profile = await service.from("profiles").select("id,avatar_card_id").eq("id",context.userId).maybeSingle();
  if (profile.error) throw new HttpModuleError(503,"profile_avatar_unavailable","profile_avatar_status","No se pudo cargar tu foto de perfil.");
  if (!profile.data) throw new HttpModuleError(404,"profile_not_ready","profile_avatar_status","El perfil todavía no está preparado.");
  const cardId = profile.data.avatar_card_id as string | null;
  let avatar: Record<string, unknown> | null = null;
  if (cardId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(cardId)) {
    const card = await service.from("user_cards").select("id,user_id,character_key,character_id,card_type,variant,definition_rarity")
      .eq("user_id",context.userId).eq("id",cardId).maybeSingle();
    if (card.error) throw new HttpModuleError(503,"profile_avatar_unavailable","profile_avatar_status","No se pudo validar tu foto de perfil.");
    const character = String(card.data?.character_key ?? card.data?.character_id ?? "");
    if (card.data && /^[a-z0-9_]{1,64}$/.test(character)) avatar = {
      user_card_id:card.data.id,character_key:character,
      card_type:card.data.card_type === "DEFINITIVA" || card.data.variant === "definitive" ? "DEFINITIVA" : "BASE",
      rarity:String(card.data.definition_rarity ?? "basic").toLowerCase(),
    };
  }
  return {ok:true,userId:context.userId,avatarCardId:cardId,avatar,unavailable:!!cardId && !avatar};
}

export async function setProfileAvatarDedicated(context: GodotAuthedRequestContext,input: ProfileAvatarInput): Promise<unknown> {
  const { data,error } = await createServiceSupabaseClient().rpc("set_player_profile_avatar_v1",{
    p_user_id:context.userId,p_avatar_card_id:input.avatarCardId,p_expected_avatar_card_id:input.expectedAvatarCardId,
  });
  if (error) throw new HttpModuleError(503,"profile_avatar_unavailable","profile_avatar_save","No se pudo confirmar el guardado de tu foto. Reintenta para comprobar su resultado.");
  if (!data?.ok) {
    const code=String(data?.code ?? "profile_avatar_unavailable");
    const status=code==="avatar_not_owned"?403:code==="profile_avatar_changed"?409:code==="profile_not_ready"?404:code==="invalid_request"?400:503;
    throw new HttpModuleError(status,code,"profile_avatar_save",String(data?.message ?? "No se pudo guardar tu foto."));
  }
  return data;
}
