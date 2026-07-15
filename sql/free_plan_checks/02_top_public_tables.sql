-- 02 - Top 20 tablas publicas mas grandes.
-- Ejecutar en Supabase SQL Editor. No modifica datos.

select
  schemaname || '.' || relname as table_name,
  n_live_tup::bigint as estimated_rows,
  pg_size_pretty(pg_total_relation_size(relid)) as total_size,
  pg_size_pretty(pg_relation_size(relid)) as table_size,
  pg_size_pretty(pg_indexes_size(relid)) as index_size,
  pg_total_relation_size(relid) as total_bytes
from pg_stat_user_tables
where schemaname = 'public'
order by pg_total_relation_size(relid) desc
limit 20;
