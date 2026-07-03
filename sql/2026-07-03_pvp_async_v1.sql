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
