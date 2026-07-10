begin;

with ultimate_timings(character_key, impact_delay_sec, hit_count, hit_interval_sec) as (
  values
    ('yuji', 1.70::numeric, 1, 0.0::numeric),
    ('nobara', 0.80::numeric, 3, 0.725::numeric),
    ('megumi', 1.30::numeric, 3, 0.50::numeric),
    ('gojo', 2.20::numeric, 1, 0.0::numeric),
    ('sukuna', 1.22::numeric, 7, 0.13::numeric),
    ('nanami', 1.35::numeric, 3, 0.37::numeric),
    ('toji', 2.05::numeric, 1, 0.0::numeric),
    ('maki', 1.10::numeric, 4, 0.32::numeric),
    ('panda', 1.10::numeric, 4, 0.32::numeric),
    ('mahito', 1.15::numeric, 2, 0.40::numeric),
    ('geto', 1.35::numeric, 3, 0.40::numeric),
    ('todo', 1.05::numeric, 2, 0.40::numeric),
    ('jogo', 2.05::numeric, 1, 0.0::numeric),
    ('hanami', 1.10::numeric, 3, 0.50::numeric),
    ('higuruma', 1.90::numeric, 1, 0.0::numeric),
    ('kashimo', 1.90::numeric, 1, 0.0::numeric),
    ('choso', 2.05::numeric, 1, 0.0::numeric),
    ('mahoraga', 2.25::numeric, 1, 0.0::numeric),
    ('toge', 1.45::numeric, 1, 0.0::numeric),
    ('inumaki', 1.45::numeric, 1, 0.0::numeric),
    ('naoya', 1.85::numeric, 1, 0.0::numeric),
    ('hakari', 1.90::numeric, 1, 0.0::numeric),
    ('meimei', 1.15::numeric, 2, 0.40::numeric),
    ('utahime', 2.05::numeric, 1, 0.0::numeric),
    ('shoko', 2.05::numeric, 1, 0.0::numeric)
),
updated as (
  update public.card_definitions cd
  set ultimate = coalesce(cd.ultimate, '{}'::jsonb) || jsonb_build_object(
    'animation_lock_msec', 2500,
    'cast_duration_sec', 2.5,
    'impact_delay_sec', ultimate_timings.impact_delay_sec,
    'hit_count', ultimate_timings.hit_count,
    'hit_interval_sec', ultimate_timings.hit_interval_sec
  )
  from ultimate_timings
  where lower(cd.character_key) = ultimate_timings.character_key
    and upper(cd.card_type) in ('BASE', 'DEFINITIVA')
  returning cd.card_key
)
select count(*) as updated_rows from updated;

commit;
