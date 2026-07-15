-- Fase 1: instalador seguro del limpiador diario Supabase Free.
--
-- Este script crea:
-- - public.free_plan_cleanup_audit
-- - public.daily_cleanup_free_plan(p_dry_run boolean, p_batch_limit int)
-- - indices de limpieza en tablas historicas existentes
--
-- Aplicar este SQL no borra datos.
-- Para probar sin borrar:
--   select public.daily_cleanup_free_plan(true);
--
-- Para ejecutar limpieza real manual:
--   select public.daily_cleanup_free_plan(false);
--
-- Para automatizar en Supabase:
--   usar pg_cron desde SQL Editor si el proyecto lo tiene habilitado,
--   o programar una llamada diaria desde el dashboard/servicio externo.

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

-- Indices para que la limpieza sea barata. Cada bloque verifica que la tabla exista.
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
        -- Temporary combat/session rows. These tables may not exist yet; skipped safely.
        ('battle_sessions_expired_48h', 'public.battle_sessions', 'expires_at', 'expires_at < now() - interval ''48 hours'''),
        ('battle_sessions_consumed_24h', 'public.battle_sessions', 'consumed_at', 'consumed_at is not null and consumed_at < now() - interval ''24 hours'''),

        -- Idempotency. Purchase operations get a longer window than normal gameplay actions.
        ('idempotency_non_purchase_7d', 'public.idempotency_keys', 'created_at', 'created_at < now() - interval ''7 days'' and operation not ilike ''%purchase_pack%'''),
        ('idempotency_all_14d', 'public.idempotency_keys', 'created_at', 'created_at < now() - interval ''14 days'''),

        -- PvP detail history. Permanent aggregate state lives in user_pvp_profiles.
        ('pvp_started_expired_48h', 'public.user_pvp_matches', 'expires_at', 'status in (''started'', ''expired'') and expires_at < now() - interval ''48 hours'''),
        ('pvp_completed_matches_14d', 'public.user_pvp_matches', 'completed_at', 'status = ''completed'' and completed_at < now() - interval ''14 days'''),
        ('pvp_battle_logs_14d', 'public.user_pvp_battle_logs', 'created_at', 'created_at < now() - interval ''14 days'''),
        ('pack_open_logs_v1_14d', 'public.pack_open_logs_v1', 'created_at', 'created_at < now() - interval ''14 days'''),
        ('economy_logs_14d', 'public.economy_logs', 'created_at', 'created_at < now() - interval ''14 days'''),

        -- Daily mission/chest snapshots are daily state, not permanent progression.
        ('daily_mission_state_21d', 'public.user_daily_mission_state', 'reset_date', 'reset_date < current_date - 21'),
        ('daily_chest_state_21d', 'public.user_daily_chest_state', 'reset_date', 'reset_date < current_date - 21'),

        -- Player XP grant ledger protects recent idempotency; old applied rows become history.
        ('player_xp_grants_pending_2d', 'public.user_player_xp_grants', 'created_at', 'status = ''pending'' and created_at < now() - interval ''2 days'''),
        ('player_xp_grants_applied_30d', 'public.user_player_xp_grants', 'created_at', 'status = ''applied'' and created_at < now() - interval ''30 days'''),

        -- Cleanup audit is useful, but should not grow forever.
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

-- Optional pg_cron setup.
-- Run only if pg_cron is enabled in your Supabase project and you want DB-native scheduling.
--
-- create extension if not exists pg_cron with schema extensions;
--
-- select cron.schedule(
--   'cursed-domain-free-plan-daily-cleanup',
--   '15 5 * * *',
--   $$select public.daily_cleanup_free_plan(false);$$
-- );
