-- Fase 0: auditoria no destructiva de uso Supabase Free.
-- No borra ni modifica datos. Ejecutar en Supabase SQL Editor.
--
-- Objetivo de beta cerrada:
-- - DB verde 20% practico: < 100 MB
-- - DB alerta: 100-120 MB
-- - DB rojo: 120-150 MB
-- - DB stop interno: 150 MB
-- - DB techo protegido 45% Free: 225 MB

create temporary table if not exists tmp_free_plan_usage_tables (
  table_name text primary key,
  retention_column text,
  retention_days int,
  exact_rows bigint,
  stale_rows bigint,
  total_bytes bigint,
  table_bytes bigint,
  index_bytes bigint,
  status text not null
) on commit drop;

truncate table tmp_free_plan_usage_tables;

do $$
declare
  target record;
  exact_count bigint;
  stale_count bigint;
  relation regclass;
  has_retention_column boolean;
begin
  for target in
    select *
    from (
      values
        ('public.profiles', null, null),
        ('public.player_saves', 'updated_at', null),
        ('public.player_progress', 'updated_at', null),
        ('public.user_economy', 'updated_at', null),
        ('public.user_cards', 'updated_at', null),
        ('public.user_formations', 'updated_at', null),
        ('public.user_formation_slots', null, null),
        ('public.user_inventory', 'updated_at', null),
        ('public.user_materials', 'updated_at', null),
        ('public.user_afk', 'updated_at', null),
        ('public.user_missions', 'updated_at', 21),
        ('public.user_daily_mission_state', 'reset_date', 21),
        ('public.user_daily_chest_state', 'reset_date', 21),
        ('public.user_pity', 'updated_at', null),
        ('public.user_pack_limits', 'window_ends_at', null),
        ('public.user_tower_progress', 'updated_at', null),
        ('public.user_tower_floor_clears', 'last_cleared_at', null),
        ('public.user_pvp_profiles', 'updated_at', null),
        ('public.user_pvp_matches', 'created_at', 14),
        ('public.user_pvp_battle_logs', 'created_at', 14),
        ('public.pack_open_logs_v1', 'created_at', 14),
        ('public.economy_logs', 'created_at', 14),
        ('public.user_player_xp_grants', 'created_at', 30),
        ('public.idempotency_keys', 'created_at', 7),
        ('public.friend_requests', 'updated_at', 30),
        ('public.user_friends', 'created_at', null),
        ('public.battle_sessions', 'expires_at', 2),
        ('public.free_plan_cleanup_audit', 'created_at', 30)
    ) as t(table_name, retention_column, retention_days)
  loop
    relation := to_regclass(target.table_name);
    if relation is null then
      insert into tmp_free_plan_usage_tables(table_name, retention_column, retention_days, status)
      values (target.table_name, target.retention_column, target.retention_days, 'missing');
      continue;
    end if;

    execute format('select count(*)::bigint from %s', target.table_name)
    into exact_count;

    stale_count := null;
    if target.retention_column is not null and target.retention_days is not null then
      select exists (
        select 1
        from information_schema.columns
        where table_schema = split_part(target.table_name, '.', 1)
          and table_name = split_part(target.table_name, '.', 2)
          and column_name = target.retention_column
      )
      into has_retention_column;

      if has_retention_column then
        execute format(
          'select count(*)::bigint from %s where %I < now() - (%L || '' days'')::interval',
          target.table_name,
          target.retention_column,
          target.retention_days::text
        )
        into stale_count;
      end if;
    end if;

    insert into tmp_free_plan_usage_tables(
      table_name,
      retention_column,
      retention_days,
      exact_rows,
      stale_rows,
      total_bytes,
      table_bytes,
      index_bytes,
      status
    )
    values (
      target.table_name,
      target.retention_column,
      target.retention_days,
      exact_count,
      stale_count,
      pg_total_relation_size(relation),
      pg_relation_size(relation),
      pg_indexes_size(relation),
      'ok'
    );
  end loop;
end $$;

-- Resumen general contra el contrato Free Plan ultra-bajo.
select
  current_database() as database_name,
  pg_size_pretty(pg_database_size(current_database())) as database_size,
  pg_database_size(current_database()) as database_bytes,
  pg_size_pretty((100::bigint * 1024 * 1024)) as green_target,
  pg_size_pretty((120::bigint * 1024 * 1024)) as warning_target,
  pg_size_pretty((150::bigint * 1024 * 1024)) as internal_stop,
  pg_size_pretty((225::bigint * 1024 * 1024)) as protected_ceiling,
  case
    when pg_database_size(current_database()) < (100::bigint * 1024 * 1024) then 'green'
    when pg_database_size(current_database()) < (120::bigint * 1024 * 1024) then 'yellow'
    when pg_database_size(current_database()) < (150::bigint * 1024 * 1024) then 'red'
    else 'stop'
  end as free_plan_status;

-- Detalle por tabla monitoreada.
select
  table_name,
  status,
  exact_rows,
  stale_rows,
  retention_column,
  retention_days,
  pg_size_pretty(coalesce(total_bytes, 0)) as total_size,
  pg_size_pretty(coalesce(table_bytes, 0)) as table_size,
  pg_size_pretty(coalesce(index_bytes, 0)) as index_size,
  total_bytes
from tmp_free_plan_usage_tables
order by coalesce(total_bytes, 0) desc, table_name;

-- Candidatos de limpieza: filas antiguas o tablas historicas que estan creciendo.
select
  table_name,
  exact_rows,
  stale_rows,
  retention_column,
  retention_days,
  pg_size_pretty(coalesce(total_bytes, 0)) as total_size
from tmp_free_plan_usage_tables
where status = 'ok'
  and (
    coalesce(stale_rows, 0) > 0
    or table_name in (
      'public.idempotency_keys',
      'public.user_pvp_matches',
      'public.user_pvp_battle_logs',
      'public.pack_open_logs_v1',
      'public.economy_logs',
      'public.user_daily_mission_state',
      'public.user_daily_chest_state',
      'public.user_player_xp_grants',
      'public.battle_sessions',
      'public.free_plan_cleanup_audit'
    )
  )
order by coalesce(stale_rows, 0) desc, coalesce(total_bytes, 0) desc, table_name;

-- Conteo rapido de estado vivo por usuario, util para detectar testers con loops o datos anormales.
select
  'player_saves' as source,
  count(*)::bigint as rows,
  count(distinct user_id)::bigint as users
from public.player_saves
where to_regclass('public.player_saves') is not null
union all
select
  'user_cards' as source,
  count(*)::bigint as rows,
  count(distinct user_id)::bigint as users
from public.user_cards
where to_regclass('public.user_cards') is not null
union all
select
  'user_inventory' as source,
  count(*)::bigint as rows,
  count(distinct user_id)::bigint as users
from public.user_inventory
where to_regclass('public.user_inventory') is not null
union all
select
  'user_materials' as source,
  count(*)::bigint as rows,
  count(distinct user_id)::bigint as users
from public.user_materials
where to_regclass('public.user_materials') is not null;
