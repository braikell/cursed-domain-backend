begin;

alter table public.tower_floor_definitions
  add column if not exists reward_xp integer not null default 0,
  add column if not exists replay_xp integer not null default 0;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'tower_floor_definitions_reward_xp_nonnegative'
  ) then
    alter table public.tower_floor_definitions
      add constraint tower_floor_definitions_reward_xp_nonnegative
      check (reward_xp >= 0);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'tower_floor_definitions_replay_xp_nonnegative'
  ) then
    alter table public.tower_floor_definitions
      add constraint tower_floor_definitions_replay_xp_nonnegative
      check (replay_xp >= 0);
  end if;
end $$;

with weighted_floors as (
  select
    floor_number,
    (
      power(floor_number::double precision, 1.18)
      * case when floor_number % 5 = 0 then 1.45 else 1.0 end
    ) as reward_weight
  from public.tower_floor_definitions
  where floor_number between 1 and 50
),
raw_rewards as (
  select
    floor_number,
    floor((18000.0 * reward_weight) / sum(reward_weight) over ())::integer as base_reward_xp,
    ((18000.0 * reward_weight) / sum(reward_weight) over ())
      - floor((18000.0 * reward_weight) / sum(reward_weight) over ()) as fractional_share
  from weighted_floors
),
ranked_rewards as (
  select
    floor_number,
    base_reward_xp,
    row_number() over (order by fractional_share desc, floor_number asc) as fractional_rank,
    (18000 - sum(base_reward_xp) over ())::integer as remainder_slots
  from raw_rewards
),
tower_xp_values as (
  select
    floor_number,
    (
      base_reward_xp
      + case when fractional_rank <= remainder_slots then 1 else 0 end
    )::integer as reward_xp
  from ranked_rewards
)
update public.tower_floor_definitions tfd
set
  reward_xp = txv.reward_xp,
  replay_xp = 0,
  updated_at = now()
from tower_xp_values txv
where tfd.floor_number = txv.floor_number;

commit;

-- Verificacion sugerida:
-- select sum(reward_xp) as total_tower_xp, sum(replay_xp) as total_replay_xp
-- from public.tower_floor_definitions
-- where floor_number between 1 and 50;
