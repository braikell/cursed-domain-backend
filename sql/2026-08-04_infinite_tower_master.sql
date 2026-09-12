-- ============================================================
-- TORRE INFINITA - SQL MASTER CANONICO
-- ============================================================
-- Este es el unico SQL de expansion/equilibrio de Torre Infinita.
--
-- Requisitos:
--   1. Ejecutar previamente las migraciones base 0000_core_schema.sql,
--      0001_economy_summons.sql y 0002_combat_tower.sql.
--   2. Ejecutar este archivo una sola vez al finalizar los cambios.
--
-- Incluye:
--   - Expansion de 50 a 100 pisos.
--   - Reutilizacion segura de recompensas existentes.
--   - PM canonico ascendente con picos propios de jefe.
--   - Grados D/C/B/A/S/S+ progresivos y narrativamente coherentes.
--   - Restricciones, idempotencia y validaciones fail-fast.
--
-- Las futuras modificaciones de Torre deben agregarse a este archivo.
begin;

-- ------------------------------------------------------------
-- 1) Extensiones de columnas para los 100 pisos
-- ------------------------------------------------------------
alter table public.tower_floor_definitions
  add column if not exists reward_xp integer not null default 0,
  add column if not exists replay_xp integer not null default 0;

-- ------------------------------------------------------------
-- 2) Curva canonica de PM de jefes
-- ------------------------------------------------------------
create or replace function public.tower_canonical_boss_pm(p_floor_number integer)
returns integer
language sql
immutable
strict
parallel safe
as $function$
with normalized as (
  select greatest(5, least(100, p_floor_number)) as floor_number
)
select case
  when floor_number <= 5 then 999
  when floor_number <= 10 then 1550
  when floor_number <= 15 then 2150
  when floor_number <= 20 then 2678
  when floor_number <= 25 then 2950
  when floor_number <= 30 then 3700
  when floor_number <= 35 then 4450
  when floor_number <= 40 then 5200
  when floor_number <= 45 then 6000
  when floor_number <= 50 then 6800
  when floor_number <= 55 then 7550
  when floor_number <= 60 then 8250
  when floor_number <= 65 then 8900
  when floor_number <= 70 then 9450
  when floor_number <= 75 then 9900
  when floor_number <= 80 then 10400
  when floor_number <= 85 then 10800
  when floor_number <= 90 then 11150
  when floor_number <= 95 then 11550
  else 12000
end
from normalized;
$function$;

-- Los pisos normales se interpolan entre los hitos de jefe.
-- El exponente 1.08 mantiene el inicio del tramo ligeramente mas accesible.
create or replace function public.tower_canonical_target_pm(p_floor_number integer)
returns integer
language sql
immutable
strict
parallel safe
as $function$
with normalized as (
  select greatest(1, least(100, p_floor_number)) as floor_number
), anchors as (
  select
    floor_number,
    case
      when floor_number < 5 then 1
      else floor(floor_number / 5.0)::integer * 5
    end as previous_anchor,
    case
      when floor_number < 5 then 5
      else ceil(floor_number / 5.0)::integer * 5
    end as next_anchor
  from normalized
), values_at_anchors as (
  select
    floor_number,
    previous_anchor,
    next_anchor,
    case when previous_anchor = 1 then 500 else public.tower_canonical_boss_pm(previous_anchor) end as previous_pm,
    public.tower_canonical_boss_pm(next_anchor) as next_pm
  from anchors
)
select case
  when floor_number = 1 then 500
  when floor_number % 5 = 0 then public.tower_canonical_boss_pm(floor_number)
  else round(
    previous_pm
    + (next_pm - previous_pm)
    * power(
      (floor_number - previous_anchor)::double precision
      / (next_anchor - previous_anchor)::double precision,
      1.08
    )
  )::integer
end
from values_at_anchors;
$function$;

-- ------------------------------------------------------------
-- 3) Grados canonicos para enemigos normales y jefes
-- ------------------------------------------------------------
create or replace function public.tower_canonical_enemy_grade(
  p_floor_number integer,
  p_slot_index integer default 0
)
returns text
language sql
immutable
strict
parallel safe
as $function$
with normalized as (
  select
    greatest(1, least(100, p_floor_number)) as floor_number,
    greatest(0, least(1, coalesce(p_slot_index, 0))) as slot_index
)
select case
  -- Jefes: hitos C -> B -> A -> S -> S+.
  when floor_number % 5 = 0 then case
    when floor_number <= 5 then 'C'
    when floor_number <= 15 then 'B'
    when floor_number <= 50 then 'A'
    when floor_number <= 75 then 'S'
    else 'S+'
  end
  -- Normales: slot 0 recibe el grado superior y slot 1 el inferior.
  when floor_number <= 5 then case when slot_index = 0 then 'C' else 'D' end
  when floor_number <= 10 then case when slot_index = 0 then 'B' else 'C' end
  when floor_number <= 15 then 'B'
  when floor_number <= 35 then case when slot_index = 0 then 'A' else 'B' end
  when floor_number <= 50 then 'A'
  when floor_number <= 75 then case when slot_index = 0 then 'S' else 'A' end
  else case when slot_index = 0 then 'S+' else 'S' end
end
from normalized;
$function$;

-- La tabla original de Torre solo permitia A/S/S+.
alter table public.tower_floor_definitions
  drop constraint if exists tower_floor_definitions_enemy_grade_floor_check;
alter table public.tower_floor_definitions
  drop constraint if exists tower_floor_definitions_enemy_grade_ceiling_check;

do $constraints$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'tower_floor_definitions_enemy_grade_floor_allowed_check'
  ) then
    alter table public.tower_floor_definitions
      add constraint tower_floor_definitions_enemy_grade_floor_allowed_check
      check (enemy_grade_floor in ('D', 'C', 'B', 'A', 'S', 'S+'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'tower_floor_definitions_enemy_grade_ceiling_allowed_check'
  ) then
    alter table public.tower_floor_definitions
      add constraint tower_floor_definitions_enemy_grade_ceiling_allowed_check
      check (enemy_grade_ceiling in ('D', 'C', 'B', 'A', 'S', 'S+'));
  end if;
end;
$constraints$;

-- ------------------------------------------------------------
-- 4) Creacion segura de pisos 51-100
-- ------------------------------------------------------------
-- Las recompensas de los pisos nuevos se heredan de las existentes.
-- En conflictos no se reescriben recompensas ya personalizadas.
with generated_floors as (
  select
    floor_number,
    least(50, ceil(floor_number / 2.0)::integer) as legacy_floor_number,
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
    when generated.floor_number % 5 = 0 then format('Piso %s - Jefe de la Torre', generated.floor_number)
    else format('Piso %s', generated.floor_number)
  end,
  generated.floor_number % 5 = 0,
  case when generated.floor_number % 5 = 0 then 1 else 2 end,
  public.tower_canonical_enemy_grade(generated.floor_number, 1),
  public.tower_canonical_enemy_grade(generated.floor_number, 0),
  public.tower_canonical_target_pm(generated.floor_number),
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
  sort_order = excluded.sort_order,
  is_enabled = excluded.is_enabled,
  updated_at = now();

-- ------------------------------------------------------------
-- 5) Normalizacion final de los 100 pisos
-- ------------------------------------------------------------
update public.tower_floor_definitions
set
  target_pm = public.tower_canonical_target_pm(floor_number),
  enemy_grade_floor = public.tower_canonical_enemy_grade(floor_number, 1),
  enemy_grade_ceiling = public.tower_canonical_enemy_grade(floor_number, 0),
  updated_at = now()
where floor_number between 1 and 100;

-- ------------------------------------------------------------
-- 6) Validaciones fail-fast
-- ------------------------------------------------------------
do $validation$
declare
  v_floor_count integer;
  v_non_monotonic_count integer;
  v_invalid_grade_count integer;
  v_invalid_boss_grade_count integer;
  v_max_pm integer;
  v_max_pm_count integer;
  v_floor_1_pm integer;
  v_floor_5_pm integer;
  v_floor_10_pm integer;
  v_floor_15_pm integer;
  v_floor_20_pm integer;
  v_floor_25_pm integer;
  v_floor_100_pm integer;
  v_floor_1_floor text;
  v_floor_1_ceiling text;
  v_floor_100_floor text;
  v_floor_100_ceiling text;
begin
  select count(*) into v_floor_count
  from public.tower_floor_definitions
  where floor_number between 1 and 100;

  if v_floor_count <> 100 then
    raise exception 'Torre Infinita invalida: se esperaban 100 pisos y existen %.', v_floor_count;
  end if;

  select count(*) into v_non_monotonic_count
  from (
    select
      target_pm,
      lag(target_pm) over (order by floor_number) as previous_pm
    from public.tower_floor_definitions
    where floor_number between 1 and 100
  ) progression
  where previous_pm is not null and target_pm <= previous_pm;

  select count(*) into v_invalid_grade_count
  from public.tower_floor_definitions
  where floor_number between 1 and 100
    and (
      enemy_grade_floor not in ('D', 'C', 'B', 'A', 'S', 'S+')
      or enemy_grade_ceiling not in ('D', 'C', 'B', 'A', 'S', 'S+')
    );

  select count(*) into v_invalid_boss_grade_count
  from public.tower_floor_definitions
  where floor_number between 1 and 100
    and is_boss
    and enemy_grade_floor <> enemy_grade_ceiling;

  select max(target_pm) into v_max_pm
  from public.tower_floor_definitions
  where floor_number between 1 and 100;

  select count(*) into v_max_pm_count
  from public.tower_floor_definitions
  where floor_number between 1 and 100 and target_pm = v_max_pm;

  select target_pm into v_floor_1_pm from public.tower_floor_definitions where floor_number = 1;
  select target_pm into v_floor_5_pm from public.tower_floor_definitions where floor_number = 5;
  select target_pm into v_floor_10_pm from public.tower_floor_definitions where floor_number = 10;
  select target_pm into v_floor_15_pm from public.tower_floor_definitions where floor_number = 15;
  select target_pm into v_floor_20_pm from public.tower_floor_definitions where floor_number = 20;
  select target_pm into v_floor_25_pm from public.tower_floor_definitions where floor_number = 25;
  select target_pm into v_floor_100_pm from public.tower_floor_definitions where floor_number = 100;

  select enemy_grade_floor, enemy_grade_ceiling
    into v_floor_1_floor, v_floor_1_ceiling
  from public.tower_floor_definitions where floor_number = 1;
  select enemy_grade_floor, enemy_grade_ceiling
    into v_floor_100_floor, v_floor_100_ceiling
  from public.tower_floor_definitions where floor_number = 100;

  if v_non_monotonic_count <> 0
     or v_invalid_grade_count <> 0
     or v_invalid_boss_grade_count <> 0
     or v_max_pm > 12200
     or v_max_pm_count <> 1
     or v_floor_1_pm <> 500
     or v_floor_5_pm <> 999
     or v_floor_10_pm <> 1550
     or v_floor_15_pm <> 2150
     or v_floor_20_pm <> 2678
     or v_floor_25_pm <> 2950
     or v_floor_100_pm <> 12000
     or v_floor_1_floor <> 'D'
     or v_floor_1_ceiling <> 'C'
     or v_floor_100_floor <> 'S+'
     or v_floor_100_ceiling <> 'S+' then
    raise exception 'Torre Infinita invalida: las validaciones canonicas no se cumplen.';
  end if;
end;
$validation$;

commit;
