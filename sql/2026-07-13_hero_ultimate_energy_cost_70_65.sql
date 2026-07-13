begin;

-- Canonical hero ultimate energy costs.
-- Runtime combat uses card_balance.json, but the remote card_definitions catalog
-- must stay aligned so UI/catalog consumers do not restore the old costs.
--
-- Safe to rerun.

update public.card_definitions
set ultimate = jsonb_set(
  coalesce(ultimate, '{}'::jsonb),
  '{energy_cost}',
  to_jsonb(case when upper(card_type) = 'DEFINITIVA' then 65 else 70 end),
  true
)
where card_type is not null
  and upper(card_type) in ('BASE', 'DEFINITIVA')
  and (
    ultimate is null
    or coalesce((ultimate ->> 'energy_cost')::int, -1) <> case when upper(card_type) = 'DEFINITIVA' then 65 else 70 end
  );

commit;
