-- ============================================================
-- Mission Reward Types - Add reward_type and reward_config columns
-- ============================================================

-- Add to daily mission definitions
alter table public.daily_mission_definitions
  add column if not exists reward_type text not null default 'gold_gems',
  add column if not exists reward_config jsonb not null default '{}'::jsonb;

-- Add to weekly mission definitions  
alter table if exists public.weekly_mission_definitions
  add column if not exists reward_type text not null default 'gold_gems',
  add column if not exists reward_config jsonb not null default '{}'::jsonb;

-- Add to season mission definitions
alter table if exists public.season_mission_definitions
  add column if not exists reward_type text not null default 'gold_gems',
  add column if not exists reward_config jsonb not null default '{}'::jsonb;

-- Add reward_config to user mission state tables (track what was granted)
alter table public.user_daily_mission_state
  add column if not exists reward_config jsonb not null default '{}'::jsonb;

alter table if exists public.user_weekly_mission_state
  add column if not exists reward_config jsonb not null default '{}'::jsonb;

alter table if exists public.user_season_mission_state
  add column if not exists reward_config jsonb not null default '{}'::jsonb;
