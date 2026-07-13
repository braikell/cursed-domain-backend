begin;

-- Canonical Yuta Okkotsu ultimate.
-- Runtime combat uses card_balance.json + UltimateCastVFX.gd, but the remote
-- card_definitions catalog must stay aligned so UI/catalog consumers do not
-- restore the old generic summoner ultimate.
--
-- Safe to rerun.

with canonical_ultimates(character_key, card_type, ultimate_patch) as (
  values
    (
      'yuta',
      'BASE',
      jsonb_build_object(
        'key', 'yuta_base_ultimate',
        'name', 'Manifestacion de Rika',
        'type', 'SUMMON',
        'target_rule', 'NEAREST_ENEMY',
        'area_rule', 'SINGLE_TARGET',
        'area_lanes', 0,
        'power', 2,
        'energy_cost', 75,
        'animation_lock_msec', 2500,
        'cast_duration_sec', 2.5,
        'impact_delay_sec', 1.15,
        'hit_count', 3,
        'hit_interval_sec', 0.42,
        'vfx_key', 'yuta_rika_manifestation'
      )
    ),
    (
      'yuta',
      'DEFINITIVA',
      jsonb_build_object(
        'key', 'yuta_definitiva_ultimate',
        'name', 'Manifestacion de Rika',
        'type', 'SUMMON',
        'target_rule', 'NEAREST_ENEMY',
        'area_rule', 'SINGLE_TARGET',
        'area_lanes', 0,
        'power', 2,
        'energy_cost', 70,
        'animation_lock_msec', 2500,
        'cast_duration_sec', 2.5,
        'impact_delay_sec', 1.15,
        'hit_count', 3,
        'hit_interval_sec', 0.42,
        'vfx_key', 'yuta_rika_manifestation'
      )
    )
),
updated as (
  update public.card_definitions cd
  set ultimate = jsonb_strip_nulls(coalesce(cd.ultimate, '{}'::jsonb) || canonical_ultimates.ultimate_patch)
  from canonical_ultimates
  where lower(cd.character_key) = canonical_ultimates.character_key
    and upper(cd.card_type) = canonical_ultimates.card_type
  returning cd.card_key
)
select count(*) as updated_rows from updated;

commit;
