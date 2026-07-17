-- ============================================================
-- Weekly & Season Mission System
-- ============================================================

-- Weekly mission definitions
create table if not exists public.weekly_mission_definitions (
  id bigint generated always as identity primary key,
  config_version integer not null ,
  mission_id text not null,
  event_key text not null,
  reward_gold integer not null default 0,
  reward_gems integer not null default 0,
  reward_points integer not null default 0,
  target integer not null default 1,
  sort_order integer not null default 0,
  is_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  unique (config_version, mission_id)
);

-- Weekly chest definitions
create table if not exists public.weekly_chest_definitions (
  id bigint generated always as identity primary key,
  config_version integer not null ,
  chest_id text not null,
  required_points integer not null default 0,
  reward_gold integer not null default 0,
  reward_gems integer not null default 0,
  sort_order integer not null default 0,
  is_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  unique (config_version, chest_id)
);

-- Season mission definitions
create table if not exists public.season_mission_definitions (
  id bigint generated always as identity primary key,
  config_version integer not null ,
  mission_id text not null,
  event_key text not null,
  reward_gold integer not null default 0,
  reward_gems integer not null default 0,
  reward_points integer not null default 0,
  target integer not null default 1,
  sort_order integer not null default 0,
  is_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  unique (config_version, mission_id)
);

-- Season chest definitions
create table if not exists public.season_chest_definitions (
  id bigint generated always as identity primary key,
  config_version integer not null ,
  chest_id text not null,
  required_points integer not null default 0,
  reward_gold integer not null default 0,
  reward_gems integer not null default 0,
  sort_order integer not null default 0,
  is_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  unique (config_version, chest_id)
);

-- User weekly mission state (reset every Monday)
create table if not exists public.user_weekly_mission_state (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  mission_id text not null,
  reset_date text not null,
  config_version integer not null,
  progress integer not null default 0,
  target integer not null default 1,
  claimed boolean not null default false,
  reward_gold_configured integer not null default 0,
  reward_gems_configured integer not null default 0,
  reward_points_configured integer not null default 0,
  reward_gold_granted integer not null default 0,
  reward_gems_granted integer not null default 0,
  reward_points_granted integer not null default 0,
  reward_capped boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  unique (user_id, mission_id, reset_date)
);

create index if not exists idx_user_weekly_mission_state_user_reset
  on public.user_weekly_mission_state (user_id, reset_date);

-- User weekly chest state
create table if not exists public.user_weekly_chest_state (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  chest_id text not null,
  reset_date text not null,
  config_version integer not null,
  required_points integer not null default 0,
  claimed boolean not null default false,
  reward_gold_configured integer not null default 0,
  reward_gems_configured integer not null default 0,
  reward_gold_granted integer not null default 0,
  reward_gems_granted integer not null default 0,
  reward_capped boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  unique (user_id, chest_id, reset_date)
);

create index if not exists idx_user_weekly_chest_state_user_reset
  on public.user_weekly_chest_state (user_id, reset_date);

-- User season mission state (reset monthly)
create table if not exists public.user_season_mission_state (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  mission_id text not null,
  reset_date text not null,
  config_version integer not null,
  progress integer not null default 0,
  target integer not null default 1,
  claimed boolean not null default false,
  reward_gold_configured integer not null default 0,
  reward_gems_configured integer not null default 0,
  reward_points_configured integer not null default 0,
  reward_gold_granted integer not null default 0,
  reward_gems_granted integer not null default 0,
  reward_points_granted integer not null default 0,
  reward_capped boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  unique (user_id, mission_id, reset_date)
);

create index if not exists idx_user_season_mission_state_user_reset
  on public.user_season_mission_state (user_id, reset_date);

-- User season chest state
create table if not exists public.user_season_chest_state (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  chest_id text not null,
  reset_date text not null,
  config_version integer not null,
  required_points integer not null default 0,
  claimed boolean not null default false,
  reward_gold_configured integer not null default 0,
  reward_gems_configured integer not null default 0,
  reward_gold_granted integer not null default 0,
  reward_gems_granted integer not null default 0,
  reward_capped boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  unique (user_id, chest_id, reset_date)
);

create index if not exists idx_user_season_chest_state_user_reset
  on public.user_season_chest_state (user_id, reset_date);

-- Cleanup indexes for free plan
create index if not exists user_weekly_mission_state_cleanup_reset_idx
  on public.user_weekly_mission_state (reset_date);

create index if not exists user_weekly_chest_state_cleanup_reset_idx
  on public.user_weekly_chest_state (reset_date);

create index if not exists user_season_mission_state_cleanup_reset_idx
  on public.user_season_mission_state (reset_date);

create index if not exists user_season_chest_state_cleanup_reset_idx
  on public.user_season_chest_state (reset_date);
