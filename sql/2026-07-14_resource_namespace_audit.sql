-- Auditoria no destructiva de namespaces canonicos de recursos.
-- Debe devolver 0 filas en invalid_material_namespaces antes del wipe final.

with material_rows as (
  select
    user_id,
    material_id,
    quantity,
    case
      when material_id like 'gear_mats:%' then 'gear_mats'
      when material_id like 'element:%' then 'element'
      when material_id like 'fragment:%' then 'fragment'
      else 'invalid'
    end as namespace
  from public.user_materials
),
invalid_material_namespaces as (
  select *
  from material_rows
  where namespace = 'invalid'
     or coalesce(quantity, 0) <= 0
),
save_fragment_rows as (
  select
    ps.user_id,
    entry.key as material_id,
    entry.value as quantity_json,
    case
      when entry.key like 'gear_mats:%' then 'gear_mats'
      when entry.key like 'element:%' then 'element'
      when entry.key like 'fragment:%' then 'fragment'
      else 'invalid'
    end as namespace
  from public.player_saves ps
  cross join lateral jsonb_each(coalesce(ps.save->'fragments', '{}'::jsonb)) as entry(key, value)
),
invalid_save_fragment_namespaces as (
  select *
  from save_fragment_rows
  where namespace = 'invalid'
     or not (jsonb_typeof(quantity_json) = 'number')
     or (quantity_json::text)::numeric <= 0
)
select
  'user_materials' as source,
  count(*) as invalid_rows
from invalid_material_namespaces
union all
select
  'player_saves.save.fragments' as source,
  count(*) as invalid_rows
from invalid_save_fragment_namespaces;
