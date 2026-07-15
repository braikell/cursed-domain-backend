-- 05 - Filas que el limpiador consideraria antiguas.
-- Ejecutar en Supabase SQL Editor. No modifica datos.

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
  'pack_open_logs_v1_14d' as cleanup_target,
  count(*)::bigint as stale_rows
from public.pack_open_logs_v1
where created_at < now() - interval '14 days'
union all
select
  'economy_logs_14d' as cleanup_target,
  count(*)::bigint as stale_rows
from public.economy_logs
where created_at < now() - interval '14 days'
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
