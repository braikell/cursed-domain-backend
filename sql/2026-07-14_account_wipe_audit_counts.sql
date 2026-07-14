-- Auditoria no destructiva previa al wipe de cuentas.
-- No borra ni modifica datos. Ejecutar en Supabase SQL Editor para medir
-- volumen por tabla antes de crear el script de wipe definitivo.

create temporary table if not exists tmp_account_wipe_audit_counts (
  table_name text primary key,
  row_count bigint,
  status text not null
) on commit drop;

truncate table tmp_account_wipe_audit_counts;

do $$
declare
  table_names text[] := array[
    'auth.users',
    'public.profiles',
    'public.player_saves',
    'public.player_progress',
    'public.user_economy',
    'public.user_cards',
    'public.user_formations',
    'public.user_formation_slots',
    'public.user_inventory',
    'public.user_materials',
    'public.user_afk',
    'public.user_missions',
    'public.user_pity',
    'public.user_pack_limits',
    'public.user_tower_progress',
    'public.user_tower_floor_clears',
    'public.user_pvp_profiles',
    'public.user_pvp_matches',
    'public.user_pvp_battle_logs',
    'public.user_player_xp_grants',
    'public.idempotency_keys',
    'public.friend_requests',
    'public.user_friends'
  ];
  table_name text;
  table_count bigint;
begin
  foreach table_name in array table_names loop
    if to_regclass(table_name) is null then
      insert into tmp_account_wipe_audit_counts(table_name, row_count, status)
      values (table_name, null, 'missing');
    else
      execute format('select count(*)::bigint from %s', table_name)
      into table_count;

      insert into tmp_account_wipe_audit_counts(table_name, row_count, status)
      values (table_name, table_count, 'ok');
    end if;
  end loop;
end $$;

select table_name, row_count, status
from tmp_account_wipe_audit_counts
order by table_name;
