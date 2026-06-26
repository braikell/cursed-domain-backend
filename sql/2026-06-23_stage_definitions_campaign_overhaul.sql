begin;

alter table public.stage_definitions
  add column if not exists display_name text,
  add column if not exists name text,
  add column if not exists description text,
  add column if not exists world_key text,
  add column if not exists stage_type text default 'NORMAL',
  add column if not exists sort_order integer,
  add column if not exists encounter_key text,
  add column if not exists recommended_level integer default 1,
  add column if not exists enemy_count integer default 3,
  add column if not exists loot_source text default 'LOOT_TABLE',
  add column if not exists s_rank_slots integer default 0,
  add column if not exists target_pm integer default 0,
  add column if not exists chapter_boss_pm integer default 0,
  add column if not exists normal_pm_start integer default 0,
  add column if not exists normal_pm_end integer default 0,
  add column if not exists threat_label text,
  add column if not exists clear_gold integer default 0,
  add column if not exists clear_gems integer default 0,
  add column if not exists clear_xp integer default 0,
  add column if not exists is_enabled boolean default true,
  add column if not exists chapter_number integer,
  add column if not exists stage_number integer,
  add column if not exists is_boss boolean default false,
  add column if not exists replay_gold integer default 50,
  add column if not exists replay_gems integer default 0,
  add column if not exists replay_xp integer default 0,
  add column if not exists difficulty_band text,
  add column if not exists boss_ss_cap integer,
  add column if not exists grade_floor text,
  add column if not exists grade_ceiling text,
  add column if not exists updated_at timestamptz default now();

alter table public.encounter_definitions
  add column if not exists display_name text,
  add column if not exists name text,
  add column if not exists description text,
  add column if not exists encounter_type text default 'PVE',
  add column if not exists stage_type text default 'NORMAL',
  add column if not exists spawn_pattern text default 'STATIC',
  add column if not exists recommended_level integer default 1,
  add column if not exists enemy_count integer default 3,
  add column if not exists sort_order integer,
  add column if not exists is_enabled boolean default true,
  add column if not exists chapter_number integer,
  add column if not exists stage_number integer,
  add column if not exists is_boss boolean default false,
  add column if not exists updated_at timestamptz default now();

with chapters as (
  select generate_series(1, 12) as chapter_number
),
buckets as (
  select 1 as bucket_id, 1 as chapter_start, 4 as chapter_end, 8000::integer as gem_total
  union all
  select 2 as bucket_id, 5 as chapter_start, 8 as chapter_end, 18000::integer as gem_total
  union all
  select 3 as bucket_id, 9 as chapter_start, 12 as chapter_end, 34000::integer as gem_total
),
stages as (
  select
    chapter_number,
    generate_series(1, 17) as stage_number
  from chapters
),
stage_seed_raw as (
  select
    format('world_%s_stage_%s', chapter_number, stage_number) as stage_key,
    format('%s-%s', chapter_number, stage_number) as display_name,
    format('Capitulo %s - Etapa %s', chapter_number, stage_number) as name,
    case
      when stage_number = 17 then format('Jefe del capitulo %s. La maldicion dominante marca el salto real de dificultad.', chapter_number)
      else format('Avanza por el capitulo %s, etapa %s, siguiendo la ruta maldita del mapa.', chapter_number, stage_number)
    end as description,
    format('chapter_%02s', chapter_number) as world_key,
    ((chapter_number - 1) * 17) + stage_number as sort_order,
    chapter_number,
    stage_number,
    (stage_number = 17) as is_boss,
    case
      when stage_number = 17 then format('encounter_ch%1$02s_boss_live', chapter_number)
      else format('encounter_ch%1$02s_stage_%2$02s_live', chapter_number, stage_number)
    end as encounter_key,
    greatest(1, ((chapter_number - 1) * 8) + least(stage_number, 8))::integer as recommended_level,
    case when stage_number = 17 then 1 else 3 end as enemy_count,
    'LOOT_TABLE'::text as loot_source,
    case
      when stage_number = 17 then case when chapter_number <= 4 then 1 when chapter_number <= 8 then 2 else 3 end
      when chapter_number <= 4 then 0
      when chapter_number <= 8 then case when stage_number >= 14 then 1 else 0 end
      when stage_number >= 14 then 2
      else 1
    end as s_rank_slots,
    (
      900
      + ((chapter_number - 1) * 650)
      + ((stage_number - 1) * 90)
      + case when stage_number = 17 then 900 else 0 end
    )::integer as target_pm,
    (
      2000
      + ((chapter_number - 1) * 1100)
      + case when chapter_number >= 9 then (chapter_number - 8) * 600 else 0 end
    )::integer as chapter_boss_pm,
    (
      850
      + ((chapter_number - 1) * 600)
    )::integer as normal_pm_start,
    (
      1650
      + ((chapter_number - 1) * 760)
    )::integer as normal_pm_end,
    case
      when stage_number = 17 then
        case
          when chapter_number <= 4 then 'Boss Ascendente'
          when chapter_number <= 8 then 'Boss Dominante'
          else 'Boss Apocaliptico'
        end
      when chapter_number <= 4 then
        case when stage_number <= 10 then 'Ruta Inicial' else 'Ruta de Ascenso' end
      when chapter_number <= 8 then
        case when stage_number <= 10 then 'Ruta de Presion' else 'Ruta de Ruptura' end
      else
        case when stage_number <= 10 then 'Ruta Final' else 'Ruta Extrema' end
    end as threat_label,
    (
      24
      + ((chapter_number - 1) * 10)
      + ((stage_number - 1) * 6)
      + case when stage_number = 17 then 80 else 0 end
    )::integer as clear_xp,
    50::integer as replay_gold,
    0::integer as replay_gems,
    0::integer as replay_xp,
    case
      when chapter_number <= 4 then 'EASY'
      when chapter_number <= 8 then 'MID'
      else 'HARD'
    end as difficulty_band,
    case
      when chapter_number <= 4 then 1
      when chapter_number <= 8 then 2
      else 3
    end as boss_ss_cap,
    case
      when stage_number = 17 and chapter_number <= 4 then 'A'
      when stage_number = 17 then 'S'
      when stage_number <= 4 and chapter_number <= 4 then 'D'
      when stage_number <= 4 and chapter_number <= 8 then 'C'
      when stage_number <= 4 then 'B'
      when stage_number <= 8 and chapter_number <= 4 then 'C'
      when stage_number <= 8 and chapter_number <= 8 then 'B'
      when stage_number <= 8 then 'A'
      when stage_number <= 12 and chapter_number <= 4 then 'C'
      when stage_number <= 12 and chapter_number <= 8 then 'B'
      when stage_number <= 12 then 'A'
      when chapter_number <= 4 then 'B'
      when chapter_number <= 8 then 'A'
      else 'S'
    end as grade_floor,
    case
      when stage_number = 17 then 'S+'
      when stage_number <= 4 and chapter_number <= 4 then 'C'
      when stage_number <= 4 and chapter_number <= 8 then 'B'
      when stage_number <= 4 then 'A'
      when stage_number <= 8 and chapter_number <= 4 then 'B'
      when stage_number <= 8 and chapter_number <= 8 then 'A'
      when stage_number <= 8 then 'S'
      when stage_number <= 12 and chapter_number <= 4 then 'B'
      when stage_number <= 12 and chapter_number <= 8 then 'A'
      when stage_number <= 12 then 'S'
      when chapter_number <= 4 then 'A'
      when chapter_number <= 8 then 'S'
      else 'S+'
    end as grade_ceiling,
    (
      60
      + (chapter_number * 8)
      + stage_number
      + case when stage_number = 17 then 40 else 0 end
    )::integer as reward_weight,
    case
      when chapter_number <= 4 then 1
      when chapter_number <= 8 then 2
      else 3
    end as gem_bucket_id
  from stages
),
stage_reward_distribution as (
  select
    ssr.*,
    b.gem_total,
    floor((b.gem_total::numeric * ssr.reward_weight::numeric) / sum(ssr.reward_weight) over (partition by ssr.gem_bucket_id))::integer as base_clear_gems,
    ((b.gem_total::numeric * ssr.reward_weight::numeric) / sum(ssr.reward_weight) over (partition by ssr.gem_bucket_id))
      - floor((b.gem_total::numeric * ssr.reward_weight::numeric) / sum(ssr.reward_weight) over (partition by ssr.gem_bucket_id)) as clear_gems_fraction,
    floor((2000000::numeric * ssr.reward_weight::numeric) / sum(ssr.reward_weight) over ())::integer as base_clear_gold,
    ((2000000::numeric * ssr.reward_weight::numeric) / sum(ssr.reward_weight) over ())
      - floor((2000000::numeric * ssr.reward_weight::numeric) / sum(ssr.reward_weight) over ()) as clear_gold_fraction
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
    )::integer as bonus_gem_slots,
    row_number() over (
      order by clear_gold_fraction desc, sort_order asc
    ) as clear_gold_rank,
    (2000000 - sum(base_clear_gold) over ())::integer as bonus_gold_slots
  from stage_reward_distribution srd
),
stage_seed as (
  select
    stage_key,
    display_name,
    name,
    description,
    world_key,
    sort_order,
    chapter_number,
    stage_number,
    is_boss,
    encounter_key,
    recommended_level,
    enemy_count,
    loot_source,
    s_rank_slots,
    target_pm,
    chapter_boss_pm,
    normal_pm_start,
    normal_pm_end,
    threat_label,
    (
      base_clear_gold
      + case when clear_gold_rank <= bonus_gold_slots then 1 else 0 end
    )::integer as clear_gold,
    (
      base_clear_gems
      + case when clear_gems_rank <= bonus_gem_slots then 1 else 0 end
    )::integer as clear_gems,
    clear_xp,
    replay_gold,
    replay_gems,
    replay_xp,
    difficulty_band,
    boss_ss_cap,
    grade_floor,
    grade_ceiling
  from stage_reward_ranked
),
encounter_seed as (
  select
    encounter_key,
    format('Encuentro %s-%s', chapter_number, stage_number) as display_name,
    format('Encuentro %s-%s', chapter_number, stage_number) as name,
    format('Encuentro canónico de campaña para %s-%s.', chapter_number, stage_number) as description,
    'PVE'::text as encounter_type,
    case when is_boss then 'BOSS' else 'NORMAL' end as stage_type,
    'STATIC'::text as spawn_pattern,
    recommended_level,
    enemy_count,
    sort_order,
    chapter_number,
    stage_number,
    is_boss
  from stage_seed
),
upserted_stages as (
  insert into public.stage_definitions (
    stage_key,
    display_name,
    name,
    description,
    world_key,
    sort_order,
    chapter_number,
    stage_number,
    is_boss,
    encounter_key,
    recommended_level,
    enemy_count,
    loot_source,
    s_rank_slots,
    target_pm,
    chapter_boss_pm,
    normal_pm_start,
    normal_pm_end,
    threat_label,
    clear_gold,
    clear_gems,
    clear_xp,
    replay_gold,
    replay_gems,
    replay_xp,
    difficulty_band,
    boss_ss_cap,
    grade_floor,
    grade_ceiling,
    is_enabled,
    updated_at
  )
  select
    stage_key,
    display_name,
    name,
    description,
    world_key,
    sort_order,
    chapter_number,
    stage_number,
    is_boss,
    encounter_key,
    recommended_level,
    enemy_count,
    loot_source,
    s_rank_slots,
    target_pm,
    chapter_boss_pm,
    normal_pm_start,
    normal_pm_end,
    threat_label,
    clear_gold,
    clear_gems,
    clear_xp,
    replay_gold,
    replay_gems,
    replay_xp,
    difficulty_band,
    boss_ss_cap,
    grade_floor,
    grade_ceiling,
    true,
    now()
  from stage_seed
  on conflict (stage_key) do update
  set
    display_name = excluded.display_name,
    name = excluded.name,
    description = excluded.description,
    world_key = excluded.world_key,
    sort_order = excluded.sort_order,
    chapter_number = excluded.chapter_number,
    stage_number = excluded.stage_number,
    is_boss = excluded.is_boss,
    encounter_key = excluded.encounter_key,
    recommended_level = excluded.recommended_level,
    enemy_count = excluded.enemy_count,
    loot_source = excluded.loot_source,
    s_rank_slots = excluded.s_rank_slots,
    target_pm = excluded.target_pm,
    chapter_boss_pm = excluded.chapter_boss_pm,
    normal_pm_start = excluded.normal_pm_start,
    normal_pm_end = excluded.normal_pm_end,
    threat_label = excluded.threat_label,
    clear_gold = excluded.clear_gold,
    clear_gems = excluded.clear_gems,
    clear_xp = excluded.clear_xp,
    replay_gold = excluded.replay_gold,
    replay_gems = excluded.replay_gems,
    replay_xp = excluded.replay_xp,
    difficulty_band = excluded.difficulty_band,
    boss_ss_cap = excluded.boss_ss_cap,
    grade_floor = excluded.grade_floor,
    grade_ceiling = excluded.grade_ceiling,
    is_enabled = true,
    updated_at = now()
  returning stage_key
),
disabled_old_stages as (
  update public.stage_definitions
  set
    is_enabled = false,
    updated_at = now()
  where stage_key not in (select stage_key from stage_seed)
    and stage_key like 'world_%_stage_%'
  returning stage_key
),
upserted_encounters as (
  insert into public.encounter_definitions (
    encounter_key,
    display_name,
    name,
    description,
    encounter_type,
    stage_type,
    spawn_pattern,
    recommended_level,
    enemy_count,
    sort_order,
    chapter_number,
    stage_number,
    is_boss,
    is_enabled,
    updated_at
  )
  select
    encounter_key,
    display_name,
    name,
    description,
    encounter_type,
    stage_type,
    spawn_pattern,
    recommended_level,
    enemy_count,
    sort_order,
    chapter_number,
    stage_number,
    is_boss,
    true,
    now()
  from encounter_seed
  on conflict (encounter_key) do update
  set
    display_name = excluded.display_name,
    name = excluded.name,
    description = excluded.description,
    encounter_type = excluded.encounter_type,
    stage_type = excluded.stage_type,
    spawn_pattern = excluded.spawn_pattern,
    recommended_level = excluded.recommended_level,
    enemy_count = excluded.enemy_count,
    sort_order = excluded.sort_order,
    chapter_number = excluded.chapter_number,
    stage_number = excluded.stage_number,
    is_boss = excluded.is_boss,
    is_enabled = true,
    updated_at = now()
  returning encounter_key
),
disabled_old_encounters as (
  update public.encounter_definitions
  set
    is_enabled = false,
    updated_at = now()
  where encounter_key not in (select encounter_key from encounter_seed)
    and encounter_key like 'encounter_ch%'
  returning encounter_key
)
select
  (select count(*) from upserted_stages) as upserted_stage_rows,
  (select count(*) from disabled_old_stages) as disabled_old_stage_rows,
  (select count(*) from upserted_encounters) as upserted_encounter_rows,
  (select count(*) from disabled_old_encounters) as disabled_old_encounter_rows;

commit;

-- Verificación sugerida:
-- select chapter_number, count(*) from public.stage_definitions where is_enabled = true group by chapter_number order by chapter_number;
-- select count(*) from public.stage_definitions where is_enabled = true and is_boss = true;
