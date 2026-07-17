-- ============================================================
-- Original: 2026-07-15_free_plan_daily_cleanup.sql
-- ============================================================
begin;

create table if not exists public.free_plan_cleanup_audit (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  dry_run boolean not null default false,
  status text not null default 'running',
  deleted_counts jsonb not null default '{}'::jsonb,
  database_size_before bigint,
  database_size_after bigint,
  error_message text,
  created_at timestamptz not null default now(),
  check (status in ('running', 'ok', 'failed'))
);

create index if not exists free_plan_cleanup_audit_created_idx
  on public.free_plan_cleanup_audit (created_at);

do $$
begin
  if to_regclass('public.idempotency_keys') is not null then
    create index if not exists idempotency_keys_created_cleanup_idx
      on public.idempotency_keys (created_at);
  end if;

  if to_regclass('public.user_pvp_matches') is not null then
    create index if not exists user_pvp_matches_cleanup_created_idx
      on public.user_pvp_matches (status, created_at);
    create index if not exists user_pvp_matches_cleanup_completed_idx
      on public.user_pvp_matches (status, completed_at);
    create index if not exists user_pvp_matches_cleanup_expires_idx
      on public.user_pvp_matches (status, expires_at);
  end if;

  if to_regclass('public.user_pvp_battle_logs') is not null then
    create index if not exists user_pvp_battle_logs_cleanup_created_idx
      on public.user_pvp_battle_logs (created_at);
  end if;

  if to_regclass('public.pack_open_logs_v1') is not null then
    if exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'pack_open_logs_v1'
        and column_name = 'created_at'
    ) then
      create index if not exists pack_open_logs_v1_cleanup_created_idx
        on public.pack_open_logs_v1 (created_at);
    end if;
  end if;

  if to_regclass('public.economy_logs') is not null then
    if exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'economy_logs'
        and column_name = 'created_at'
    ) then
      create index if not exists economy_logs_cleanup_created_idx
        on public.economy_logs (created_at);
    end if;
  end if;

  if to_regclass('public.user_daily_mission_state') is not null then
    create index if not exists user_daily_mission_state_cleanup_reset_idx
      on public.user_daily_mission_state (reset_date);
  end if;

  if to_regclass('public.user_daily_chest_state') is not null then
    create index if not exists user_daily_chest_state_cleanup_reset_idx
      on public.user_daily_chest_state (reset_date);
  end if;

  if to_regclass('public.user_player_xp_grants') is not null then
    create index if not exists user_player_xp_grants_cleanup_created_idx
      on public.user_player_xp_grants (status, created_at);
  end if;

  if to_regclass('public.battle_sessions') is not null then
    create index if not exists battle_sessions_cleanup_expires_idx
      on public.battle_sessions (expires_at);
    create index if not exists battle_sessions_cleanup_consumed_idx
      on public.battle_sessions (consumed_at);
  end if;
end $$;

create or replace function public.daily_cleanup_free_plan(
  p_dry_run boolean default false,
  p_batch_limit int default 5000
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_audit_id uuid;
  v_limit int := greatest(1, least(coalesce(p_batch_limit, 5000), 20000));
  v_database_size_before bigint := pg_database_size(current_database());
  v_database_size_after bigint;
  v_deleted_counts jsonb := '{}'::jsonb;
  v_target record;
  v_count bigint := 0;
  v_sql text;
begin
  insert into public.free_plan_cleanup_audit (
    dry_run,
    database_size_before
  )
  values (
    p_dry_run,
    v_database_size_before
  )
  returning id into v_audit_id;

  for v_target in
    select *
    from (
      values
        ('battle_sessions_expired_48h', 'public.battle_sessions', 'expires_at', 'expires_at < now() - interval ''48 hours'''),
        ('battle_sessions_consumed_24h', 'public.battle_sessions', 'consumed_at', 'consumed_at is not null and consumed_at < now() - interval ''24 hours'''),
        ('idempotency_non_purchase_7d', 'public.idempotency_keys', 'created_at', 'created_at < now() - interval ''7 days'' and operation not ilike ''%purchase_pack%'''),
        ('idempotency_all_14d', 'public.idempotency_keys', 'created_at', 'created_at < now() - interval ''14 days'''),
        ('pvp_started_expired_48h', 'public.user_pvp_matches', 'expires_at', 'status in (''started'', ''expired'') and expires_at < now() - interval ''48 hours'''),
        ('pvp_completed_matches_14d', 'public.user_pvp_matches', 'completed_at', 'status = ''completed'' and completed_at < now() - interval ''14 days'''),
        ('pvp_battle_logs_14d', 'public.user_pvp_battle_logs', 'created_at', 'created_at < now() - interval ''14 days'''),
        ('pack_open_logs_v1_14d', 'public.pack_open_logs_v1', 'created_at', 'created_at < now() - interval ''14 days'''),
        ('economy_logs_14d', 'public.economy_logs', 'created_at', 'created_at < now() - interval ''14 days'''),
        ('daily_mission_state_21d', 'public.user_daily_mission_state', 'reset_date', 'reset_date < current_date - 21'),
        ('daily_chest_state_21d', 'public.user_daily_chest_state', 'reset_date', 'reset_date < current_date - 21'),
        ('player_xp_grants_pending_2d', 'public.user_player_xp_grants', 'created_at', 'status = ''pending'' and created_at < now() - interval ''2 days'''),
        ('player_xp_grants_applied_30d', 'public.user_player_xp_grants', 'created_at', 'status = ''applied'' and created_at < now() - interval ''30 days'''),
        ('cleanup_audit_30d', 'public.free_plan_cleanup_audit', 'created_at', 'created_at < now() - interval ''30 days''')
    ) as t(label, table_name, required_column, predicate_sql)
  loop
    if to_regclass(v_target.table_name) is null then
      v_deleted_counts := v_deleted_counts || jsonb_build_object(v_target.label, jsonb_build_object(
        'status', 'missing_table',
        'rows', 0
      ));
      continue;
    end if;

    if not exists (
      select 1
      from information_schema.columns
      where table_schema = split_part(v_target.table_name, '.', 1)
        and table_name = split_part(v_target.table_name, '.', 2)
        and column_name = v_target.required_column
    ) then
      v_deleted_counts := v_deleted_counts || jsonb_build_object(v_target.label, jsonb_build_object(
        'status', 'missing_column',
        'rows', 0
      ));
      continue;
    end if;

    if p_dry_run then
      v_sql := format(
        'select count(*)::bigint from %s where %s',
        v_target.table_name,
        v_target.predicate_sql
      );
      execute v_sql into v_count;
    else
      v_sql := format(
        'with doomed as (
           select ctid
           from %s
           where %s
           limit %s
         ),
         deleted as (
           delete from %s target
           using doomed
           where target.ctid = doomed.ctid
           returning 1
         )
         select count(*)::bigint from deleted',
        v_target.table_name,
        v_target.predicate_sql,
        v_limit,
        v_target.table_name
      );
      execute v_sql into v_count;
    end if;

    v_deleted_counts := v_deleted_counts || jsonb_build_object(v_target.label, jsonb_build_object(
      'status', case when p_dry_run then 'dry_run' else 'deleted' end,
      'rows', coalesce(v_count, 0)
    ));
  end loop;

  v_database_size_after := pg_database_size(current_database());

  update public.free_plan_cleanup_audit
  set
    finished_at = now(),
    status = 'ok',
    deleted_counts = v_deleted_counts,
    database_size_after = v_database_size_after
  where id = v_audit_id;

  return jsonb_build_object(
    'ok', true,
    'dryRun', p_dry_run,
    'auditId', v_audit_id,
    'databaseSizeBefore', v_database_size_before,
    'databaseSizeAfter', v_database_size_after,
    'counts', v_deleted_counts
  );
exception
  when others then
    update public.free_plan_cleanup_audit
    set
      finished_at = now(),
      status = 'failed',
      error_message = sqlerrm,
      deleted_counts = v_deleted_counts,
      database_size_after = pg_database_size(current_database())
    where id = v_audit_id;

    raise;
end;
$$;

revoke all on function public.daily_cleanup_free_plan(boolean, int) from public;
revoke all on function public.daily_cleanup_free_plan(boolean, int) from anon;
revoke all on function public.daily_cleanup_free_plan(boolean, int) from authenticated;
grant execute on function public.daily_cleanup_free_plan(boolean, int) to service_role;

commit;

-- ============================================================
-- Original: 2026-07-15_free_plan_direct_queries.sql
-- ============================================================
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

-- ============================================================
-- Original: 2026-07-15_free_plan_usage_report.sql
-- ============================================================
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

-- ============================================================
-- Original: free_plan_checks/01_database_status.sql
-- ============================================================
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

-- ============================================================
-- Original: free_plan_checks/02_top_public_tables.sql
-- ============================================================
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

-- ============================================================
-- Original: free_plan_checks/03_live_state_counts.sql
-- ============================================================
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

-- ============================================================
-- Original: free_plan_checks/04_history_counts.sql
-- ============================================================
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

-- ============================================================
-- Original: free_plan_checks/05_cleanup_candidates.sql
-- ============================================================
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

-- ============================================================
-- Original: free_plan_checks/06_battle_sessions_status.sql
-- ============================================================
select
  count(*)::bigint as rows,
  count(*) filter (where consumed_at is null and expires_at > now())::bigint as active_rows,
  count(*) filter (where consumed_at is not null)::bigint as consumed_rows,
  count(*) filter (where consumed_at is null and expires_at <= now())::bigint as expired_open_rows,
  pg_size_pretty(pg_total_relation_size('public.battle_sessions')) as total_size,
  pg_total_relation_size('public.battle_sessions') as total_bytes
from public.battle_sessions;
