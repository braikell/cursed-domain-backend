-- 01 - Estado general de la base contra objetivo 20%.
-- Ejecutar en Supabase SQL Editor. No modifica datos.

select
  current_database() as database_name,
  pg_size_pretty(pg_database_size(current_database())) as database_size,
  pg_database_size(current_database()) as database_bytes,
  pg_size_pretty((100::bigint * 1024 * 1024)) as green_target,
  pg_size_pretty((120::bigint * 1024 * 1024)) as warning_target,
  pg_size_pretty((150::bigint * 1024 * 1024)) as internal_stop,
  case
    when pg_database_size(current_database()) < (100::bigint * 1024 * 1024) then 'green'
    when pg_database_size(current_database()) < (120::bigint * 1024 * 1024) then 'yellow'
    when pg_database_size(current_database()) < (150::bigint * 1024 * 1024) then 'red'
    else 'stop'
  end as free_plan_status;
