-- Equipment inventory should start empty.
-- This removes the previous automatic starter/debug equipment from existing
-- accounts and clears equipped item maps from the legacy save mirror.

delete from public.user_inventory;

with normalized_characters as (
  select
    ps.user_id,
    coalesce(
      jsonb_object_agg(
        character_entry.key,
        jsonb_set(character_entry.value, '{equipment}', '{}'::jsonb, true)
      ) filter (where character_entry.key is not null),
      '{}'::jsonb
    ) as characters_payload
  from public.player_saves ps
  left join lateral jsonb_each(coalesce(ps.save->'characters', '{}'::jsonb)) as character_entry(key, value) on true
  group by ps.user_id
)
update public.player_saves ps
set save = jsonb_set(
      jsonb_set(
        coalesce(ps.save, '{}'::jsonb),
        '{inventory}',
        '[]'::jsonb,
        true
      ),
      '{characters}',
      normalized_characters.characters_payload,
      true
    ),
    updated_at = now()
from normalized_characters
where ps.user_id = normalized_characters.user_id;
