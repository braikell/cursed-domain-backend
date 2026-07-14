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
