-- INCURSIONES Fase 1: sesiones server-side y pago atómico de entrada.
-- Ejecutar en Supabase SQL Editor después de revisar el dry-run del limpiador.

begin;

alter table public.battle_sessions
  drop constraint if exists battle_sessions_mode_check;

alter table public.battle_sessions
  drop constraint if exists battle_sessions_entry_currency_check,
  drop constraint if exists battle_sessions_entry_cost_check,
  drop constraint if exists battle_sessions_wave_limit_check;

alter table public.battle_sessions
  add constraint battle_sessions_mode_check
  check (mode in ('campaign', 'tower', 'pvp', 'incursion'));

alter table public.battle_sessions
  add column if not exists entry_currency text,
  add column if not exists entry_cost int,
  add column if not exists wave_limit int;

alter table public.battle_sessions
  add constraint battle_sessions_entry_currency_check
  check (entry_currency is null or entry_currency in ('gold', 'gems'));

alter table public.battle_sessions
  add constraint battle_sessions_entry_cost_check
  check (entry_cost is null or entry_cost >= 0);

alter table public.battle_sessions
  add constraint battle_sessions_wave_limit_check
  check (wave_limit is null or wave_limit between 1 and 10);

create index if not exists battle_sessions_incursion_active_idx
  on public.battle_sessions (user_id, mode, expires_at)
  where mode = 'incursion' and consumed_at is null;

alter table public.battle_sessions enable row level security;
revoke all on table public.battle_sessions from anon;
revoke all on table public.battle_sessions from authenticated;
grant all on table public.battle_sessions to service_role;

create or replace function public.start_incursion_session(
  target_user_id uuid,
  target_request_id text,
  target_currency text,
  target_cost int,
  session_ttl_seconds int default 900,
  target_wave_limit int default 10
)
returns table (
  session_id uuid,
  started_at timestamptz,
  expires_at timestamptz,
  currency text,
  cost int,
  gold int,
  gems int,
  replay boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  economy_row public.user_economy%rowtype;
  existing_session public.battle_sessions%rowtype;
  new_session public.battle_sessions%rowtype;
  now_value timestamptz := now();
  expires_value timestamptz := now_value + make_interval(secs => greatest(60, least(coalesce(session_ttl_seconds, 900), 1800)));
  next_gold int;
  next_gems int;
begin
  if target_user_id is null then
    raise exception using errcode = '22023', message = 'invalid_user';
  end if;
  if target_request_id is null or length(trim(target_request_id)) < 8 then
    raise exception using errcode = '22023', message = 'invalid_request_id';
  end if;
  if target_currency not in ('gold', 'gems') then
    raise exception using errcode = '22023', message = 'invalid_currency';
  end if;
  if target_cost <= 0 or target_wave_limit not between 1 and 10 then
    raise exception using errcode = '22023', message = 'invalid_incursion_config';
  end if;

  select * into existing_session
  from public.battle_sessions
  where user_id = target_user_id
    and request_id = target_request_id
  limit 1;

  if existing_session.id is not null then
    return query
    select existing_session.id,
      existing_session.started_at,
      existing_session.expires_at,
      coalesce(existing_session.entry_currency, target_currency),
      coalesce(existing_session.entry_cost, target_cost),
      coalesce((select gold from public.user_economy where user_id = target_user_id), 0),
      coalesce((select gems from public.user_economy where user_id = target_user_id), 0),
      true;
    return;
  end if;

  if exists (
    select 1 from public.battle_sessions
    where user_id = target_user_id
      and mode = 'incursion'
      and consumed_at is null
      and expires_at > now_value
  ) then
    raise exception using errcode = '55000', message = 'incursion_session_active';
  end if;

  select * into economy_row
  from public.user_economy
  where user_id = target_user_id
  for update;

  if economy_row.user_id is null then
    raise exception using errcode = 'P0002', message = 'economy_not_found';
  end if;

  next_gold := greatest(0, coalesce(economy_row.gold, 0));
  next_gems := greatest(0, coalesce(economy_row.gems, 0));

  if target_currency = 'gold' then
    if next_gold < target_cost then
      raise exception using errcode = 'P0001', message = 'insufficient_funds';
    end if;
    next_gold := next_gold - target_cost;
  else
    if next_gems < target_cost then
      raise exception using errcode = 'P0001', message = 'insufficient_funds';
    end if;
    next_gems := next_gems - target_cost;
  end if;

  update public.user_economy
  set gold = next_gold, gems = next_gems, updated_at = now_value
  where user_id = target_user_id;

  update public.player_saves
  set save = jsonb_set(
    jsonb_set(coalesce(save, '{}'::jsonb), '{gold}', to_jsonb(next_gold), true),
    '{gems}', to_jsonb(next_gems), true
  ), updated_at = now_value
  where user_id = target_user_id;

  insert into public.battle_sessions (
    user_id, mode, stage_id, team_hash, team_power, target_power,
    min_duration_seconds, request_id, started_at, expires_at,
    entry_currency, entry_cost, wave_limit
  ) values (
    target_user_id, 'incursion', 'incursion', 'incursion', 0, 0,
    3, target_request_id, now_value, expires_value,
    target_currency, target_cost, target_wave_limit
  ) returning * into new_session;

  return query
  select new_session.id, new_session.started_at, new_session.expires_at,
    target_currency, target_cost, next_gold, next_gems, false;
end;
$$;

revoke all on function public.start_incursion_session(uuid, text, text, int, int, int) from public;
revoke all on function public.start_incursion_session(uuid, text, text, int, int, int) from anon;
revoke all on function public.start_incursion_session(uuid, text, text, int, int, int) from authenticated;
grant execute on function public.start_incursion_session(uuid, text, text, int, int, int) to service_role;

commit;

-- Smoke checks:
-- select mode, count(*) from public.battle_sessions group by mode;
-- select public.daily_cleanup_free_plan(true);
