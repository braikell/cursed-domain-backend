begin;

-- user_materials / player_saves.save.fragments are the consumable source of truth.
-- user_cards.fragments is kept only as a read/model mirror for UI and legacy rows.
with mirrored_fragment_rows as (
  select
    uc.id,
    coalesce(um.quantity, 0)::integer as material_quantity
  from public.user_cards uc
  left join public.user_materials um
    on um.user_id = uc.user_id
   and um.material_id = case
      when upper(coalesce(uc.card_type::text, 'BASE')) = 'DEFINITIVA'
        or lower(coalesce(uc.variant::text, '')) = 'definitive'
        then 'fragment:definitive:' || lower(coalesce(nullif(uc.character_key, ''), uc.character_id))
      else 'fragment:' || lower(coalesce(nullif(uc.character_key, ''), uc.character_id))
    end
)
update public.user_cards uc
set
  fragments = greatest(0, mirrored_fragment_rows.material_quantity),
  updated_at = now()
from mirrored_fragment_rows
where uc.id = mirrored_fragment_rows.id
  and coalesce(uc.fragments, 0) <> greatest(0, mirrored_fragment_rows.material_quantity);

commit;
