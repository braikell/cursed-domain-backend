begin;

-- Monedas iniciales temporales para testeo masivo post-wipe.
-- Mantener alineado con TEST_INITIAL_GOLD / TEST_INITIAL_GEMS en backend.

do $$
begin
  if to_regclass('public.monetization_config_versions') is not null then
    update public.monetization_config_versions
    set payload = coalesce(payload, '{}'::jsonb)
      || jsonb_build_object(
        'initialCurrencies',
        jsonb_build_object(
          'gold', 200000,
          'gems', 10000
        )
      )
    where namespace = 'monetization_v1'
      and is_active = true;
  end if;
end $$;

-- Ajuste seguro para cuentas limpias que ya hicieron bootstrap con los valores antiguos.
-- No pisa cuentas que ya cambiaron economia por compras/recompensas.
update public.user_economy
set
  gold = 200000,
  gems = 10000,
  updated_at = now()
where gold = 5000
  and gems = 500;

update public.player_saves
set
  save = jsonb_set(
    jsonb_set(save::jsonb, '{gold}', to_jsonb(200000), true),
    '{gems}', to_jsonb(10000),
    true
  ),
  updated_at = now()
where (save->>'gold')::int = 5000
  and (save->>'gems')::int = 500;

commit;

-- Verificacion sugerida:
-- select user_id, gold, gems from public.user_economy order by updated_at desc;
