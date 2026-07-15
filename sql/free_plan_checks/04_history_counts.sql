-- 04 - Historial y basura potencial: conteos actuales.
-- Ejecutar en Supabase SQL Editor. No modifica datos.

select 'idempotency_keys' as table_name, count(*)::bigint as rows from public.idempotency_keys
union all
select 'user_pvp_matches' as table_name, count(*)::bigint as rows from public.user_pvp_matches
union all
select 'user_pvp_battle_logs' as table_name, count(*)::bigint as rows from public.user_pvp_battle_logs
union all
select 'pack_open_logs_v1' as table_name, count(*)::bigint as rows from public.pack_open_logs_v1
union all
select 'economy_logs' as table_name, count(*)::bigint as rows from public.economy_logs
union all
select 'user_daily_mission_state' as table_name, count(*)::bigint as rows from public.user_daily_mission_state
union all
select 'user_daily_chest_state' as table_name, count(*)::bigint as rows from public.user_daily_chest_state
union all
select 'user_player_xp_grants' as table_name, count(*)::bigint as rows from public.user_player_xp_grants
union all
select 'battle_sessions' as table_name, count(*)::bigint as rows from public.battle_sessions;
