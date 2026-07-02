begin;

create table if not exists public.tower_floor_definitions (
  floor_number int primary key,
  floor_key text not null unique,
  display_name text not null,
  is_boss boolean not null default false,
  enemy_count int not null,
  enemy_grade_floor text not null,
  enemy_grade_ceiling text not null,
  target_pm int not null,
  reward_gold int not null default 0,
  reward_gems int not null default 0,
  reward_equipment_guaranteed boolean not null default false,
  replay_gold int not null default 0,
  replay_gems int not null default 0,
  sort_order int not null,
  is_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (floor_number > 0),
  check (enemy_count in (1, 2)),
  check (enemy_grade_floor in ('A', 'S', 'S+')),
  check (enemy_grade_ceiling in ('A', 'S', 'S+')),
  check (target_pm > 0),
  check (reward_gold >= 0),
  check (reward_gems >= 0),
  check (replay_gold >= 0),
  check (replay_gems >= 0)
);

create table if not exists public.user_tower_progress (
  user_id uuid primary key references auth.users(id) on delete cascade,
  highest_floor int not null default 0,
  current_floor int not null default 1,
  total_clears int not null default 0,
  last_completed_floor int not null default 0,
  updated_at timestamptz not null default now(),
  check (highest_floor >= 0),
  check (current_floor >= 1),
  check (total_clears >= 0),
  check (last_completed_floor >= 0)
);

create table if not exists public.user_tower_floor_clears (
  user_id uuid not null references auth.users(id) on delete cascade,
  floor_number int not null references public.tower_floor_definitions(floor_number),
  first_cleared_at timestamptz,
  last_cleared_at timestamptz,
  clear_count int not null default 0,
  best_clear_seconds numeric,
  primary key (user_id, floor_number),
  check (clear_count >= 0)
);

insert into public.tower_floor_definitions (
  floor_number,
  floor_key,
  display_name,
  is_boss,
  enemy_count,
  enemy_grade_floor,
  enemy_grade_ceiling,
  target_pm,
  reward_gold,
  reward_gems,
  reward_equipment_guaranteed,
  replay_gold,
  replay_gems,
  sort_order,
  is_enabled
)
select
  floor_number,
  format('tower_floor_%s', lpad(floor_number::text, 3, '0')) as floor_key,
  case
    when floor_number % 5 = 0 then format('Piso %s - Guardian de la Torre', floor_number)
    else format('Piso %s', floor_number)
  end as display_name,
  floor_number % 5 = 0 as is_boss,
  case when floor_number % 5 = 0 then 1 else 2 end as enemy_count,
  case when floor_number % 5 = 0 then 'S+' else 'A' end as enemy_grade_floor,
  case when floor_number % 5 = 0 then 'S+' else 'S' end as enemy_grade_ceiling,
  case
    when floor_number % 5 = 0 then floor((1120 + floor_number * 105 + ceil(floor_number / 5.0)::int * 360) * (1.32 + ceil(floor_number / 5.0)::int * 0.022))::int
    else 1120 + floor_number * 105 + ceil(floor_number / 5.0)::int * 360
  end as target_pm,
  case
    when floor_number % 5 = 0 then 40000 + floor_number * 5000
    else 12000 + floor_number * 2500
  end as reward_gold,
  case
    when floor_number % 5 = 0 then 30 + ceil(floor_number / 5.0)::int * 8
    else 5 + ceil(floor_number / 5.0)::int * 2
  end as reward_gems,
  floor_number % 5 = 0 as reward_equipment_guaranteed,
  case
    when floor_number % 5 = 0 then greatest(8000, floor((40000 + floor_number * 5000) * 0.20)::int)
    else greatest(3000, floor((12000 + floor_number * 2500) * 0.15)::int)
  end as replay_gold,
  0 as replay_gems,
  floor_number as sort_order,
  true as is_enabled
from generate_series(1, 50) as generated(floor_number)
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
  sort_order = excluded.sort_order,
  is_enabled = excluded.is_enabled,
  updated_at = now();

alter table public.user_tower_progress enable row level security;
alter table public.user_tower_floor_clears enable row level security;

drop policy if exists user_tower_progress_select_own on public.user_tower_progress;
create policy user_tower_progress_select_own
  on public.user_tower_progress
  for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists user_tower_floor_clears_select_own on public.user_tower_floor_clears;
create policy user_tower_floor_clears_select_own
  on public.user_tower_floor_clears
  for select
  to authenticated
  using (auth.uid() = user_id);

grant usage on schema public to authenticated;
grant select on table public.tower_floor_definitions to authenticated;
grant select on table public.user_tower_progress to authenticated;
grant select on table public.user_tower_floor_clears to authenticated;

commit;
