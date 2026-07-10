begin;

-- Repair healing/self-sustain ultimates that may have been left null or partial
-- by earlier healing-only patches. This is safe to rerun.

with canonical_ultimates(character_key, card_type, ultimate_patch) as (
  values
    (
      'mahoraga',
      'BASE',
      jsonb_build_object(
        'key', 'mahoraga_base_ultimate',
        'name', 'Adaptacion de la Rueda',
        'type', 'SELF_BUFF',
        'target_rule', 'SELF',
        'area_rule', 'SELF',
        'area_lanes', 0,
        'power', 1,
        'fixed_heal_amount', 600,
        'heal_scaling_mode', 'LEVEL_DELTA',
        'damage_multiplier_per_stack', 1.1,
        'scale_multiplier_per_stack', 1.15,
        'max_stacks', 5,
        'energy_cost', 75,
        'animation_lock_msec', 2500,
        'cast_duration_sec', 2.5,
        'impact_delay_sec', 2.25,
        'hit_count', 1,
        'hit_interval_sec', 0,
        'vfx_key', 'mahoraga_wheel_adaptation'
      )
    ),
    (
      'utahime',
      'BASE',
      jsonb_build_object(
        'key', 'utahime_base_ultimate',
        'name', 'Ritual de Bendicion',
        'type', 'HEAL',
        'target_rule', 'LOWEST_HP_ALLY',
        'area_rule', 'SINGLE_TARGET',
        'area_lanes', 0,
        'power', 1,
        'fixed_heal_amount', 470,
        'heal_scaling_mode', 'LEVEL_DELTA',
        'energy_cost', 75,
        'animation_lock_msec', 2500,
        'cast_duration_sec', 2.5,
        'impact_delay_sec', 2.05,
        'hit_count', 1,
        'hit_interval_sec', 0,
        'vfx_key', 'utahime_blessing_ritual'
      )
    ),
    (
      'shoko',
      'BASE',
      jsonb_build_object(
        'key', 'shoko_base_ultimate',
        'name', 'Tecnica Inversa: Proteccion',
        'type', 'HEAL',
        'target_rule', 'LOWEST_HP_ALLY',
        'area_rule', 'SINGLE_TARGET',
        'area_lanes', 0,
        'power', 1,
        'fixed_heal_amount', 300,
        'shield_amount', 250,
        'shield_duration_sec', 6,
        'heal_scaling_mode', 'LEVEL_DELTA',
        'energy_cost', 75,
        'animation_lock_msec', 2500,
        'cast_duration_sec', 2.5,
        'impact_delay_sec', 2.05,
        'hit_count', 1,
        'hit_interval_sec', 0,
        'vfx_key', 'shoko_reverse_shield'
      )
    ),
    (
      'utahime',
      'DEFINITIVA',
      jsonb_build_object(
        'key', 'utahime_definitiva_ultimate',
        'name', 'Ritual de Bendicion',
        'type', 'HEAL',
        'target_rule', 'LOWEST_HP_ALLY',
        'area_rule', 'SINGLE_TARGET',
        'area_lanes', 0,
        'power', 1,
        'fixed_heal_amount', 500,
        'heal_scaling_mode', 'LEVEL_DELTA',
        'energy_cost', 70,
        'animation_lock_msec', 2500,
        'cast_duration_sec', 2.5,
        'impact_delay_sec', 2.05,
        'hit_count', 1,
        'hit_interval_sec', 0,
        'vfx_key', 'utahime_blessing_ritual'
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
