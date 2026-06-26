begin;

with active_config as (
  select config_version
  from public.monetization_config_versions
  where namespace = 'monetization_v1'
    and is_active = true
  order by config_version desc
  limit 1
),
pack_prices as (
  select *
  from (
    values
      ('basicPack'::text, 'Basic Pack'::text, 6000::integer, 120::integer),
      ('epicPack'::text, 'Epic Pack'::text, 30000::integer, 650::integer),
      ('legendaryPack'::text, 'Legendary Pack'::text, 180000::integer, 2800::integer),
      ('mythicPack'::text, 'Mythic Pack'::text, 650000::integer, 7800::integer)
  ) as t(pack_id, display_name, price_gold, price_gems)
),
updated_packs as (
  update public.pack_definitions pd
  set
    display_name = pp.display_name,
    price_gold = pp.price_gold,
    price_gems = pp.price_gems
  from active_config ac
  join pack_prices pp
    on true
  where pd.config_version = ac.config_version
    and pd.pack_id = pp.pack_id
  returning pd.pack_id
),
duplicate_rewards as (
  select *
  from (
    values
      ('base_basic'::text, 8::integer),
      ('base_epic'::text, 20::integer),
      ('base_legendary'::text, 45::integer),
      ('base_mythic'::text, 90::integer),
      ('definitive_basic'::text, 110::integer),
      ('definitive_epic'::text, 125::integer),
      ('definitive_legendary'::text, 145::integer),
      ('definitive_mythic'::text, 160::integer)
  ) as t(card_type, fragment_amount)
),
updated_duplicate_rewards as (
  update public.card_duplicate_rewards cdr
  set fragment_amount = dr.fragment_amount
  from active_config ac
  join duplicate_rewards dr
    on true
  where cdr.config_version = ac.config_version
    and cdr.card_type = dr.card_type
  returning cdr.card_type
)
select
  (select count(*) from updated_packs) as updated_pack_rows,
  (select count(*) from updated_duplicate_rewards) as updated_duplicate_reward_rows;

commit;

-- Verificacion sugerida:
-- select pack_id, price_gold, price_gems
-- from public.pack_definitions
-- where config_version = (
--   select config_version
--   from public.monetization_config_versions
--   where namespace = 'monetization_v1' and is_active = true
--   order by config_version desc
--   limit 1
-- )
-- order by pack_id;
