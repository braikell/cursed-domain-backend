-- Torre Infinita: expansion de 50 a 100 pisos.
-- Los pisos 1-50 conservan sus recompensas existentes.
-- Los pisos 51-100 reutilizan recompensas por equivalencia 1:2.
begin;

alter table public.tower_floor_definitions
  add column if not exists reward_xp integer not null default 0,
  add column if not exists replay_xp integer not null default 0;

with generated_floors as (
  select
    floor_number,
    least(50, ceil(floor_number / 2.0)::int) as legacy_floor_number,
    least(50, floor_number / 5 * 5) as legacy_boss_floor_number
  from generate_series(51, 100) as generated(floor_number)
)
insert into public.tower_floor_definitions (
  floor_number, floor_key, display_name, is_boss, enemy_count,
  enemy_grade_floor, enemy_grade_ceiling, target_pm,
  reward_gold, reward_gems, reward_equipment_guaranteed,
  replay_gold, replay_gems, reward_xp, replay_xp, sort_order, is_enabled
)
select
  generated.floor_number,
  format('tower_floor_%s', lpad(generated.floor_number::text, 3, '0')),
  case
    when generated.floor_number % 5 = 0 then format('Piso %s - Guardian de la Torre', generated.floor_number)
    else format('Piso %s', generated.floor_number)
  end,
  generated.floor_number % 5 = 0,
  case when generated.floor_number % 5 = 0 then 1 else 2 end,
  case when generated.floor_number % 5 = 0 then 'S+' else 'A' end,
  case when generated.floor_number % 5 = 0 then 'S+' else 'S' end,
  case
    when generated.legacy_floor_number = 1 then 500
    when generated.legacy_floor_number = 50 then 9999
    else round(500.0 + (9999.0 - 500.0) * power(((generated.legacy_floor_number - 1)::double precision / 49.0), 1.16))::int
  end,
  source.reward_gold,
  source.reward_gems,
  source.reward_equipment_guaranteed,
  source.replay_gold,
  source.replay_gems,
  source.reward_xp,
  source.replay_xp,
  generated.floor_number,
  true
from generated_floors generated
join public.tower_floor_definitions source
  on source.floor_number = case
    when generated.floor_number % 5 = 0 then generated.legacy_boss_floor_number
    else generated.legacy_floor_number
  end
on conflict (floor_number) do update
set
  floor_key = excluded.floor_key,
  display_name = excluded.display_name,
  is_boss = excluded.is_boss,
  enemy_count = excluded.enemy_count,
  enemy_grade_floor = excluded.enemy_grade_floor,
  enemy_grade_ceiling = excluded.enemy_grade_ceiling,
  target_pm = excluded.target_pm,
  reward_gold = excluded.reward_gold,
  reward_gems = excluded.reward_gems,
  reward_equipment_guaranteed = excluded.reward_equipment_guaranteed,
  replay_gold = excluded.replay_gold,
  replay_gems = excluded.replay_gems,
  reward_xp = excluded.reward_xp,
  replay_xp = excluded.replay_xp,
  sort_order = excluded.sort_order,
  is_enabled = excluded.is_enabled,
  updated_at = now();

commit;
