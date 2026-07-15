-- 06 - Estado de battle_sessions para Fase 2.
-- Ejecutar en Supabase SQL Editor despues de instalar 2026-07-15_battle_sessions_free_plan.sql.
-- No modifica datos.

select
  count(*)::bigint as rows,
  count(*) filter (where consumed_at is null and expires_at > now())::bigint as active_rows,
  count(*) filter (where consumed_at is not null)::bigint as consumed_rows,
  count(*) filter (where consumed_at is null and expires_at <= now())::bigint as expired_open_rows,
  pg_size_pretty(pg_total_relation_size('public.battle_sessions')) as total_size,
  pg_total_relation_size('public.battle_sessions') as total_bytes
from public.battle_sessions;
