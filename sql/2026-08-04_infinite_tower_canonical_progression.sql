-- Torre Infinita: progresion canonica de PM para los 100 pisos.
--
-- Anclas de dificultad:
--   Piso 1   = 500 PM   (inicio accesible)
--   Piso 25  = 1800 PM  (fin del tramo facil)
--   Piso 50  = 4200 PM  (fin del tramo medio)
--   Piso 75  = 7000 PM  (fin del tramo alto)
--   Piso 100 = 9999 PM  (jefe final)
--
-- La curva es piecewise y estrictamente ascendente. Esta migracion conserva
-- las recompensas existentes y solo normaliza/actualiza la dificultad PM.
begin;

create or replace function public.tower_canonical_target_pm(p_floor_number integer)
returns integer
language sql
immutable
strict
parallel safe
as $function$
with normalized as (
  select greatest(1, least(100, p_floor_number))::double precision as floor_number
), curve as (
  select
    floor_number,
    case
      when floor_number <= 25 then 500.0
      when floor_number <= 50 then 1800.0
      when floor_number <= 75 then 4200.0
      else 7000.0
    end as start_pm,
    case
      when floor_number <= 25 then 1800.0
      when floor_number <= 50 then 4200.0
      when floor_number <= 75 then 7000.0
      else 9999.0
    end as end_pm,
    case
      when floor_number <= 25 then (floor_number - 1.0) / 24.0
      when floor_number <= 50 then (floor_number - 25.0) / 25.0
      when floor_number <= 75 then (floor_number - 50.0) / 25.0
      else (floor_number - 75.0) / 25.0
    end as progress,
    case
      when floor_number <= 25 then 1.15
      when floor_number <= 50 then 1.10
      when floor_number <= 75 then 1.08
      else 1.12
    end as exponent
  from normalized
)
select case
  when floor_number <= 1 then 500
  when floor_number >= 100 then 9999
  else round(start_pm + (end_pm - start_pm) * power(progress, exponent))::integer
end
from curve;
$function$;

alter table public.tower_floor_definitions
  add column if not exists reward_xp integer not null default 0,
  add column if not exists replay_xp integer not null default 0;

-- Crea los pisos 51-100 si aun no existen. Las recompensas se heredan de
-- la tabla original para conservar el balance economico ya definido.
with generated_floors as (
  select
    floor_number,
    least(50, floor_number / 5 * 5) as legacy_boss_floor_number,
    least(50, ceil(floor_number / 2.0)::int) as legacy_floor_number
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
on conflict (floor_number) do nothing;

-- Fuente unica de verdad: todos los pisos, incluidos los 1-50 existentes.
update public.tower_floor_definitions
set
  target_pm = public.tower_canonical_target_pm(floor_number),
  updated_at = now()
where floor_number between 1 and 100;

-- Fail fast: la migracion no puede dejar una curva incompleta o regresiva.
do $validation$
declare
  v_floor_count integer;
  v_non_monotonic_count integer;
  v_max_pm_count integer;
  v_floor_1_pm integer;
  v_floor_25_pm integer;
  v_floor_50_pm integer;
  v_floor_75_pm integer;
  v_floor_100_pm integer;
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

  if v_non_monotonic_count <> 0 then
    raise exception 'Torre Infinita invalida: la progresion PM no es estrictamente ascendente.';
  end if;

  select count(*) into v_max_pm_count
  from public.tower_floor_definitions
  where floor_number between 1 and 100 and target_pm = 9999;

  select target_pm into v_floor_1_pm from public.tower_floor_definitions where floor_number = 1;
  select target_pm into v_floor_25_pm from public.tower_floor_definitions where floor_number = 25;
  select target_pm into v_floor_50_pm from public.tower_floor_definitions where floor_number = 50;
  select target_pm into v_floor_75_pm from public.tower_floor_definitions where floor_number = 75;
  select target_pm into v_floor_100_pm from public.tower_floor_definitions where floor_number = 100;

  if v_floor_1_pm <> 500 or v_floor_25_pm <> 1800 or v_floor_50_pm <> 4200
     or v_floor_75_pm <> 7000 or v_floor_100_pm <> 9999 or v_max_pm_count <> 1 then
    raise exception 'Torre Infinita invalida: anclas PM inesperadas.';
  end if;
end;
$validation$;

commit;
