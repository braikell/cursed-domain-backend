-- ============================================================
-- Original: 2026-07-12_card_fragment_source_of_truth_repair.sql
-- ============================================================
begin;

with mirrored_fragment_rows as (
  select
    uc.id,
    coalesce(um.quantity, 0)::integer as material_quantity
  from public.user_cards uc
  left join public.user_materials um
    on um.user_id = uc.user_id
   and um.material_id = case
      when upper(coalesce(uc.card_type::text, 'BASE')) = 'DEFINITIVA'
        or lower(coalesce(uc.variant::text, '')) = 'definitive'
        then 'fragment:definitive:' || lower(coalesce(nullif(uc.character_key, ''), uc.character_id))
      else 'fragment:' || lower(coalesce(nullif(uc.character_key, ''), uc.character_id))
    end
)
update public.user_cards uc
set
  fragments = greatest(0, mirrored_fragment_rows.material_quantity),
  updated_at = now()
from mirrored_fragment_rows
where uc.id = mirrored_fragment_rows.id
  and coalesce(uc.fragments, 0) <> greatest(0, mirrored_fragment_rows.material_quantity);

commit;

-- ============================================================
-- Original: 2026-07-14_account_wipe_audit_counts.sql
-- ============================================================
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

-- ============================================================
-- Original: 2026-07-14_account_wipe_preserve_auth.sql
-- ============================================================
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
    set_clauses := array_append(set_clauses, 'profile_backdrop = ''eclipse''');
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

-- ============================================================
-- Original: 2026-07-14_player_xp_grants_ledger.sql
-- ============================================================
begin;

create table if not exists public.user_player_xp_grants (
  user_id uuid not null references auth.users(id) on delete cascade,
  source text not null,
  source_id text not null,
  request_id text not null,
  status text not null default 'pending',
  xp_amount integer not null default 0,
  xp_before integer not null default 0,
  xp_after integer not null default 0,
  level_before integer not null default 1,
  level_after integer not null default 1,
  reward_gold integer not null default 0,
  reward_gems integer not null default 0,
  gems_granted integer not null default 0,
  created_at timestamptz not null default now(),
  applied_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (user_id, source, source_id, request_id),
  check (length(source) > 0),
  check (length(source_id) > 0),
  check (length(request_id) > 0),
  check (status in ('pending', 'applied')),
  check (xp_amount >= 0),
  check (xp_before >= 0),
  check (xp_after >= xp_before),
  check (level_before >= 1),
  check (level_after >= level_before),
  check (reward_gold >= 0),
  check (reward_gems >= 0),
  check (gems_granted >= 0)
);

create index if not exists user_player_xp_grants_user_created_idx
  on public.user_player_xp_grants (user_id, created_at desc);

create index if not exists user_player_xp_grants_source_idx
  on public.user_player_xp_grants (source, source_id);

alter table public.user_player_xp_grants enable row level security;

drop policy if exists user_player_xp_grants_select_own on public.user_player_xp_grants;
create policy user_player_xp_grants_select_own
  on public.user_player_xp_grants
  for select
  to authenticated
  using (auth.uid() = user_id);

grant usage on schema public to authenticated;
grant select on table public.user_player_xp_grants to authenticated;

commit;

-- ============================================================
-- Original: 2026-07-14_resource_namespace_audit.sql
-- ============================================================
with material_rows as (
  select
    user_id,
    material_id,
    quantity,
    case
      when material_id like 'gear_mats:%' then 'gear_mats'
      when material_id like 'element:%' then 'element'
      when material_id like 'fragment:%' then 'fragment'
      else 'invalid'
    end as namespace
  from public.user_materials
),
invalid_material_namespaces as (
  select *
  from material_rows
  where namespace = 'invalid'
     or coalesce(quantity, 0) <= 0
),
save_fragment_rows as (
  select
    ps.user_id,
    entry.key as material_id,
    entry.value as quantity_json,
    case
      when entry.key like 'gear_mats:%' then 'gear_mats'
      when entry.key like 'element:%' then 'element'
      when entry.key like 'fragment:%' then 'fragment'
      else 'invalid'
    end as namespace
  from public.player_saves ps
  cross join lateral jsonb_each(coalesce(ps.save->'fragments', '{}'::jsonb)) as entry(key, value)
),
invalid_save_fragment_namespaces as (
  select *
  from save_fragment_rows
  where namespace = 'invalid'
     or not (jsonb_typeof(quantity_json) = 'number')
     or (quantity_json::text)::numeric <= 0
)
select
  'user_materials' as source,
  count(*) as invalid_rows
from invalid_material_namespaces
union all
select
  'player_saves.save.fragments' as source,
  count(*) as invalid_rows
from invalid_save_fragment_namespaces;

-- ============================================================
-- Original: 2026-07-15_player_level_reward_diagnostic.sql
-- ============================================================
select
  created_at,
  user_id,
  source,
  source_id,
  request_id,
  status,
  xp_amount,
  xp_before,
  xp_after,
  level_before,
  level_after,
  gems_granted,
  reward_gems
from public.user_player_xp_grants
order by created_at desc
limit 30;

-- Ver economia actual por cuenta:
-- select user_id, gold, gems, updated_at
-- from public.user_economy
-- order by updated_at desc;
