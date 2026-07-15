-- Fase 2: sesiones de batalla ultra-baratas para Supabase Free.
--
-- Objetivo:
-- - 1 fila compacta al iniciar batalla de campana.
-- - consumo unico al completar.
-- - limpieza diaria ya cubierta por daily_cleanup_free_plan().
--
-- Este script no borra datos.

begin;

create table if not exists public.battle_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  mode text not null,
  stage_id text,
  floor_number int,
  match_id uuid,
  team_hash text not null,
  team_power int not null default 0,
  target_power int not null default 0,
  min_duration_seconds int not null default 3,
  request_id text not null,
  started_at timestamptz not null default now(),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  check (mode in ('campaign', 'tower', 'pvp')),
  check (team_power >= 0),
  check (target_power >= 0),
  check (min_duration_seconds >= 0),
  check (expires_at > started_at)
);

create unique index if not exists battle_sessions_user_request_idx
  on public.battle_sessions (user_id, request_id);

create index if not exists battle_sessions_user_active_idx
  on public.battle_sessions (user_id, mode, expires_at)
  where consumed_at is null;

create index if not exists battle_sessions_expires_idx
  on public.battle_sessions (expires_at);

create index if not exists battle_sessions_consumed_idx
  on public.battle_sessions (consumed_at);

alter table public.battle_sessions enable row level security;

-- No policy for anon/authenticated: battle sessions are service-role only.
revoke all on table public.battle_sessions from anon;
revoke all on table public.battle_sessions from authenticated;
grant all on table public.battle_sessions to service_role;

commit;

-- Smoke checks after applying:
--
-- select
--   relname as table_name,
--   pg_size_pretty(pg_total_relation_size(relid)) as total_size
-- from pg_stat_user_tables
-- where schemaname = 'public'
--   and relname = 'battle_sessions';
--
-- select public.daily_cleanup_free_plan(true);
