-- ============================================================
-- Original: 2026-07-03_pvp_async_v1.sql
-- ============================================================
begin;

create or replace function public.pvp_current_season_id()
returns text
language sql
stable
as $$
  select to_char(date_trunc('week', now()), '"S"IYYY-IW');
$$;

create table if not exists public.user_pvp_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default 'Jugador',
  league text not null default 'bronze',
  rating int not null default 1000,
  current_season_id text not null default public.pvp_current_season_id(),
  season_rating int not null default 1000,
  season_best_rating int not null default 1000,
  wins int not null default 0,
  losses int not null default 0,
  defense_power int not null default 0,
  defense_snapshot jsonb not null default '{}'::jsonb,
  defense_updated_at timestamptz,
  last_match_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (league in ('bronze', 'silver', 'gold')),
  check (rating >= 0),
  check (season_rating >= 0),
  check (season_best_rating >= 0),
  check (wins >= 0),
  check (losses >= 0),
  check (defense_power >= 0)
);

alter table public.user_pvp_profiles
  add column if not exists current_season_id text not null default public.pvp_current_season_id(),
  add column if not exists season_rating int not null default 1000,
  add column if not exists season_best_rating int not null default 1000;

create table if not exists public.user_pvp_battle_logs (
  id uuid primary key default gen_random_uuid(),
  season_id text not null default public.pvp_current_season_id(),
  attacker_user_id uuid not null references auth.users(id) on delete cascade,
  defender_user_id uuid not null references auth.users(id) on delete cascade,
  result text not null,
  rating_delta int not null default 0,
  attacker_rating_before int not null default 1000,
  attacker_rating_after int not null default 1000,
  defender_rating_before int not null default 1000,
  defender_rating_after int not null default 1000,
  attacker_power int not null default 0,
  defender_power int not null default 0,
  created_at timestamptz not null default now(),
  check (result in ('win', 'loss')),
  check (attacker_power >= 0),
  check (defender_power >= 0)
);

alter table public.user_pvp_battle_logs
  add column if not exists season_id text not null default public.pvp_current_season_id(),
  add column if not exists attacker_rating_before int not null default 1000,
  add column if not exists defender_rating_before int not null default 1000;

create index if not exists user_pvp_profiles_rating_idx
  on public.user_pvp_profiles (rating desc, defense_power desc, updated_at desc);

create index if not exists user_pvp_profiles_league_rating_idx
  on public.user_pvp_profiles (league, rating desc);

create index if not exists user_pvp_profiles_power_idx
  on public.user_pvp_profiles (defense_power);

create index if not exists user_pvp_battle_logs_attacker_created_idx
  on public.user_pvp_battle_logs (attacker_user_id, created_at desc);

create index if not exists user_pvp_profiles_season_rating_idx
  on public.user_pvp_profiles (current_season_id, season_rating desc, season_best_rating desc);

create or replace function public.pvp_league_for_rating(p_rating int)
returns text
language sql
immutable
as $$
  select case
    when p_rating >= 1500 then 'gold'
    when p_rating >= 1200 then 'silver'
    else 'bronze'
  end;
$$;

create or replace function public.refresh_user_pvp_league()
returns trigger
language plpgsql
as $$
begin
  new.league = public.pvp_league_for_rating(new.rating);
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists user_pvp_profiles_refresh_league_trigger on public.user_pvp_profiles;
create trigger user_pvp_profiles_refresh_league_trigger
before insert or update of rating, defense_power, defense_snapshot, display_name, wins, losses
on public.user_pvp_profiles
for each row
execute function public.refresh_user_pvp_league();

alter table public.user_pvp_profiles enable row level security;
alter table public.user_pvp_battle_logs enable row level security;

drop policy if exists user_pvp_profiles_select_authenticated on public.user_pvp_profiles;
create policy user_pvp_profiles_select_authenticated
  on public.user_pvp_profiles
  for select
  to authenticated
  using (true);

drop policy if exists user_pvp_battle_logs_select_own on public.user_pvp_battle_logs;
create policy user_pvp_battle_logs_select_own
  on public.user_pvp_battle_logs
  for select
  to authenticated
  using (auth.uid() = attacker_user_id or auth.uid() = defender_user_id);

grant usage on schema public to authenticated;
grant select on table public.user_pvp_profiles to authenticated;
grant select on table public.user_pvp_battle_logs to authenticated;

commit;

-- ============================================================
-- Original: 2026-07-03_pvp_secure_lite.sql
-- ============================================================
begin;

create table if not exists public.idempotency_keys (
  user_id uuid not null references auth.users(id) on delete cascade,
  request_id text not null,
  operation text not null,
  response jsonb,
  created_at timestamptz not null default now(),
  primary key (user_id, request_id)
);

alter table public.idempotency_keys enable row level security;

create table if not exists public.user_pvp_matches (
  id uuid primary key default gen_random_uuid(),
  attacker_user_id uuid not null references auth.users(id) on delete cascade,
  defender_user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'started',
  result text,
  season_id text not null default public.pvp_current_season_id(),
  defender_snapshot jsonb not null default '{}'::jsonb,
  attacker_rating_before int not null default 1000,
  defender_rating_before int not null default 1000,
  rating_delta int not null default 0,
  attacker_power int not null default 0,
  defender_power int not null default 0,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '20 minutes'),
  completed_at timestamptz,
  check (attacker_user_id <> defender_user_id),
  check (status in ('started', 'completed', 'expired')),
  check (result is null or result in ('win', 'loss')),
  check (attacker_rating_before >= 0),
  check (defender_rating_before >= 0),
  check (attacker_power >= 0),
  check (defender_power >= 0)
);

create index if not exists user_pvp_matches_attacker_created_idx
  on public.user_pvp_matches (attacker_user_id, created_at desc);

create index if not exists user_pvp_matches_attacker_defender_created_idx
  on public.user_pvp_matches (attacker_user_id, defender_user_id, created_at desc);

create index if not exists user_pvp_matches_status_expires_idx
  on public.user_pvp_matches (status, expires_at);

create index if not exists user_pvp_matches_status_completed_idx
  on public.user_pvp_matches (status, completed_at);

create or replace function public.prune_pvp_matches_lite(p_limit int default 200)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted int := 0;
begin
  with old_rows as (
    select ctid
    from public.user_pvp_matches
    where (status = 'completed' and completed_at < now() - interval '7 days')
       or (status in ('started', 'expired') and expires_at < now() - interval '2 days')
    limit greatest(1, least(coalesce(p_limit, 200), 500))
  ),
  deleted as (
    delete from public.user_pvp_matches m
    using old_rows
    where m.ctid = old_rows.ctid
    returning 1
  )
  select count(*) into v_deleted from deleted;

  return v_deleted;
end;
$$;

create or replace function public.complete_pvp_match_lite(
  p_match_id uuid,
  p_attacker_user_id uuid,
  p_result text,
  p_attacker_power int,
  p_defender_power int
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_match public.user_pvp_matches%rowtype;
  v_attacker public.user_pvp_profiles%rowtype;
  v_defender public.user_pvp_profiles%rowtype;
  v_attacker_won boolean;
  v_difficulty_bonus int;
  v_delta int;
  v_attacker_next_rating int;
  v_defender_next_rating int;
  v_season_id text := public.pvp_current_season_id();
  v_attacker_season_rating int;
  v_attacker_season_best int;
  v_defender_season_rating int;
  v_defender_season_best int;
  v_attacker_next_season int;
  v_defender_next_season int;
begin
  if p_result not in ('win', 'loss') then
    raise exception 'invalid_pvp_result' using errcode = 'P0001';
  end if;

  select *
  into v_match
  from public.user_pvp_matches
  where id = p_match_id
    and attacker_user_id = p_attacker_user_id
  for update;

  if not found then
    raise exception 'pvp_match_not_found' using errcode = 'P0001';
  end if;

  if v_match.status <> 'started' then
    raise exception 'pvp_match_already_closed' using errcode = 'P0001';
  end if;

  if v_match.expires_at <= now() then
    update public.user_pvp_matches
    set status = 'expired'
    where id = v_match.id;
    raise exception 'pvp_match_expired' using errcode = 'P0001';
  end if;

  perform 1
  from public.user_pvp_profiles
  where user_id in (v_match.attacker_user_id, v_match.defender_user_id)
  order by user_id
  for update;

  select * into v_attacker
  from public.user_pvp_profiles
  where user_id = v_match.attacker_user_id;

  select * into v_defender
  from public.user_pvp_profiles
  where user_id = v_match.defender_user_id;

  if v_attacker.user_id is null or v_defender.user_id is null or v_defender.defense_power <= 0 then
    raise exception 'pvp_profile_not_found' using errcode = 'P0001';
  end if;

  v_attacker_won := p_result = 'win';
  v_difficulty_bonus := greatest(-6, least(10, round((v_defender.rating - v_attacker.rating)::numeric / 80.0)::int));
  if v_attacker_won then
    v_delta := greatest(12, least(34, 22 + v_difficulty_bonus));
  else
    v_delta := -greatest(6, least(18, 10 - v_difficulty_bonus));
  end if;

  v_attacker_next_rating := greatest(0, v_attacker.rating + v_delta);
  v_defender_next_rating := greatest(0, v_defender.rating - v_delta);

  if coalesce(v_attacker.current_season_id, '') = v_season_id then
    v_attacker_season_rating := greatest(0, coalesce(v_attacker.season_rating, v_attacker.rating));
    v_attacker_season_best := greatest(v_attacker_season_rating, coalesce(v_attacker.season_best_rating, v_attacker_season_rating));
  else
    v_attacker_season_rating := 1000;
    v_attacker_season_best := 1000;
  end if;

  if coalesce(v_defender.current_season_id, '') = v_season_id then
    v_defender_season_rating := greatest(0, coalesce(v_defender.season_rating, v_defender.rating));
    v_defender_season_best := greatest(v_defender_season_rating, coalesce(v_defender.season_best_rating, v_defender_season_rating));
  else
    v_defender_season_rating := 1000;
    v_defender_season_best := 1000;
  end if;

  v_attacker_next_season := greatest(0, v_attacker_season_rating + v_delta);
  v_defender_next_season := greatest(0, v_defender_season_rating - v_delta);

  update public.user_pvp_profiles
  set
    rating = v_attacker_next_rating,
    current_season_id = v_season_id,
    season_rating = v_attacker_next_season,
    season_best_rating = greatest(v_attacker_season_best, v_attacker_next_season),
    wins = wins + case when v_attacker_won then 1 else 0 end,
    losses = losses + case when v_attacker_won then 0 else 1 end,
    last_match_at = now(),
    updated_at = now()
  where user_id = v_match.attacker_user_id;

  update public.user_pvp_profiles
  set
    rating = v_defender_next_rating,
    current_season_id = v_season_id,
    season_rating = v_defender_next_season,
    season_best_rating = greatest(v_defender_season_best, v_defender_next_season),
    wins = wins + case when v_attacker_won then 0 else 1 end,
    losses = losses + case when v_attacker_won then 1 else 0 end,
    updated_at = now()
  where user_id = v_match.defender_user_id;

  insert into public.user_pvp_battle_logs (
    season_id,
    attacker_user_id,
    defender_user_id,
    result,
    rating_delta,
    attacker_rating_before,
    attacker_rating_after,
    defender_rating_before,
    defender_rating_after,
    attacker_power,
    defender_power,
    created_at
  )
  values (
    v_season_id,
    v_match.attacker_user_id,
    v_match.defender_user_id,
    p_result,
    v_delta,
    v_attacker.rating,
    v_attacker_next_rating,
    v_defender.rating,
    v_defender_next_rating,
    greatest(0, p_attacker_power),
    greatest(0, p_defender_power),
    now()
  );

  update public.user_pvp_matches
  set
    status = 'completed',
    result = p_result,
    season_id = v_season_id,
    attacker_rating_before = v_attacker.rating,
    defender_rating_before = v_defender.rating,
    rating_delta = v_delta,
    attacker_power = greatest(0, p_attacker_power),
    defender_power = greatest(0, p_defender_power),
    completed_at = now()
  where id = v_match.id;

  return jsonb_build_object(
    'ok', true,
    'result', p_result,
    'ratingDelta', v_delta,
    'ratingBefore', v_attacker.rating,
    'ratingAfter', v_attacker_next_rating,
    'seasonId', v_season_id,
    'seasonRatingBefore', v_attacker_season_rating,
    'seasonRatingAfter', v_attacker_next_season,
    'seasonBestRating', greatest(v_attacker_season_best, v_attacker_next_season),
    'defenderUserId', v_match.defender_user_id
  );
end;
$$;

alter table public.user_pvp_matches enable row level security;

drop policy if exists user_pvp_matches_select_own on public.user_pvp_matches;
create policy user_pvp_matches_select_own
  on public.user_pvp_matches
  for select
  to authenticated
  using (auth.uid() = attacker_user_id or auth.uid() = defender_user_id);

grant select on table public.user_pvp_matches to authenticated;

commit;

-- ============================================================
-- Original: 2026-07-03_social_friends_v1.sql
-- ============================================================
begin;

alter table public.profiles
  add column if not exists last_seen_at timestamptz;

create table if not exists public.friend_requests (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references auth.users(id) on delete cascade,
  addressee_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  responded_at timestamptz,
  check (requester_id <> addressee_id),
  check (status in ('pending', 'accepted', 'declined', 'canceled'))
);

create table if not exists public.user_friends (
  user_id uuid not null references auth.users(id) on delete cascade,
  friend_user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, friend_user_id),
  check (user_id <> friend_user_id)
);

create unique index if not exists friend_requests_pending_pair_idx
  on public.friend_requests (
    least(requester_id, addressee_id),
    greatest(requester_id, addressee_id)
  )
  where status = 'pending';

create index if not exists friend_requests_requester_idx
  on public.friend_requests (requester_id, status, created_at desc);

create index if not exists friend_requests_addressee_idx
  on public.friend_requests (addressee_id, status, created_at desc);

create index if not exists user_friends_friend_idx
  on public.user_friends (friend_user_id, created_at desc);

create index if not exists profiles_last_seen_at_idx
  on public.profiles (last_seen_at desc);

create or replace function public.refresh_friend_request_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  if old.status = 'pending' and new.status in ('accepted', 'declined', 'canceled') then
    new.responded_at = now();
  end if;
  return new;
end;
$$;

drop trigger if exists friend_requests_refresh_updated_at_trigger on public.friend_requests;
create trigger friend_requests_refresh_updated_at_trigger
before update of status on public.friend_requests
for each row
execute function public.refresh_friend_request_updated_at();

alter table public.friend_requests enable row level security;
alter table public.user_friends enable row level security;

drop policy if exists friend_requests_select_own on public.friend_requests;
create policy friend_requests_select_own
  on public.friend_requests
  for select
  to authenticated
  using (auth.uid() = requester_id or auth.uid() = addressee_id);

drop policy if exists user_friends_select_own on public.user_friends;
create policy user_friends_select_own
  on public.user_friends
  for select
  to authenticated
  using (auth.uid() = user_id);

grant usage on schema public to authenticated;
grant select on table public.friend_requests to authenticated;
grant select on table public.user_friends to authenticated;

commit;

-- ============================================================
-- Original: 2026-07-03_profile_name_change_free_reset.sql
-- ============================================================
begin;

alter table public.profiles
  add column if not exists display_name_changed_at timestamptz,
  add column if not exists display_name_normalized text;

update public.profiles
set
  display_name_changed_at = null,
  display_name_normalized = null;

create or replace function public.prevent_profile_display_name_second_change()
returns trigger
language plpgsql
as $$
declare
  normalized_name text;
begin
  if old.display_name is distinct from new.display_name then
    if old.display_name_changed_at is not null and old.display_name_normalized is not null then
      raise exception 'display_name_can_only_be_changed_once';
    end if;

    new.display_name = public.normalize_profile_display_name(new.display_name);
    normalized_name = public.profile_display_name_key(new.display_name);

    if normalized_name is null
      or length(new.display_name) < 3
      or length(new.display_name) > 24
      or new.display_name !~ '^[A-Za-z0-9 ]+$'
    then
      raise exception 'display_name_invalid_format';
    end if;

    if public.profile_display_name_has_blocked_word(normalized_name) then
      raise exception 'display_name_reserved_or_obscene';
    end if;

    if exists (
      select 1
      from public.profiles p
      where p.id <> old.id
        and public.profile_display_name_key(p.display_name) = normalized_name
    ) then
      raise exception 'display_name_already_taken';
    end if;

    new.display_name_normalized = normalized_name;
    new.display_name_changed_at = now();
  end if;

  return new;
end;
$$;

commit;

-- ============================================================
-- Original: 2026-07-03_profile_name_pvp_sync_permission_fix.sql
-- ============================================================
begin;

create or replace function public.sync_profile_display_name_to_pvp()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.display_name is distinct from new.display_name
    and to_regclass('public.user_pvp_profiles') is not null
  then
    update public.user_pvp_profiles
    set
      display_name = new.display_name,
      defense_snapshot = case
        when defense_snapshot is null or defense_snapshot = '{}'::jsonb then defense_snapshot
        else jsonb_set(defense_snapshot, '{displayName}', to_jsonb(new.display_name), true)
      end,
      updated_at = now()
    where user_id = new.id;
  end if;

  return new;
end;
$$;

drop trigger if exists profiles_sync_display_name_to_pvp_trigger on public.profiles;

create trigger profiles_sync_display_name_to_pvp_trigger
after update of display_name on public.profiles
for each row
execute function public.sync_profile_display_name_to_pvp();

commit;

-- ============================================================
-- Original: 2026-07-01_profile_view_metadata.sql
-- ============================================================
alter table public.profiles
  add column if not exists profile_created_at timestamptz,
  add column if not exists display_name_changed_at timestamptz,
  add column if not exists profile_backdrop text,
  add column if not exists display_name_normalized text;

update public.profiles
set
  profile_created_at = coalesce(profile_created_at, updated_at, now()),
  profile_backdrop = case
    when profile_backdrop in ('abyss', 'eclipse') then profile_backdrop
    else 'eclipse'
  end;

alter table public.profiles
  alter column profile_created_at set default now(),
  alter column profile_backdrop set default 'eclipse';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'profiles_profile_backdrop_check'
  ) then
    alter table public.profiles
      add constraint profiles_profile_backdrop_check
      check (profile_backdrop in ('abyss', 'eclipse'));
  end if;
end $$;

create or replace function public.normalize_profile_display_name(value text)
returns text
language sql
immutable
as $$
  select nullif(regexp_replace(btrim(coalesce(value, '')), '\s+', ' ', 'g'), '');
$$;

create or replace function public.profile_display_name_key(value text)
returns text
language sql
immutable
as $$
  select nullif(regexp_replace(lower(public.normalize_profile_display_name(value)), '\s+', '', 'g'), '');
$$;

create or replace function public.profile_display_name_has_blocked_word(normalized_name text)
returns boolean
language sql
immutable
as $$
  select exists (
    select 1
    from unnest(array[
      'admin',
      'moderador',
      'soporte',
      'system',
      'puta',
      'puto',
      'mierda',
      'pene',
      'vagina',
      'sexo',
      'porno',
      'porn',
      'fuck',
      'shit',
      'bitch',
      'nazi'
    ]) as blocked(word)
    where normalized_name like '%' || blocked.word || '%'
  );
$$;

create or replace function public.prevent_profile_display_name_second_change()
returns trigger
language plpgsql
as $$
declare
  normalized_name text;
begin
  if old.display_name is distinct from new.display_name then
    if old.display_name_changed_at is not null and old.display_name_normalized is not null then
      raise exception 'display_name_can_only_be_changed_once';
    end if;

    new.display_name = public.normalize_profile_display_name(new.display_name);
    normalized_name = public.profile_display_name_key(new.display_name);

    if normalized_name is null
      or length(new.display_name) < 3
      or length(new.display_name) > 24
      or new.display_name !~ '^[A-Za-z0-9 ]+$'
    then
      raise exception 'display_name_invalid_format';
    end if;

    if public.profile_display_name_has_blocked_word(normalized_name) then
      raise exception 'display_name_reserved_or_obscene';
    end if;

    if exists (
      select 1
      from public.profiles p
      where p.id <> old.id
        and public.profile_display_name_key(p.display_name) = normalized_name
    ) then
      raise exception 'display_name_already_taken';
    end if;

    new.display_name_normalized = normalized_name;
    new.display_name_changed_at = now();
  end if;

  return new;
end;
$$;

drop trigger if exists profiles_display_name_once_trigger on public.profiles;

create trigger profiles_display_name_once_trigger
before update of display_name on public.profiles
for each row
execute function public.prevent_profile_display_name_second_change();

with changed_profiles as (
  select
    id,
    public.profile_display_name_key(display_name) as normalized_name,
    row_number() over (
      partition by public.profile_display_name_key(display_name)
      order by display_name_changed_at nulls last, id
    ) as duplicate_rank
  from public.profiles
  where display_name_changed_at is not null
    and public.profile_display_name_key(display_name) is not null
)
update public.profiles p
set display_name_normalized = changed_profiles.normalized_name
from changed_profiles
where p.id = changed_profiles.id
  and changed_profiles.duplicate_rank = 1
  and p.display_name_normalized is not null;

create unique index if not exists profiles_display_name_normalized_unique
  on public.profiles (display_name_normalized)
  where display_name_normalized is not null;

create or replace function public.sync_profile_display_name_to_pvp()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.display_name is distinct from new.display_name
    and to_regclass('public.user_pvp_profiles') is not null
  then
    update public.user_pvp_profiles
    set
      display_name = new.display_name,
      defense_snapshot = case
        when defense_snapshot is null or defense_snapshot = '{}'::jsonb then defense_snapshot
        else jsonb_set(defense_snapshot, '{displayName}', to_jsonb(new.display_name), true)
      end,
      updated_at = now()
    where user_id = new.id;
  end if;

  return new;
end;
$$;

drop trigger if exists profiles_sync_display_name_to_pvp_trigger on public.profiles;

create trigger profiles_sync_display_name_to_pvp_trigger
after update of display_name on public.profiles
for each row
execute function public.sync_profile_display_name_to_pvp();

-- ============================================================
-- Original: 2026-07-13_profile_avatar_card_id.sql
-- ============================================================
alter table public.profiles
  add column if not exists avatar_card_id text;

-- ============================================================
-- Original: 2026-07-15_profile_backdrop_default_eclipse.sql
-- ============================================================
alter table public.profiles
  alter column profile_backdrop set default 'eclipse';

update public.profiles
set profile_backdrop = 'eclipse'
where profile_backdrop is null
   or profile_backdrop not in ('abyss', 'eclipse');
