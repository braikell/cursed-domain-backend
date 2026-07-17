-- ============================================================
-- Mission Reward Types - Tokens System
-- ============================================================

-- Add reward_type and reward_config to mission definitions
alter table public.daily_mission_definitions
  add column if not exists reward_type text not null default 'gold_gems',
  add column if not exists reward_config jsonb not null default '{}'::jsonb;

alter table if exists public.weekly_mission_definitions
  add column if not exists reward_type text not null default 'gold_gems',
  add column if not exists reward_config jsonb not null default '{}'::jsonb;

alter table if exists public.season_mission_definitions
  add column if not exists reward_type text not null default 'gold_gems',
  add column if not exists reward_config jsonb not null default '{}'::jsonb;

-- Add reward_config to state tables
alter table public.user_daily_mission_state
  add column if not exists reward_config jsonb not null default '{}'::jsonb;

alter table if exists public.user_weekly_mission_state
  add column if not exists reward_config jsonb not null default '{}'::jsonb;

alter table if exists public.user_season_mission_state
  add column if not exists reward_config jsonb not null default '{}'::jsonb;

-- Add pack tokens to user_economy (free packs from missions)
alter table public.user_economy
  add column if not exists pack_tokens jsonb not null default '{}'::jsonb,
  add column if not exists choice_tokens jsonb not null default '[]'::jsonb;

-- Initialize existing users with empty tokens
update public.user_economy
  set pack_tokens = '{}'::jsonb
  where pack_tokens is null;

update public.user_economy
  set choice_tokens = '[]'::jsonb
  where choice_tokens is null;
