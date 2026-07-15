-- Queries directas para revisar Supabase Free sin borrar nada.
-- Ejecutar una por una en Supabase SQL Editor.

-- 1) Estado general de la base contra objetivo 20%.
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

-- 2) Top 20 tablas publicas mas grandes.
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

-- 3) Estado vivo principal por usuario.
select
  'player_saves' as source,
  count(*)::bigint as rows,
  count(distinct user_id)::bigint as users
from public.player_saves
union all
select
  'user_cards' as source,
  count(*)::bigint as rows,
  count(distinct user_id)::bigint as users
from public.user_cards
union all
select
  'user_inventory' as source,
  count(*)::bigint as rows,
  count(distinct user_id)::bigint as users
from public.user_inventory
union all
select
  'user_materials' as source,
  count(*)::bigint as rows,
  count(distinct user_id)::bigint as users
from public.user_materials;

-- 4) Historial y basura potencial: conteos actuales.
select 'idempotency_keys' as table_name, count(*)::bigint as rows from public.idempotency_keys
union all
select 'user_pvp_matches' as table_name, count(*)::bigint as rows from public.user_pvp_matches
union all
select 'user_pvp_battle_logs' as table_name, count(*)::bigint as rows from public.user_pvp_battle_logs
union all
select 'user_daily_mission_state' as table_name, count(*)::bigint as rows from public.user_daily_mission_state
union all
select 'user_daily_chest_state' as table_name, count(*)::bigint as rows from public.user_daily_chest_state
union all
select 'user_player_xp_grants' as table_name, count(*)::bigint as rows from public.user_player_xp_grants
union all
select 'battle_sessions' as table_name, count(*)::bigint as rows from public.battle_sessions;

-- 5) Filas que el limpiador consideraria antiguas.
select
  'idempotency_non_purchase_7d' as cleanup_target,
  count(*)::bigint as stale_rows
from public.idempotency_keys
where created_at < now() - interval '7 days'
  and operation not ilike '%purchase_pack%'
union all
select
  'idempotency_all_14d' as cleanup_target,
  count(*)::bigint as stale_rows
from public.idempotency_keys
where created_at < now() - interval '14 days'
union all
select
  'pvp_started_expired_48h' as cleanup_target,
  count(*)::bigint as stale_rows
from public.user_pvp_matches
where status in ('started', 'expired')
  and expires_at < now() - interval '48 hours'
union all
select
  'pvp_completed_matches_14d' as cleanup_target,
  count(*)::bigint as stale_rows
from public.user_pvp_matches
where status = 'completed'
  and completed_at < now() - interval '14 days'
union all
select
  'pvp_battle_logs_14d' as cleanup_target,
  count(*)::bigint as stale_rows
from public.user_pvp_battle_logs
where created_at < now() - interval '14 days'
union all
select
  'battle_sessions_expired_48h' as cleanup_target,
  count(*)::bigint as stale_rows
from public.battle_sessions
where expires_at < now() - interval '48 hours'
union all
select
  'battle_sessions_consumed_24h' as cleanup_target,
  count(*)::bigint as stale_rows
from public.battle_sessions
where consumed_at is not null
  and consumed_at < now() - interval '24 hours'
union all
select
  'daily_mission_state_21d' as cleanup_target,
  count(*)::bigint as stale_rows
from public.user_daily_mission_state
where reset_date < current_date - 21
union all
select
  'daily_chest_state_21d' as cleanup_target,
  count(*)::bigint as stale_rows
from public.user_daily_chest_state
where reset_date < current_date - 21
union all
select
  'player_xp_grants_pending_2d' as cleanup_target,
  count(*)::bigint as stale_rows
from public.user_player_xp_grants
where status = 'pending'
  and created_at < now() - interval '2 days'
union all
select
  'player_xp_grants_applied_30d' as cleanup_target,
  count(*)::bigint as stale_rows
from public.user_player_xp_grants
where status = 'applied'
  and created_at < now() - interval '30 days';
