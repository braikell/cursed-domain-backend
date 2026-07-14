begin;

-- Yuji Black Flash should only clip one extra enemy when that enemy is
-- genuinely clustered around the primary target. TWO_CLOSEST_ENEMIES has no
-- distance limit, so it can hit a far backline unit just because it is second.
update public.card_definitions
set ultimate = coalesce(ultimate, '{}'::jsonb)
  || jsonb_build_object(
    'area_rule', 'PRIMARY_AND_CLOSE_ENEMIES',
    'area_lanes', 0,
    'secondary_target_count', 1,
    'secondary_target_radius_px', 90
  )
where lower(character_key) = 'yuji'
  and upper(card_type) in ('BASE', 'DEFINITIVA');

commit;
