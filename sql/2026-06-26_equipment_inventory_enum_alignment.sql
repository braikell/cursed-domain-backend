-- Production enum values:
-- public.equip_slot   = arma, casco, armadura, botas, accesorio
-- public.equip_rarity = comun, raro, epico, legendario, mitico
--
-- Backend balance values stay internal:
-- slot   = weapon, helmet, armor, boots, accessory
-- rarity = basic, epic, legendary, mythic
--
-- This migration is defensive. It normalizes any legacy text values that may
-- exist in user_inventory in environments where the column was temporarily
-- text or had broader enum labels.

update public.user_inventory
set rarity = (
  case lower(rarity::text)
    when 'basico' then 'comun'
    when 'basic' then 'comun'
    when 'common' then 'comun'
    when 'epic' then 'epico'
    when 'rare' then 'raro'
    when 'legendary' then 'legendario'
    when 'mythic' then 'mitico'
    else lower(rarity::text)
  end
)::public.equip_rarity,
updated_at = now()
where lower(rarity::text) in ('basico', 'basic', 'common', 'epic', 'rare', 'legendary', 'mythic');
