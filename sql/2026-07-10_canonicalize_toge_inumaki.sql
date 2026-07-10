begin;

-- Toge Inumaki has one canonical runtime identity:
--   character_key/card character id: toge
--   base card key:                 toge_base_basic
--
-- Older data may still contain the alias "inumaki". Merge that alias into the
-- canonical row before disabling the legacy catalog entry.

update public.card_definitions
set is_enabled = false
where lower(coalesce(character_key, '')) = 'inumaki'
   or lower(coalesce(card_key, '')) like 'inumaki%';

with candidate_cards as (
  select
    uc.*,
    first_value(uc.id) over (
      partition by uc.user_id
      order by
        case
          when lower(coalesce(uc.card_definition_id, '')) = 'toge_base_basic'
           and lower(coalesce(uc.card_key, '')) = 'toge_base_basic'
           and lower(coalesce(nullif(uc.character_key, ''), nullif(uc.character_id, ''), '')) = 'toge'
            then 0
          when lower(coalesce(nullif(uc.card_definition_id, ''), nullif(uc.card_key, ''), '')) = 'toge_base_basic'
            then 1
          else 2
        end,
        coalesce(uc.acquired_at, 'infinity'::timestamptz),
        uc.id
    ) as keeper_id
  from public.user_cards uc
  where upper(coalesce(uc.card_type, 'BASE')) = 'BASE'
    and (
      lower(coalesce(nullif(uc.character_key, ''), nullif(uc.character_id, ''), '')) in ('toge', 'inumaki')
      or lower(coalesce(nullif(uc.card_key, ''), nullif(uc.card_definition_id, ''), '')) in ('toge_base_basic', 'inumaki_base_basic')
      or lower(coalesce(nullif(uc.card_definition_id, ''), nullif(uc.card_key, ''), '')) in ('toge_base_basic', 'inumaki_base_basic')
    )
),
card_rollup as (
  select
    user_id,
    keeper_id,
    max(level) as level,
    max(xp) as xp,
    max(stars) as stars,
    max(ascension) as ascension,
    max(awakening) as awakening,
    max(fragments) as fragments,
    max(energy) as energy,
    max(max_energy) as max_energy,
    bool_or(coalesce(is_starter, false)) as is_starter,
    min(acquired_at) as acquired_at,
    max(updated_at) as updated_at,
    count(*) as source_count
  from candidate_cards
  group by user_id, keeper_id
),
updated_keepers as (
  update public.user_cards uc
  set
    card_definition_id = 'toge_base_basic',
    card_key = 'toge_base_basic',
    character_id = 'toge',
    character_key = 'toge',
    variant = 'base',
    card_type = 'BASE',
    rarity = 'basic',
    definition_rarity = 'COMMON',
    level = greatest(coalesce(uc.level, 1), coalesce(cr.level, 1)),
    xp = greatest(coalesce(uc.xp, 0), coalesce(cr.xp, 0)),
    stars = greatest(coalesce(uc.stars, 1), coalesce(cr.stars, 1)),
    ascension = greatest(coalesce(uc.ascension, 0), coalesce(cr.ascension, 0)),
    awakening = greatest(coalesce(uc.awakening, 0), coalesce(cr.awakening, 0)),
    fragments = greatest(coalesce(uc.fragments, 0), coalesce(cr.fragments, 0)),
    energy = greatest(coalesce(uc.energy, 0), coalesce(cr.energy, 0)),
    max_energy = greatest(coalesce(uc.max_energy, 100), coalesce(cr.max_energy, 100)),
    is_starter = coalesce(uc.is_starter, false) or coalesce(cr.is_starter, false),
    acquired_at = least(coalesce(uc.acquired_at, cr.acquired_at), coalesce(cr.acquired_at, uc.acquired_at)),
    updated_at = now()
  from card_rollup cr
  where uc.id = cr.keeper_id
  returning uc.user_id, uc.id as keeper_id
),
duplicate_card_map as (
  select cc.user_id, cc.id as duplicate_id, cc.keeper_id
  from candidate_cards cc
  where cc.id <> cc.keeper_id
),
updated_slots as (
  update public.user_formation_slots ufs
  set user_card_id = dcm.keeper_id
  from duplicate_card_map dcm
  where ufs.user_card_id = dcm.duplicate_id
  returning ufs.formation_id, ufs.user_card_id
),
deleted_duplicate_cards as (
  delete from public.user_cards uc
  using duplicate_card_map dcm
  where uc.id = dcm.duplicate_id
  returning uc.user_id, uc.id
),
duplicate_formation_slots as (
  select ctid
  from (
    select
      ctid,
      row_number() over (
        partition by formation_id, user_card_id
        order by team_position asc, board_slot asc, updated_at desc nulls last
      ) as duplicate_rank
    from public.user_formation_slots
    where user_card_id in (select keeper_id from updated_keepers)
  ) ranked_slots
  where duplicate_rank > 1
),
deleted_duplicate_slots as (
  delete from public.user_formation_slots ufs
  using duplicate_formation_slots dfs
  where ufs.ctid = dfs.ctid
  returning ufs.formation_id, ufs.user_card_id
)
select
  'toge_user_cards_merged' as status,
  (select coalesce(sum(source_count - 1), 0) from card_rollup) as deleted_duplicate_card_rows,
  (select count(*) from updated_slots) as redirected_formation_slots,
  (select count(*) from deleted_duplicate_slots) as deleted_duplicate_formation_slots;

with material_candidates as (
  select
    ctid,
    user_id,
    lower(coalesce(material_id, '')) as material_id,
    coalesce(quantity, 0) as quantity,
    case lower(coalesce(material_id, ''))
      when 'element:inumaki_base_basic' then 'element:toge_base_basic'
      when 'element:toge_base_basic' then 'element:toge_base_basic'
      when 'fragment:inumaki' then 'fragment:toge'
      when 'fragment:toge' then 'fragment:toge'
      when 'fragment:definitive:inumaki' then 'fragment:definitive:toge'
      when 'fragment:definitive:toge' then 'fragment:definitive:toge'
      else lower(coalesce(material_id, ''))
    end as canonical_material_id
  from public.user_materials
  where lower(coalesce(material_id, '')) in (
    'element:inumaki_base_basic',
    'element:toge_base_basic',
    'fragment:inumaki',
    'fragment:toge',
    'fragment:definitive:inumaki',
    'fragment:definitive:toge'
  )
),
ranked_materials as (
  select
    *,
    first_value(ctid) over (
      partition by user_id, canonical_material_id
      order by
        case when material_id = canonical_material_id then 0 else 1 end,
        ctid
    ) as keeper_ctid
  from material_candidates
),
material_rollup as (
  select
    user_id,
    canonical_material_id,
    keeper_ctid,
    sum(quantity) as quantity,
    count(*) as source_count
  from ranked_materials
  group by user_id, canonical_material_id, keeper_ctid
),
updated_materials as (
  update public.user_materials um
  set
    material_id = mr.canonical_material_id,
    quantity = mr.quantity,
    updated_at = now()
  from material_rollup mr
  where um.ctid = mr.keeper_ctid
  returning um.user_id, um.material_id
),
deleted_materials as (
  delete from public.user_materials um
  using ranked_materials rm
  where um.ctid = rm.ctid
    and rm.ctid <> rm.keeper_ctid
  returning um.user_id, um.material_id
)
select
  'toge_materials_merged' as status,
  (select count(*) from updated_materials) as canonical_material_rows,
  (select count(*) from deleted_materials) as deleted_duplicate_material_rows;

create unique index if not exists user_cards_one_toge_base_per_user_uidx
  on public.user_cards (user_id)
  where upper(coalesce(card_type, 'BASE')) = 'BASE'
    and (
      lower(coalesce(nullif(character_key, ''), nullif(character_id, ''), '')) in ('toge', 'inumaki')
      or lower(coalesce(nullif(card_key, ''), nullif(card_definition_id, ''), '')) in ('toge_base_basic', 'inumaki_base_basic')
      or lower(coalesce(nullif(card_definition_id, ''), nullif(card_key, ''), '')) in ('toge_base_basic', 'inumaki_base_basic')
    );

commit;
