-- Backfill card duplicate fragments into the canonical material store.
-- Duplicate fragments are consumed from player_saves.save.fragments / user_materials.
-- user_cards.fragments may already contain older duplicate rewards, so copy the
-- greatest known value without double-counting existing material rows.

with card_fragment_rows as (
  select
    user_id,
    case
      when upper(coalesce(card_type, 'BASE')) = 'DEFINITIVA'
        then 'fragment:definitive:' || coalesce(nullif(character_key, ''), character_id)
      else 'fragment:' || coalesce(nullif(character_key, ''), character_id)
    end as material_id,
    greatest(0, coalesce(fragments, 0))::integer as quantity
  from public.user_cards
  where coalesce(fragments, 0) > 0
)
insert into public.user_materials (user_id, material_id, quantity, updated_at)
select user_id, material_id, max(quantity), now()
from card_fragment_rows
where material_id is not null
  and material_id <> 'fragment:'
  and material_id <> 'fragment:definitive:'
group by user_id, material_id
on conflict (user_id, material_id) do update
set quantity = greatest(public.user_materials.quantity, excluded.quantity),
    updated_at = now();

with save_fragment_entries as (
  select
    ps.user_id,
    case
      when entry.key like '%:%' then lower(entry.key)
      else 'fragment:' || lower(entry.key)
    end as material_id,
    greatest(
      0,
      floor(
        case
          when (entry.value #>> '{}') ~ '^-?[0-9]+(\.[0-9]+)?$' then (entry.value #>> '{}')::numeric
          else 0
        end
      )
    )::integer as quantity
  from public.player_saves ps
  cross join lateral jsonb_each(coalesce(ps.save->'fragments', '{}'::jsonb)) as entry(key, value)
),
material_fragment_entries as (
  select
    user_id,
    lower(material_id) as material_id,
    greatest(0, quantity)::integer as quantity
  from public.user_materials
  where quantity > 0
),
canonical_fragment_rows as (
  select user_id, material_id, max(quantity) as quantity
  from (
    select user_id, material_id, quantity from save_fragment_entries
    union all
    select user_id, material_id, quantity from material_fragment_entries
  ) source
  where material_id is not null
    and material_id <> ''
    and quantity > 0
  group by user_id, material_id
),
material_fragment_rows as (
  select
    user_id,
    jsonb_object_agg(material_id, quantity) as fragment_payload
  from canonical_fragment_rows
  group by user_id
)
update public.player_saves ps
set save = jsonb_set(
    coalesce(ps.save, '{}'::jsonb),
    '{fragments}',
    material_fragment_rows.fragment_payload,
    true
  ),
  updated_at = now()
from material_fragment_rows
where ps.user_id = material_fragment_rows.user_id;
