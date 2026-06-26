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
