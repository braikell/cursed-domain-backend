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
