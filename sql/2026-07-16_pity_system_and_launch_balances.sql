begin;

-- Tabla de contador de pity para el sistema gacha.
-- Resetea a 0 cuando el jugador obtiene una carta legendary o mythic.
-- Soft pity: >= 70 pulls sin legendary/mythic incrementa tasas progresivamente.
-- Hard pity: >= 90 pulls garantiza legendary o mythic.

create table if not exists public.user_pity (
  user_id uuid primary key references auth.users(id) on delete cascade,
  pity_counter int not null default 0 check (pity_counter >= 0),
  updated_at timestamptz not null default now()
);

alter table public.user_pity enable row level security;

drop policy if exists "user_pity_select_own" on public.user_pity;
create policy "user_pity_select_own" on public.user_pity
  for select using (auth.uid() = user_id);

drop policy if exists "user_pity_upsert_own" on public.user_pity;
create policy "user_pity_upsert_own" on public.user_pity
  for insert with check (auth.uid() = user_id);

drop policy if exists "user_pity_update_own" on public.user_pity;
create policy "user_pity_update_own" on public.user_pity
  for update using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

comment on table public.user_pity is 'Contador de pity del sistema gacha. Soft pity a 70, hard pity a 90.';
comment on column public.user_pity.pity_counter is 'Numero consecutivo de pulls sin legendary ni mythic. Max efectivo 90.';

-- Ajuste de balances iniciales para launch (reemplaza valores de testeo 200k/10k).
-- Solo afecta nuevas cuentas que se creen tras aplicar esta migracion.
-- Cuentas existentes con economia ya modificada no son afectadas.

do $$
begin
  if to_regclass('public.monetization_config_versions') is not null then
    update public.monetization_config_versions
    set payload = coalesce(payload, '{}'::jsonb)
      || jsonb_build_object(
        'initialCurrencies',
        jsonb_build_object(
          'gold', 5000,
          'gems', 200
        )
      )
    where namespace = 'monetization_v1'
      and is_active = true
      and (
        payload->'initialCurrencies'->>'gold' is null
        or (payload->'initialCurrencies'->>'gold')::int = 200000
      );
  end if;
end $$;

-- Solo actualiza cuentas que estan exactamente en el valor de testeo antiguo (200k/10k).
-- No toca cuentas que ya hayan ganado/gastado recursos.
update public.user_economy
set gold = 5000, gems = 200, updated_at = now()
where gold = 200000 and gems = 10000;

update public.player_saves
set
  save = jsonb_set(
    jsonb_set(save::jsonb, '{gold}', to_jsonb(5000), true),
    '{gems}', to_jsonb(200),
    true
  ),
  updated_at = now()
where (save->>'gold')::int = 200000
  and (save->>'gems')::int = 10000;

commit;

-- Verificacion sugerida:
-- select user_id, gold, gems from public.user_economy order by updated_at desc limit 20;
-- select user_id, pity_counter from public.user_pity;
