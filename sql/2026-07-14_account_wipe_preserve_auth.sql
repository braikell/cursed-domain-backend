-- Wipe controlado de cuentas tester preservando auth.users.
-- Ejecutar SOLO desde Supabase SQL Editor, despues de revisar el diagnostico.
-- Borra progreso y datos derivados. Mantiene auth.users y profiles.

begin;

select pg_advisory_xact_lock(hashtext('cursed_domain_account_wipe_preserve_auth_2026_07_14'));

create temporary table if not exists tmp_account_wipe_result (
  step_order int not null,
  table_name text not null,
  rows_before bigint,
  rows_deleted bigint,
  rows_after bigint,
  status text not null
) on commit preserve rows;

truncate table tmp_account_wipe_result;

do $$
declare
  wipe_tables text[] := array[
    'public.idempotency_keys',
    'public.user_player_xp_grants',
    'public.user_pvp_matches',
    'public.user_pvp_battle_logs',
    'public.user_pvp_profiles',
    'public.friend_requests',
    'public.user_friends',
    'public.user_tower_floor_clears',
    'public.user_tower_progress',
    'public.user_pack_limits',
    'public.user_pity',
    'public.user_missions',
    'public.user_afk',
    'public.user_formation_slots',
    'public.user_formations',
    'public.user_inventory',
    'public.user_materials',
    'public.user_cards',
    'public.player_progress',
    'public.user_economy',
    'public.player_saves'
  ];
  table_name text;
  rows_before bigint;
  rows_deleted bigint;
  rows_after bigint;
  step_order int := 0;
begin
  foreach table_name in array wipe_tables loop
    step_order := step_order + 1;

    if to_regclass(table_name) is null then
      insert into tmp_account_wipe_result(step_order, table_name, rows_before, rows_deleted, rows_after, status)
      values (step_order, table_name, null, null, null, 'missing');
    else
      execute format('select count(*)::bigint from %s', table_name)
      into rows_before;

      execute format('delete from %s', table_name);
      get diagnostics rows_deleted = row_count;

      execute format('select count(*)::bigint from %s', table_name)
      into rows_after;

      insert into tmp_account_wipe_result(step_order, table_name, rows_before, rows_deleted, rows_after, status)
      values (step_order, table_name, rows_before, rows_deleted, rows_after, 'wiped');
    end if;
  end loop;
end $$;

do $$
declare
  set_clauses text[] := array[]::text[];
  rows_before bigint := 0;
  rows_updated bigint := 0;
begin
  if to_regclass('public.profiles') is null then
    insert into tmp_account_wipe_result(step_order, table_name, rows_before, rows_deleted, rows_after, status)
    values (900, 'public.profiles', null, null, null, 'missing');
    return;
  end if;

  select count(*)::bigint into rows_before from public.profiles;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles' and column_name = 'onboarding_seen'
  ) then
    set_clauses := array_append(set_clauses, 'onboarding_seen = false');
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles' and column_name = 'avatar_card_id'
  ) then
    set_clauses := array_append(set_clauses, 'avatar_card_id = null');
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles' and column_name = 'profile_backdrop'
  ) then
    set_clauses := array_append(set_clauses, $$profile_backdrop = 'eclipse'$$);
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles' and column_name = 'display_name_changed_at'
  ) then
    set_clauses := array_append(set_clauses, 'display_name_changed_at = null');
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles' and column_name = 'updated_at'
  ) then
    set_clauses := array_append(set_clauses, 'updated_at = now()');
  end if;

  if array_length(set_clauses, 1) is null then
    insert into tmp_account_wipe_result(step_order, table_name, rows_before, rows_deleted, rows_after, status)
    values (900, 'public.profiles', rows_before, 0, rows_before, 'no_reset_columns');
    return;
  end if;

  execute format('update public.profiles set %s', array_to_string(set_clauses, ', '));
  get diagnostics rows_updated = row_count;

  insert into tmp_account_wipe_result(step_order, table_name, rows_before, rows_deleted, rows_after, status)
  values (900, 'public.profiles', rows_before, rows_updated, rows_before, 'reset_only');
end $$;

do $$
declare
  auth_user_count bigint := 0;
  profile_count bigint := 0;
begin
  select count(*)::bigint into auth_user_count from auth.users;

  if to_regclass('public.profiles') is not null then
    select count(*)::bigint into profile_count from public.profiles;
  end if;

  if auth_user_count <= 0 then
    raise exception 'Safety check failed: auth.users has no rows after wipe transaction.';
  end if;

  if profile_count > auth_user_count then
    raise exception 'Safety check failed: profiles count (%) exceeds auth.users count (%).', profile_count, auth_user_count;
  end if;
end $$;

commit;

select table_name, rows_before, rows_deleted, rows_after, status
from tmp_account_wipe_result
order by step_order, table_name;

-- Verificacion esperada despues del wipe:
-- 1) auth.users debe conservar sus 9 usuarios.
-- 2) public.profiles debe conservar sus perfiles, con onboarding_seen=false.
-- 3) Las tablas de progreso deben quedar en 0 y se recrearan por bootstrap al login.
