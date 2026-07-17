-- ============================================================
-- Original: 2026-06-25_summon_economy_rebalance.sql
-- ============================================================
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

-- ============================================================
-- Original: 2026-06-25_stage_gold_economy_rebalance.sql
-- ============================================================
begin;

with stage_seed_raw as (
  select
    stage_key,
    sort_order,
    chapter_number,
    stage_number,
    is_boss,
    (
      60
      + (chapter_number * 8)
      + stage_number
      + case when is_boss then 40 else 0 end
    )::integer as reward_weight
  from public.stage_definitions
  where coalesce(is_enabled, true) = true
    and chapter_number between 1 and 12
    and stage_number between 1 and 17
),
stage_reward_distribution as (
  select
    ssr.*,
    floor((12000000::numeric * ssr.reward_weight::numeric) / sum(ssr.reward_weight) over ())::integer as base_clear_gold,
    ((12000000::numeric * ssr.reward_weight::numeric) / sum(ssr.reward_weight) over ())
      - floor((12000000::numeric * ssr.reward_weight::numeric) / sum(ssr.reward_weight) over ()) as clear_gold_fraction
  from stage_seed_raw ssr
),
stage_reward_ranked as (
  select
    srd.*,
    row_number() over (
      order by clear_gold_fraction desc, sort_order asc
    ) as clear_gold_rank,
    (12000000 - sum(base_clear_gold) over ())::integer as bonus_gold_slots
  from stage_reward_distribution srd
),
stage_gold_values as (
  select
    stage_key,
    (
      base_clear_gold
      + case when clear_gold_rank <= bonus_gold_slots then 1 else 0 end
    )::integer as clear_gold
  from stage_reward_ranked
)
update public.stage_definitions sd
set
  clear_gold = sgv.clear_gold,
  replay_gold = greatest(2500, round(sgv.clear_gold * 0.35))::integer,
  updated_at = now()
from stage_gold_values sgv
where sd.stage_key = sgv.stage_key;

commit;

-- Verificacion sugerida:
-- select sum(clear_gold) as total_clear_gold, min(replay_gold) as min_replay_gold, max(replay_gold) as max_replay_gold
-- from public.stage_definitions
-- where coalesce(is_enabled, true) = true;

-- ============================================================
-- Original: 2026-06-25_stage_gem_economy_rebalance.sql
-- ============================================================
begin;

with buckets as (
  select *
  from (
    values
      (1::integer, 1::integer, 4::integer, 1500::integer),
      (2::integer, 5::integer, 8::integer, 3000::integer),
      (3::integer, 9::integer, 12::integer, 5500::integer)
  ) as t(bucket_id, chapter_start, chapter_end, gem_total)
),
stage_seed_raw as (
  select
    sd.stage_key,
    sd.sort_order,
    sd.chapter_number,
    sd.stage_number,
    sd.is_boss,
    (
      60
      + (sd.chapter_number * 8)
      + sd.stage_number
      + case when sd.is_boss then 40 else 0 end
    )::integer as reward_weight,
    case
      when sd.chapter_number between 1 and 4 then 1
      when sd.chapter_number between 5 and 8 then 2
      else 3
    end as gem_bucket_id
  from public.stage_definitions sd
  where coalesce(sd.is_enabled, true) = true
    and sd.chapter_number between 1 and 12
    and sd.stage_number between 1 and 17
),
stage_reward_distribution as (
  select
    ssr.*,
    b.gem_total,
    floor((b.gem_total::numeric * ssr.reward_weight::numeric) / sum(ssr.reward_weight) over (partition by ssr.gem_bucket_id))::integer as base_clear_gems,
    ((b.gem_total::numeric * ssr.reward_weight::numeric) / sum(ssr.reward_weight) over (partition by ssr.gem_bucket_id))
      - floor((b.gem_total::numeric * ssr.reward_weight::numeric) / sum(ssr.reward_weight) over (partition by ssr.gem_bucket_id)) as clear_gems_fraction
  from stage_seed_raw ssr
  join buckets b
    on b.bucket_id = ssr.gem_bucket_id
),
stage_reward_ranked as (
  select
    srd.*,
    row_number() over (
      partition by gem_bucket_id
      order by clear_gems_fraction desc, sort_order asc
    ) as clear_gems_rank,
    (
      gem_total
      - sum(base_clear_gems) over (partition by gem_bucket_id)
    )::integer as bonus_gem_slots
  from stage_reward_distribution srd
),
stage_gem_values as (
  select
    stage_key,
    (
      base_clear_gems
      + case when clear_gems_rank <= bonus_gem_slots then 1 else 0 end
    )::integer as clear_gems
  from stage_reward_ranked
)
update public.stage_definitions sd
set
  clear_gems = sgv.clear_gems,
  updated_at = now()
from stage_gem_values sgv
where sd.stage_key = sgv.stage_key;

commit;

-- Verificacion sugerida:
-- select sum(clear_gems) as total_clear_gems
-- from public.stage_definitions
-- where coalesce(is_enabled, true) = true;

-- ============================================================
-- Original: 2026-07-02_summon_pack_limit_counter_repair.sql
-- ============================================================
begin;

with completed_pack_purchases as (
  select
    user_id,
    response->>'packId' as pack_id,
    (response->>'purchaseCurrency')::public.pack_currency_type as purchase_currency,
    response #>> '{limitWindow,windowKey}' as window_key,
    sum((response->>'count')::int) as actual_purchase_count
  from public.idempotency_keys
  where operation like 'purchase_pack_v1:%'
    and response is not null
    and response->>'packId' is not null
    and response->>'purchaseCurrency' in ('gold', 'gems')
    and response->>'count' is not null
    and response #>> '{limitWindow,windowKey}' is not null
  group by
    user_id,
    response->>'packId',
    response->>'purchaseCurrency',
    response #>> '{limitWindow,windowKey}'
),
repaired_limits as (
  update public.user_pack_limits upl
  set
    purchases = cpp.actual_purchase_count,
    updated_at = now()
  from completed_pack_purchases cpp
  where upl.user_id = cpp.user_id
    and upl.pack_id = cpp.pack_id
    and upl.purchase_currency = cpp.purchase_currency
    and upl.window_key = cpp.window_key
    and upl.purchases <> cpp.actual_purchase_count
  returning
    upl.user_id,
    upl.pack_id,
    upl.purchase_currency,
    upl.window_key,
    cpp.actual_purchase_count as repaired_purchases
)
select
  count(*) as repaired_user_pack_limit_rows
from repaired_limits;

commit;

-- Verificacion sugerida:
-- select user_id, pack_id, purchase_currency, purchases, window_key, updated_at
-- from public.user_pack_limits
-- order by updated_at desc
-- limit 50;

-- ============================================================
-- Original: 2026-07-02_user_pack_limits_select_own.sql
-- ============================================================
begin;

alter table public.user_pack_limits enable row level security;

drop policy if exists user_pack_limits_select_own on public.user_pack_limits;
create policy user_pack_limits_select_own
  on public.user_pack_limits
  for select
  to authenticated
  using (auth.uid() = user_id);

grant usage on schema public to authenticated;
grant select on table public.user_pack_limits to authenticated;

commit;

-- ============================================================
-- Original: 2026-07-15_test_initial_currencies_200k_10k.sql
-- ============================================================
begin;

do $$
begin
  if to_regclass('public.monetization_config_versions') is not null then
    update public.monetization_config_versions
    set payload = coalesce(payload, '{}'::jsonb)
      || jsonb_build_object(
        'initialCurrencies',
        jsonb_build_object(
          'gold', 200000,
          'gems', 10000
        )
      )
    where namespace = 'monetization_v1'
      and is_active = true;
  end if;
end $$;

update public.user_economy
set
  gold = 200000,
  gems = 10000,
  updated_at = now()
where gold = 5000
  and gems = 500;

update public.player_saves
set
  save = jsonb_set(
    jsonb_set(save::jsonb, '{gold}', to_jsonb(200000), true),
    '{gems}', to_jsonb(10000),
    true
  ),
  updated_at = now()
where (save->>'gold')::int = 5000
  and (save->>'gems')::int = 500;

commit;

-- Verificacion sugerida:
-- select user_id, gold, gems from public.user_economy order by updated_at desc;
