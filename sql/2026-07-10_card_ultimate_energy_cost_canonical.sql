begin;

-- Canonical hero ultimate energy costs.
-- BASE cards cost 75 energy, DEFINITIVA cards cost 70 energy.
-- Enemy/maldicion ultimate costs live in enemy_definitions and remain 100.

update public.card_definitions
set ultimate = jsonb_set(
  coalesce(ultimate, '{}'::jsonb),
  '{energy_cost}',
  to_jsonb(case when upper(card_type) = 'DEFINITIVA' then 70 else 75 end),
  true
)
where upper(card_type) in ('BASE', 'DEFINITIVA')
  and (
    ultimate is null
    or jsonb_typeof(ultimate) <> 'object'
    or coalesce((ultimate ->> 'energy_cost')::int, -1) <> case when upper(card_type) = 'DEFINITIVA' then 70 else 75 end
  );

commit;
