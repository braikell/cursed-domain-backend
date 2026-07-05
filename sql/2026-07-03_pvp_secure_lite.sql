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
