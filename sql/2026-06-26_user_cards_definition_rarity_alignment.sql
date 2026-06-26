-- public.user_cards.definition_rarity is catalog-facing and constrained to
-- COMMON, EPIC, LEGENDARY, MYTHIC. Runtime rarity remains lowercase in
-- public.user_cards.rarity: basic, epic, legendary, mythic.

update public.user_cards
set definition_rarity = case lower(definition_rarity)
  when 'basic' then 'COMMON'
  when 'common' then 'COMMON'
  when 'epic' then 'EPIC'
  when 'legendary' then 'LEGENDARY'
  when 'mythic' then 'MYTHIC'
  else definition_rarity
end,
updated_at = now()
where definition_rarity is not null
  and definition_rarity <> upper(definition_rarity);
