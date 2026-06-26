begin;

alter table public.card_definitions
  add column if not exists ultimate jsonb;

with prepared as (
  select
    cd.card_key,
    jsonb_build_object(
      'key', lower(cd.character_key) || '_' || lower(cd.card_type) || '_ultimate',
      'name',
        'Ultimate ' ||
        case when upper(cd.card_type) = 'DEFINITIVA' then 'Definitiva' else 'Base' end ||
        ' de ' ||
        regexp_replace(
          coalesce(nullif(cd.display_name, ''), initcap(replace(cd.character_key, '_', ' '))),
          '\s+(Base|Definitiva)$',
          '',
          'i'
        ),
      'type',
        case upper(cd.role)
          when 'DPS_MAGICO' then 'AOE_DAMAGE'
          when 'DPS_DEBUFFER' then 'DEBUFF'
          when 'INVOCADOR' then 'SUMMON'
          when 'SOPORTE' then 'HEAL'
          else 'SINGLE_DAMAGE'
        end,
      'target_rule',
        case upper(cd.role)
          when 'INVOCADOR' then 'SELF'
          when 'SOPORTE' then 'ALL_ALLIES'
          else 'NEAREST_ENEMY'
        end,
      'area_rule',
        case upper(cd.role)
          when 'DPS_MAGICO' then 'LANES_AROUND_TARGET'
          when 'DPS_DEBUFFER' then 'SAME_LANE'
          when 'INVOCADOR' then 'SELF'
          when 'SOPORTE' then 'ALL_ALLIES'
          else 'SINGLE_TARGET'
        end,
      'area_lanes',
        case upper(cd.role)
          when 'DPS_MAGICO' then case when upper(cd.card_type) = 'DEFINITIVA' then 2 else 1 end
          when 'DPS_DEBUFFER' then case when upper(cd.card_type) = 'DEFINITIVA' then 1 else 0 end
          when 'SOPORTE' then 2
          else 0
        end,
      'power',
        case upper(cd.role)
          when 'DPS_FISICO' then case when upper(cd.card_type) = 'DEFINITIVA' then 4.2 else 3.0 end
          when 'DPS_MAGICO' then 2.6
          when 'DPS_DEBUFFER' then 2.0
          when 'INVOCADOR' then 2.0
          when 'SOPORTE' then case when upper(cd.card_type) = 'DEFINITIVA' then 3.0 else 2.0 end
          else case when upper(cd.card_type) = 'DEFINITIVA' then 4.2 else 3.0 end
        end,
      'energy_cost', 50,
      'vfx_key',
        case upper(cd.role)
          when 'DPS_FISICO' then 'physical_ultimate_burst'
          when 'DPS_MAGICO' then 'magic_ultimate_area'
          when 'DPS_DEBUFFER' then 'debuff_ultimate_curse'
          when 'INVOCADOR' then 'summoner_ultimate_ritual'
          when 'SOPORTE' then 'support_ultimate_heal'
          else 'default_ultimate_vfx'
        end
    ) as generated_ultimate
  from public.card_definitions cd
),
updated as (
  update public.card_definitions cd
  set ultimate = prepared.generated_ultimate
  from prepared
  where cd.card_key = prepared.card_key
    and (
      cd.ultimate is distinct from prepared.generated_ultimate
      or
      cd.ultimate is null
      or cd.ultimate = '{}'::jsonb
      or jsonb_typeof(cd.ultimate) <> 'object'
      or coalesce((cd.ultimate ->> 'energy_cost')::int, -1) <> 50
      or not (cd.ultimate ?& array[
        'key',
        'name',
        'type',
        'target_rule',
        'area_rule',
        'area_lanes',
        'power',
        'energy_cost',
        'vfx_key'
      ])
    )
  returning cd.card_key
)
select count(*) as updated_rows from updated;

commit;

-- Verificacion sugerida en Supabase:
-- select
--   count(*) as total_cards,
--   count(*) filter (
--     where ultimate is not null
--       and jsonb_typeof(ultimate) = 'object'
--       and ultimate ?& array[
--         'key','name','type','target_rule','area_rule',
--         'area_lanes','power','energy_cost','vfx_key'
--       ]
--   ) as cards_with_valid_ultimate
-- from public.card_definitions;

