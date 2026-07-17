-- ============================================================
-- Original: 2026-06-23_card_definitions_ultimate_backfill.sql
-- ============================================================
begin;

alter table public.card_definitions
  add column if not exists ultimate jsonb;

with prepared as (
  select
    cd.card_key,
    jsonb_build_object(
      'key', lower(cd.character_key) || '_' || lower(cd.card_type) || '_ultimate',
      'name',
        'Ultimate ' ||
        case when upper(cd.card_type) = 'DEFINITIVA' then 'Definitiva' else 'Base' end ||
        ' de ' ||
        regexp_replace(
          coalesce(nullif(cd.display_name, ''), initcap(replace(cd.character_key, '_', ' '))),
          '\s+(Base|Definitiva)$',
          '',
          'i'
        ),
      'type',
        case upper(cd.role)
          when 'DPS_MAGICO' then 'AOE_DAMAGE'
          when 'DPS_DEBUFFER' then 'DEBUFF'
          when 'INVOCADOR' then 'SUMMON'
          when 'SOPORTE' then 'HEAL'
          else 'SINGLE_DAMAGE'
        end,
      'target_rule',
        case upper(cd.role)
          when 'INVOCADOR' then 'SELF'
          when 'SOPORTE' then 'ALL_ALLIES'
          else 'NEAREST_ENEMY'
        end,
      'area_rule',
        case upper(cd.role)
          when 'DPS_MAGICO' then 'LANES_AROUND_TARGET'
          when 'DPS_DEBUFFER' then 'SAME_LANE'
          when 'INVOCADOR' then 'SELF'
          when 'SOPORTE' then 'ALL_ALLIES'
          else 'SINGLE_TARGET'
        end,
      'area_lanes',
        case upper(cd.role)
          when 'DPS_MAGICO' then case when upper(cd.card_type) = 'DEFINITIVA' then 2 else 1 end
          when 'DPS_DEBUFFER' then case when upper(cd.card_type) = 'DEFINITIVA' then 1 else 0 end
          when 'SOPORTE' then 2
          else 0
        end,
      'power',
        case upper(cd.role)
          when 'DPS_FISICO' then case when upper(cd.card_type) = 'DEFINITIVA' then 4.2 else 3.0 end
          when 'DPS_MAGICO' then 2.6
          when 'DPS_DEBUFFER' then 2.0
          when 'INVOCADOR' then 2.0
          when 'SOPORTE' then case when upper(cd.card_type) = 'DEFINITIVA' then 3.0 else 2.0 end
          else case when upper(cd.card_type) = 'DEFINITIVA' then 4.2 else 3.0 end
        end,
      'energy_cost',
        case when upper(cd.card_type) = 'DEFINITIVA' then 70 else 75 end,
      'vfx_key',
        case upper(cd.role)
          when 'DPS_FISICO' then 'physical_ultimate_burst'
          when 'DPS_MAGICO' then 'magic_ultimate_area'
          when 'DPS_DEBUFFER' then 'debuff_ultimate_curse'
          when 'INVOCADOR' then 'summoner_ultimate_ritual'
          when 'SOPORTE' then 'support_ultimate_heal'
          else 'default_ultimate_vfx'
        end
    ) as generated_ultimate
  from public.card_definitions cd
),
updated as (
  update public.card_definitions cd
  set ultimate = prepared.generated_ultimate
  from prepared
  where cd.card_key = prepared.card_key
    and (
      cd.ultimate is distinct from prepared.generated_ultimate
      or
      cd.ultimate is null
      or cd.ultimate = '{}'::jsonb
      or jsonb_typeof(cd.ultimate) <> 'object'
      or coalesce((cd.ultimate ->> 'energy_cost')::int, -1) <> case when upper(cd.card_type) = 'DEFINITIVA' then 70 else 75 end
      or not (cd.ultimate ?& array[
        'key',
        'name',
        'type',
        'target_rule',
        'area_rule',
        'area_lanes',
        'power',
        'energy_cost',
        'vfx_key'
      ])
    )
  returning cd.card_key
)
select count(*) as updated_rows from updated;

commit;

-- Verificacion sugerida en Supabase:
-- select
--   count(*) as total_cards,
--   count(*) filter (
--     where ultimate is not null
--       and jsonb_typeof(ultimate) = 'object'
--       and ultimate ?& array[
--         'key','name','type','target_rule','area_rule',
--         'area_lanes','power','energy_cost','vfx_key'
--       ]
--   ) as cards_with_valid_ultimate
-- from public.card_definitions;

-- ============================================================
-- Original: 2026-07-02_infinite_tower_v1.sql
-- ============================================================
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
    when floor_number = 1 then 500
    when floor_number = 50 then 9999
    else round(
      500.0
      + (9999.0 - 500.0)
      * power(((floor_number - 1)::double precision / 49.0), 1.16)
    )::int
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

-- ============================================================
-- Original: 2026-07-09_ultimate_cast_duration_2_5.sql
-- ============================================================
begin;

with ultimate_timings(character_key, impact_delay_sec, hit_count, hit_interval_sec) as (
  values
    ('yuji', 1.70::numeric, 1, 0.0::numeric),
    ('nobara', 0.80::numeric, 3, 0.725::numeric),
    ('megumi', 1.30::numeric, 3, 0.50::numeric),
    ('gojo', 2.20::numeric, 1, 0.0::numeric),
    ('sukuna', 1.22::numeric, 7, 0.13::numeric),
    ('nanami', 1.35::numeric, 3, 0.37::numeric),
    ('toji', 2.05::numeric, 1, 0.0::numeric),
    ('maki', 1.10::numeric, 4, 0.32::numeric),
    ('panda', 1.10::numeric, 4, 0.32::numeric),
    ('mahito', 1.15::numeric, 2, 0.40::numeric),
    ('geto', 1.35::numeric, 3, 0.40::numeric),
    ('todo', 1.05::numeric, 2, 0.40::numeric),
    ('jogo', 2.05::numeric, 1, 0.0::numeric),
    ('hanami', 1.10::numeric, 3, 0.50::numeric),
    ('higuruma', 1.90::numeric, 1, 0.0::numeric),
    ('kashimo', 1.90::numeric, 1, 0.0::numeric),
    ('choso', 2.05::numeric, 1, 0.0::numeric),
    ('mahoraga', 2.25::numeric, 1, 0.0::numeric),
    ('toge', 1.45::numeric, 1, 0.0::numeric),
    ('inumaki', 1.45::numeric, 1, 0.0::numeric),
    ('naoya', 1.85::numeric, 1, 0.0::numeric),
    ('hakari', 1.90::numeric, 1, 0.0::numeric),
    ('meimei', 1.15::numeric, 2, 0.40::numeric),
    ('utahime', 2.05::numeric, 1, 0.0::numeric),
    ('shoko', 2.05::numeric, 1, 0.0::numeric)
),
updated as (
  update public.card_definitions cd
  set ultimate = coalesce(cd.ultimate, '{}'::jsonb) || jsonb_build_object(
    'animation_lock_msec', 2500,
    'cast_duration_sec', 2.5,
    'impact_delay_sec', ultimate_timings.impact_delay_sec,
    'hit_count', ultimate_timings.hit_count,
    'hit_interval_sec', ultimate_timings.hit_interval_sec
  )
  from ultimate_timings
  where lower(cd.character_key) = ultimate_timings.character_key
    and upper(cd.card_type) in ('BASE', 'DEFINITIVA')
  returning cd.card_key
)
select count(*) as updated_rows from updated;

commit;

-- ============================================================
-- Original: 2026-07-10_card_ultimate_energy_cost_canonical.sql
-- ============================================================
begin;

update public.card_definitions
set ultimate = jsonb_set(
  coalesce(ultimate, '{}'::jsonb),
  '{energy_cost}',
  to_jsonb(case when upper(card_type) = 'DEFINITIVA' then 70 else 75 end),
  true
)
where upper(card_type) in ('BASE', 'DEFINITIVA')
  and (
    ultimate is null
    or jsonb_typeof(ultimate) <> 'object'
    or coalesce((ultimate ->> 'energy_cost')::int, -1) <> case when upper(card_type) = 'DEFINITIVA' then 70 else 75 end
  );

commit;

-- ============================================================
-- Original: 2026-07-10_healing_ultimates_full_payload_repair.sql
-- ============================================================
begin;

with canonical_ultimates(character_key, card_type, ultimate_patch) as (
  values
    (
      'mahoraga',
      'BASE',
      jsonb_build_object(
        'key', 'mahoraga_base_ultimate',
        'name', 'Adaptacion de la Rueda',
        'type', 'SELF_BUFF',
        'target_rule', 'SELF',
        'area_rule', 'SELF',
        'area_lanes', 0,
        'power', 1,
        'fixed_heal_amount', 600,
        'heal_scaling_mode', 'LEVEL_DELTA',
        'damage_multiplier_per_stack', 1.1,
        'scale_multiplier_per_stack', 1.15,
        'max_stacks', 5,
        'energy_cost', 75,
        'animation_lock_msec', 2500,
        'cast_duration_sec', 2.5,
        'impact_delay_sec', 2.25,
        'hit_count', 1,
        'hit_interval_sec', 0,
        'vfx_key', 'mahoraga_wheel_adaptation'
      )
    ),
    (
      'utahime',
      'BASE',
      jsonb_build_object(
        'key', 'utahime_base_ultimate',
        'name', 'Ritual de Bendicion',
        'type', 'HEAL',
        'target_rule', 'LOWEST_HP_ALLY',
        'area_rule', 'SINGLE_TARGET',
        'area_lanes', 0,
        'power', 1,
        'fixed_heal_amount', 470,
        'heal_scaling_mode', 'LEVEL_DELTA',
        'energy_cost', 75,
        'animation_lock_msec', 2500,
        'cast_duration_sec', 2.5,
        'impact_delay_sec', 2.05,
        'hit_count', 1,
        'hit_interval_sec', 0,
        'vfx_key', 'utahime_blessing_ritual'
      )
    ),
    (
      'shoko',
      'BASE',
      jsonb_build_object(
        'key', 'shoko_base_ultimate',
        'name', 'Tecnica Inversa: Proteccion',
        'type', 'HEAL',
        'target_rule', 'LOWEST_HP_ALLY',
        'area_rule', 'SINGLE_TARGET',
        'area_lanes', 0,
        'power', 1,
        'fixed_heal_amount', 300,
        'shield_amount', 250,
        'shield_duration_sec', 6,
        'heal_scaling_mode', 'LEVEL_DELTA',
        'energy_cost', 75,
        'animation_lock_msec', 2500,
        'cast_duration_sec', 2.5,
        'impact_delay_sec', 2.05,
        'hit_count', 1,
        'hit_interval_sec', 0,
        'vfx_key', 'shoko_reverse_shield'
      )
    ),
    (
      'utahime',
      'DEFINITIVA',
      jsonb_build_object(
        'key', 'utahime_definitiva_ultimate',
        'name', 'Ritual de Bendicion',
        'type', 'HEAL',
        'target_rule', 'LOWEST_HP_ALLY',
        'area_rule', 'SINGLE_TARGET',
        'area_lanes', 0,
        'power', 1,
        'fixed_heal_amount', 500,
        'heal_scaling_mode', 'LEVEL_DELTA',
        'energy_cost', 70,
        'animation_lock_msec', 2500,
        'cast_duration_sec', 2.5,
        'impact_delay_sec', 2.05,
        'hit_count', 1,
        'hit_interval_sec', 0,
        'vfx_key', 'utahime_blessing_ritual'
      )
    )
),
updated as (
  update public.card_definitions cd
  set ultimate = jsonb_strip_nulls(coalesce(cd.ultimate, '{}'::jsonb) || canonical_ultimates.ultimate_patch)
  from canonical_ultimates
  where lower(cd.character_key) = canonical_ultimates.character_key
    and upper(cd.card_type) = canonical_ultimates.card_type
  returning cd.card_key
)
select count(*) as updated_rows from updated;

commit;

-- ============================================================
-- Original: 2026-07-10_healing_ultimates_level_delta_canonical.sql
-- ============================================================
begin;

with canonical_ultimates(character_key, card_type, ultimate_patch) as (
  values
    (
      'mahoraga',
      'BASE',
      jsonb_build_object(
        'key', 'mahoraga_base_ultimate',
        'name', 'Adaptacion de la Rueda',
        'type', 'SELF_BUFF',
        'target_rule', 'SELF',
        'area_rule', 'SELF',
        'area_lanes', 0,
        'power', 1,
        'fixed_heal_amount', 600,
        'heal_scaling_mode', 'LEVEL_DELTA',
        'damage_multiplier_per_stack', 1.1,
        'scale_multiplier_per_stack', 1.15,
        'max_stacks', 5,
        'energy_cost', 75,
        'animation_lock_msec', 2500,
        'cast_duration_sec', 2.5,
        'impact_delay_sec', 2.25,
        'hit_count', 1,
        'hit_interval_sec', 0,
        'vfx_key', 'mahoraga_wheel_adaptation'
      )
    ),
    (
      'utahime',
      'BASE',
      jsonb_build_object(
        'key', 'utahime_base_ultimate',
        'name', 'Ritual de Bendicion',
        'type', 'HEAL',
        'target_rule', 'LOWEST_HP_ALLY',
        'area_rule', 'SINGLE_TARGET',
        'area_lanes', 0,
        'power', 1,
        'fixed_heal_amount', 470,
        'heal_scaling_mode', 'LEVEL_DELTA',
        'energy_cost', 75,
        'animation_lock_msec', 2500,
        'cast_duration_sec', 2.5,
        'impact_delay_sec', 2.05,
        'hit_count', 1,
        'hit_interval_sec', 0,
        'vfx_key', 'utahime_blessing_ritual'
      )
    ),
    (
      'shoko',
      'BASE',
      jsonb_build_object(
        'key', 'shoko_base_ultimate',
        'name', 'Tecnica Inversa: Proteccion',
        'type', 'HEAL',
        'target_rule', 'LOWEST_HP_ALLY',
        'area_rule', 'SINGLE_TARGET',
        'area_lanes', 0,
        'power', 1,
        'fixed_heal_amount', 300,
        'shield_amount', 250,
        'shield_duration_sec', 6,
        'heal_scaling_mode', 'LEVEL_DELTA',
        'energy_cost', 75,
        'animation_lock_msec', 2500,
        'cast_duration_sec', 2.5,
        'impact_delay_sec', 2.05,
        'hit_count', 1,
        'hit_interval_sec', 0,
        'vfx_key', 'shoko_reverse_shield'
      )
    ),
    (
      'utahime',
      'DEFINITIVA',
      jsonb_build_object(
        'key', 'utahime_definitiva_ultimate',
        'name', 'Ritual de Bendicion',
        'type', 'HEAL',
        'target_rule', 'LOWEST_HP_ALLY',
        'area_rule', 'SINGLE_TARGET',
        'area_lanes', 0,
        'power', 1,
        'fixed_heal_amount', 500,
        'heal_scaling_mode', 'LEVEL_DELTA',
        'energy_cost', 70,
        'animation_lock_msec', 2500,
        'cast_duration_sec', 2.5,
        'impact_delay_sec', 2.05,
        'hit_count', 1,
        'hit_interval_sec', 0,
        'vfx_key', 'utahime_blessing_ritual'
      )
    )
),
updated as (
  update public.card_definitions cd
  set ultimate = jsonb_strip_nulls(coalesce(cd.ultimate, '{}'::jsonb) || canonical_ultimates.ultimate_patch)
  from canonical_ultimates
  where lower(cd.character_key) = canonical_ultimates.character_key
    and upper(cd.card_type) = canonical_ultimates.card_type
  returning cd.card_key
)
select count(*) as updated_rows from updated;

commit;

-- ============================================================
-- Original: 2026-07-10_toge_inumaki_display_name.sql
-- ============================================================
begin;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'character_definitions'
      and column_name = 'display_name'
  ) then
    update public.character_definitions
    set display_name = 'Toge Inumaki'
    where lower(coalesce(character_key, '')) in ('toge', 'inumaki')
       or lower(coalesce(display_name, '')) in ('toge', 'inumaki');
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'character_definitions'
      and column_name = 'name'
  ) then
    update public.character_definitions
    set name = 'Toge Inumaki'
    where lower(coalesce(character_key, '')) in ('toge', 'inumaki')
       or lower(coalesce(name, '')) in ('toge', 'inumaki');
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'card_definitions'
      and column_name = 'display_name'
  ) then
    update public.card_definitions
    set display_name = 'Toge Inumaki'
    where lower(coalesce(character_key, '')) in ('toge', 'inumaki')
       or lower(coalesce(card_key, '')) in ('toge_base_basic', 'inumaki_base_basic')
       or lower(coalesce(display_name, '')) in ('toge', 'inumaki');
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'card_definitions'
      and column_name = 'name'
  ) then
    update public.card_definitions
    set name = 'Toge Inumaki'
    where lower(coalesce(character_key, '')) in ('toge', 'inumaki')
       or lower(coalesce(card_key, '')) in ('toge_base_basic', 'inumaki_base_basic')
       or lower(coalesce(name, '')) in ('toge', 'inumaki');
  end if;
end $$;

commit;

-- ============================================================
-- Original: 2026-07-10_canonicalize_toge_inumaki.sql
-- ============================================================
begin;

update public.card_definitions
set is_enabled = false
where lower(coalesce(character_key, '')) = 'inumaki'
   or lower(coalesce(card_key, '')) like 'inumaki%';

with candidate_cards as (
  select
    uc.*,
    first_value(uc.id) over (
      partition by uc.user_id
      order by
        case
          when lower(coalesce(uc.card_definition_id, '')) = 'toge_base_basic'
           and lower(coalesce(uc.card_key, '')) = 'toge_base_basic'
           and lower(coalesce(nullif(uc.character_key, ''), nullif(uc.character_id, ''), '')) = 'toge'
            then 0
          when lower(coalesce(nullif(uc.card_definition_id, ''), nullif(uc.card_key, ''), '')) = 'toge_base_basic'
            then 1
          else 2
        end,
        coalesce(uc.acquired_at, 'infinity'::timestamptz),
        uc.id
    ) as keeper_id
  from public.user_cards uc
  where upper(coalesce(uc.card_type, 'BASE')) = 'BASE'
    and (
      lower(coalesce(nullif(uc.character_key, ''), nullif(uc.character_id, ''), '')) in ('toge', 'inumaki')
      or lower(coalesce(nullif(uc.card_key, ''), nullif(uc.card_definition_id, ''), '')) in ('toge_base_basic', 'inumaki_base_basic')
      or lower(coalesce(nullif(uc.card_definition_id, ''), nullif(uc.card_key, ''), '')) in ('toge_base_basic', 'inumaki_base_basic')
    )
),
card_rollup as (
  select
    user_id,
    keeper_id,
    max(level) as level,
    max(xp) as xp,
    max(stars) as stars,
    max(ascension) as ascension,
    max(awakening) as awakening,
    max(fragments) as fragments,
    max(energy) as energy,
    max(max_energy) as max_energy,
    bool_or(coalesce(is_starter, false)) as is_starter,
    min(acquired_at) as acquired_at,
    max(updated_at) as updated_at,
    count(*) as source_count
  from candidate_cards
  group by user_id, keeper_id
),
updated_keepers as (
  update public.user_cards uc
  set
    card_definition_id = 'toge_base_basic',
    card_key = 'toge_base_basic',
    character_id = 'toge',
    character_key = 'toge',
    variant = 'base',
    card_type = 'BASE',
    rarity = 'basic',
    definition_rarity = 'COMMON',
    level = greatest(coalesce(uc.level, 1), coalesce(cr.level, 1)),
    xp = greatest(coalesce(uc.xp, 0), coalesce(cr.xp, 0)),
    stars = greatest(coalesce(uc.stars, 1), coalesce(cr.stars, 1)),
    ascension = greatest(coalesce(uc.ascension, 0), coalesce(cr.ascension, 0)),
    awakening = greatest(coalesce(uc.awakening, 0), coalesce(cr.awakening, 0)),
    fragments = greatest(coalesce(uc.fragments, 0), coalesce(cr.fragments, 0)),
    energy = greatest(coalesce(uc.energy, 0), coalesce(cr.energy, 0)),
    max_energy = greatest(coalesce(uc.max_energy, 100), coalesce(cr.max_energy, 100)),
    is_starter = coalesce(uc.is_starter, false) or coalesce(cr.is_starter, false),
    acquired_at = least(coalesce(uc.acquired_at, cr.acquired_at), coalesce(cr.acquired_at, uc.acquired_at)),
    updated_at = now()
  from card_rollup cr
  where uc.id = cr.keeper_id
  returning uc.user_id, uc.id as keeper_id
),
duplicate_card_map as (
  select cc.user_id, cc.id as duplicate_id, cc.keeper_id
  from candidate_cards cc
  where cc.id <> cc.keeper_id
),
updated_slots as (
  update public.user_formation_slots ufs
  set user_card_id = dcm.keeper_id
  from duplicate_card_map dcm
  where ufs.user_card_id = dcm.duplicate_id
  returning ufs.formation_id, ufs.user_card_id
),
deleted_duplicate_cards as (
  delete from public.user_cards uc
  using duplicate_card_map dcm
  where uc.id = dcm.duplicate_id
  returning uc.user_id, uc.id
),
duplicate_formation_slots as (
  select ctid
  from (
    select
      ctid,
      row_number() over (
        partition by formation_id, user_card_id
        order by team_position asc, board_slot asc, updated_at desc nulls last
      ) as duplicate_rank
    from public.user_formation_slots
    where user_card_id in (select keeper_id from updated_keepers)
  ) ranked_slots
  where duplicate_rank > 1
),
deleted_duplicate_slots as (
  delete from public.user_formation_slots ufs
  using duplicate_formation_slots dfs
  where ufs.ctid = dfs.ctid
  returning ufs.formation_id, ufs.user_card_id
)
select
  'toge_user_cards_merged' as status,
  (select coalesce(sum(source_count - 1), 0) from card_rollup) as deleted_duplicate_card_rows,
  (select count(*) from updated_slots) as redirected_formation_slots,
  (select count(*) from deleted_duplicate_slots) as deleted_duplicate_formation_slots;

with material_candidates as (
  select
    ctid,
    user_id,
    lower(coalesce(material_id, '')) as material_id,
    coalesce(quantity, 0) as quantity,
    case lower(coalesce(material_id, ''))
      when 'element:inumaki_base_basic' then 'element:toge_base_basic'
      when 'element:toge_base_basic' then 'element:toge_base_basic'
      when 'fragment:inumaki' then 'fragment:toge'
      when 'fragment:toge' then 'fragment:toge'
      when 'fragment:definitive:inumaki' then 'fragment:definitive:toge'
      when 'fragment:definitive:toge' then 'fragment:definitive:toge'
      else lower(coalesce(material_id, ''))
    end as canonical_material_id
  from public.user_materials
  where lower(coalesce(material_id, '')) in (
    'element:inumaki_base_basic',
    'element:toge_base_basic',
    'fragment:inumaki',
    'fragment:toge',
    'fragment:definitive:inumaki',
    'fragment:definitive:toge'
  )
),
ranked_materials as (
  select
    *,
    first_value(ctid) over (
      partition by user_id, canonical_material_id
      order by
        case when material_id = canonical_material_id then 0 else 1 end,
        ctid
    ) as keeper_ctid
  from material_candidates
),
material_rollup as (
  select
    user_id,
    canonical_material_id,
    keeper_ctid,
    sum(quantity) as quantity,
    count(*) as source_count
  from ranked_materials
  group by user_id, canonical_material_id, keeper_ctid
),
updated_materials as (
  update public.user_materials um
  set
    material_id = mr.canonical_material_id,
    quantity = mr.quantity,
    updated_at = now()
  from material_rollup mr
  where um.ctid = mr.keeper_ctid
  returning um.user_id, um.material_id
),
deleted_materials as (
  delete from public.user_materials um
  using ranked_materials rm
  where um.ctid = rm.ctid
    and rm.ctid <> rm.keeper_ctid
  returning um.user_id, um.material_id
)
select
  'toge_materials_merged' as status,
  (select count(*) from updated_materials) as canonical_material_rows,
  (select count(*) from deleted_materials) as deleted_duplicate_material_rows;

create unique index if not exists user_cards_one_toge_base_per_user_uidx
  on public.user_cards (user_id)
  where upper(coalesce(card_type, 'BASE')) = 'BASE'
    and (
      lower(coalesce(nullif(character_key, ''), nullif(character_id, ''), '')) in ('toge', 'inumaki')
      or lower(coalesce(nullif(card_key, ''), nullif(card_definition_id, ''), '')) in ('toge_base_basic', 'inumaki_base_basic')
      or lower(coalesce(nullif(card_definition_id, ''), nullif(card_key, ''), '')) in ('toge_base_basic', 'inumaki_base_basic')
    );

commit;

-- ============================================================
-- Original: 2026-07-13_hero_ultimate_energy_cost_70_65.sql
-- ============================================================
begin;

update public.card_definitions
set ultimate = jsonb_set(
  coalesce(ultimate, '{}'::jsonb),
  '{energy_cost}',
  to_jsonb(case when upper(card_type) = 'DEFINITIVA' then 65 else 70 end),
  true
)
where card_type is not null
  and upper(card_type) in ('BASE', 'DEFINITIVA')
  and (
    ultimate is null
    or coalesce((ultimate ->> 'energy_cost')::int, -1) <> case when upper(card_type) = 'DEFINITIVA' then 65 else 70 end
  );

commit;

-- ============================================================
-- Original: 2026-07-13_yuta_manifestacion_rika_ultimate.sql
-- ============================================================
begin;

with canonical_ultimates(character_key, card_type, ultimate_patch) as (
  values
    (
      'yuta',
      'BASE',
      jsonb_build_object(
        'key', 'yuta_base_ultimate',
        'name', 'Manifestacion de Rika',
        'type', 'SUMMON',
        'target_rule', 'NEAREST_ENEMY',
        'area_rule', 'SINGLE_TARGET',
        'area_lanes', 0,
        'power', 2,
        'energy_cost', 75,
        'animation_lock_msec', 2500,
        'cast_duration_sec', 2.5,
        'impact_delay_sec', 1.15,
        'hit_count', 3,
        'hit_interval_sec', 0.42,
        'vfx_key', 'yuta_rika_manifestation'
      )
    ),
    (
      'yuta',
      'DEFINITIVA',
      jsonb_build_object(
        'key', 'yuta_definitiva_ultimate',
        'name', 'Manifestacion de Rika',
        'type', 'SUMMON',
        'target_rule', 'NEAREST_ENEMY',
        'area_rule', 'SINGLE_TARGET',
        'area_lanes', 0,
        'power', 2,
        'energy_cost', 70,
        'animation_lock_msec', 2500,
        'cast_duration_sec', 2.5,
        'impact_delay_sec', 1.15,
        'hit_count', 3,
        'hit_interval_sec', 0.42,
        'vfx_key', 'yuta_rika_manifestation'
      )
    )
),
updated as (
  update public.card_definitions cd
  set ultimate = jsonb_strip_nulls(coalesce(cd.ultimate, '{}'::jsonb) || canonical_ultimates.ultimate_patch)
  from canonical_ultimates
  where lower(cd.character_key) = canonical_ultimates.character_key
    and upper(cd.card_type) = canonical_ultimates.card_type
  returning cd.card_key
)
select count(*) as updated_rows from updated;

commit;

-- ============================================================
-- Original: 2026-07-14_yuji_black_flash_close_area.sql
-- ============================================================
begin;

update public.card_definitions
set ultimate = coalesce(ultimate, '{}'::jsonb)
  || jsonb_build_object(
    'area_rule', 'PRIMARY_AND_CLOSE_ENEMIES',
    'area_lanes', 0,
    'secondary_target_count', 1,
    'secondary_target_radius_px', 90
  )
where lower(character_key) = 'yuji'
  and upper(card_type) in ('BASE', 'DEFINITIVA');

commit;

-- ============================================================
-- Original: 2026-07-14_tower_xp_rewards.sql
-- ============================================================
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

-- ============================================================
-- Original: 2026-07-15_battle_sessions_free_plan.sql
-- ============================================================
begin;

create table if not exists public.battle_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  mode text not null,
  stage_id text,
  floor_number int,
  match_id uuid,
  team_hash text not null,
  team_power int not null default 0,
  target_power int not null default 0,
  min_duration_seconds int not null default 3,
  request_id text not null,
  started_at timestamptz not null default now(),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  check (mode in ('campaign', 'tower', 'pvp')),
  check (team_power >= 0),
  check (target_power >= 0),
  check (min_duration_seconds >= 0),
  check (expires_at > started_at)
);

create unique index if not exists battle_sessions_user_request_idx
  on public.battle_sessions (user_id, request_id);

create index if not exists battle_sessions_user_active_idx
  on public.battle_sessions (user_id, mode, expires_at)
  where consumed_at is null;

create index if not exists battle_sessions_expires_idx
  on public.battle_sessions (expires_at);

create index if not exists battle_sessions_consumed_idx
  on public.battle_sessions (consumed_at);

alter table public.battle_sessions enable row level security;

revoke all on table public.battle_sessions from anon;
revoke all on table public.battle_sessions from authenticated;
grant all on table public.battle_sessions to service_role;

commit;

-- Smoke checks after applying:
--
-- select
--   relname as table_name,
--   pg_size_pretty(pg_total_relation_size(relid)) as total_size
-- from pg_stat_user_tables
-- where schemaname = 'public'
--   and relname = 'battle_sessions';
--
-- select public.daily_cleanup_free_plan(true);
