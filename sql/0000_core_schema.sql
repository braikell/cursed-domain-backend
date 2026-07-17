-- ============================================================
-- Original: 2026-06-23_card_definitions_ultimate_backfill.sql
-- ============================================================
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
      'energy_cost',
        case when upper(cd.card_type) = 'DEFINITIVA' then 70 else 75 end,
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
      or coalesce((cd.ultimate ->> 'energy_cost')::int, -1) <> case when upper(cd.card_type) = 'DEFINITIVA' then 70 else 75 end
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

-- ============================================================
-- Original: 2026-06-23_enemy_definitions_curse_overhaul.sql
-- ============================================================
begin;

alter table public.enemy_definitions
  add column if not exists display_name text,
  add column if not exists name text,
  add column if not exists level integer default 1,
  add column if not exists base_hp integer default 1,
  add column if not exists base_ad integer default 0,
  add column if not exists base_ap integer default 0,
  add column if not exists base_def integer default 0,
  add column if not exists base_res integer default 0,
  add column if not exists base_pm integer default 1,
  add column if not exists base_atk integer default 1,
  add column if not exists base_speed double precision default 1.0,
  add column if not exists base_vel double precision default 1.0,
  add column if not exists rarity text,
  add column if not exists role text,
  add column if not exists enemy_type text,
  add column if not exists enemy_grade text,
  add column if not exists damage_type text,
  add column if not exists scaling text,
  add column if not exists ad integer,
  add column if not exists ap integer,
  add column if not exists hp integer,
  add column if not exists vel double precision,
  add column if not exists pm integer,
  add column if not exists atk integer,
  add column if not exists speed double precision,
  add column if not exists attack_range double precision,
  add column if not exists desired_range double precision,
  add column if not exists move_speed double precision,
  add column if not exists attack_interval double precision,
  add column if not exists max_energy integer,
  add column if not exists ultimate_energy_cost integer,
  add column if not exists crit_chance double precision,
  add column if not exists crit_damage double precision,
  add column if not exists basic_skill jsonb,
  add column if not exists ultimate jsonb,
  add column if not exists sprite_key text default '',
  add column if not exists art_path text,
  add column if not exists schema_version integer,
  add column if not exists sort_order integer,
  add column if not exists is_enabled boolean default true,
  add column if not exists updated_at timestamptz default now();

alter table public.encounter_enemy_entries
  add column if not exists slot_index integer,
  add column if not exists lane_index integer,
  add column if not exists sort_order integer,
  add column if not exists is_enabled boolean default true;

with enemy_seed as (
  select *
  from jsonb_to_recordset(
    '[
      {"enemy_key":"curse_d_dps_fisico","enemy_type":"CURSE","enemy_grade":"D","rarity":"COMMON","display_name":"Maldicion Brutal Grado D","role":"DPS_FISICO","damage_type":"PHYSICAL","scaling":"PHYSICAL","ad":34,"ap":0,"hp":1400,"vel":0.68,"pm":228,"atk":34,"speed":0.68,"attack_range":100.0,"desired_range":95.0,"move_speed":50.0,"attack_interval":1.55,"max_energy":100,"ultimate_energy_cost":100,"crit_chance":0.04,"crit_damage":1.5,"basic_skill":{},"ultimate":{"key":"curse_d_dps_fisico_ultimate","name":"Ultimate de Maldicion Brutal Grado D","type":"SINGLE_DAMAGE","target_rule":"NEAREST_ENEMY","area_rule":"SINGLE_TARGET","area_lanes":0,"power":1.65,"energy_cost":100,"vfx_key":"physical_ultimate_burst"},"art_path":"","schema_version":1,"sort_order":110},
      {"enemy_key":"curse_c_dps_fisico","enemy_type":"CURSE","enemy_grade":"C","rarity":"COMMON","display_name":"Maldicion Brutal Grado C","role":"DPS_FISICO","damage_type":"PHYSICAL","scaling":"PHYSICAL","ad":38,"ap":0,"hp":1580,"vel":0.68,"pm":250,"atk":38,"speed":0.68,"attack_range":100.0,"desired_range":95.0,"move_speed":50.0,"attack_interval":1.55,"max_energy":100,"ultimate_energy_cost":100,"crit_chance":0.04,"crit_damage":1.5,"basic_skill":{},"ultimate":{"key":"curse_c_dps_fisico_ultimate","name":"Ultimate de Maldicion Brutal Grado C","type":"SINGLE_DAMAGE","target_rule":"NEAREST_ENEMY","area_rule":"SINGLE_TARGET","area_lanes":0,"power":1.65,"energy_cost":100,"vfx_key":"physical_ultimate_burst"},"art_path":"","schema_version":1,"sort_order":210},
      {"enemy_key":"curse_b_dps_fisico","enemy_type":"CURSE","enemy_grade":"B","rarity":"EPIC","display_name":"Maldicion Brutal Grado B","role":"DPS_FISICO","damage_type":"PHYSICAL","scaling":"PHYSICAL","ad":42,"ap":0,"hp":1760,"vel":0.68,"pm":272,"atk":42,"speed":0.68,"attack_range":100.0,"desired_range":95.0,"move_speed":50.0,"attack_interval":1.55,"max_energy":100,"ultimate_energy_cost":100,"crit_chance":0.04,"crit_damage":1.5,"basic_skill":{},"ultimate":{"key":"curse_b_dps_fisico_ultimate","name":"Ultimate de Maldicion Brutal Grado B","type":"SINGLE_DAMAGE","target_rule":"NEAREST_ENEMY","area_rule":"SINGLE_TARGET","area_lanes":0,"power":1.65,"energy_cost":100,"vfx_key":"physical_ultimate_burst"},"art_path":"","schema_version":1,"sort_order":310},
      {"enemy_key":"curse_a_dps_fisico","enemy_type":"CURSE","enemy_grade":"A","rarity":"LEGENDARY","display_name":"Maldicion Brutal Grado A","role":"DPS_FISICO","damage_type":"PHYSICAL","scaling":"PHYSICAL","ad":46,"ap":0,"hp":1960,"vel":0.68,"pm":296,"atk":46,"speed":0.68,"attack_range":100.0,"desired_range":95.0,"move_speed":50.0,"attack_interval":1.55,"max_energy":100,"ultimate_energy_cost":100,"crit_chance":0.04,"crit_damage":1.5,"basic_skill":{},"ultimate":{"key":"curse_a_dps_fisico_ultimate","name":"Ultimate de Maldicion Brutal Grado A","type":"SINGLE_DAMAGE","target_rule":"NEAREST_ENEMY","area_rule":"SINGLE_TARGET","area_lanes":0,"power":1.65,"energy_cost":100,"vfx_key":"physical_ultimate_burst"},"art_path":"","schema_version":1,"sort_order":410},
      {"enemy_key":"curse_s_dps_fisico","enemy_type":"CURSE","enemy_grade":"S","rarity":"MYTHIC","display_name":"Maldicion Brutal Grado S","role":"DPS_FISICO","damage_type":"PHYSICAL","scaling":"PHYSICAL","ad":50,"ap":0,"hp":2180,"vel":0.68,"pm":322,"atk":50,"speed":0.68,"attack_range":100.0,"desired_range":95.0,"move_speed":50.0,"attack_interval":1.55,"max_energy":100,"ultimate_energy_cost":100,"crit_chance":0.04,"crit_damage":1.5,"basic_skill":{},"ultimate":{"key":"curse_s_dps_fisico_ultimate","name":"Ultimate de Maldicion Brutal Grado S","type":"SINGLE_DAMAGE","target_rule":"NEAREST_ENEMY","area_rule":"SINGLE_TARGET","area_lanes":0,"power":1.65,"energy_cost":100,"vfx_key":"physical_ultimate_burst"},"art_path":"","schema_version":1,"sort_order":510},
      {"enemy_key":"curse_s_plus_dps_fisico","enemy_type":"CURSE","enemy_grade":"S+","rarity":"MYTHIC","display_name":"Maldicion Brutal Grado S+","role":"DPS_FISICO","damage_type":"PHYSICAL","scaling":"PHYSICAL","ad":54,"ap":0,"hp":2420,"vel":0.68,"pm":350,"atk":54,"speed":0.68,"attack_range":100.0,"desired_range":95.0,"move_speed":50.0,"attack_interval":1.55,"max_energy":100,"ultimate_energy_cost":100,"crit_chance":0.04,"crit_damage":1.5,"basic_skill":{},"ultimate":{"key":"curse_s_plus_dps_fisico_ultimate","name":"Ultimate de Maldicion Brutal Grado S+","type":"SINGLE_DAMAGE","target_rule":"NEAREST_ENEMY","area_rule":"SINGLE_TARGET","area_lanes":0,"power":1.65,"energy_cost":100,"vfx_key":"physical_ultimate_burst"},"art_path":"","schema_version":1,"sort_order":610},
      {"enemy_key":"curse_d_dps_magico","enemy_type":"CURSE","enemy_grade":"D","rarity":"COMMON","display_name":"Maldicion Hostigadora Grado D","role":"DPS_MAGICO","damage_type":"MAGICAL","scaling":"MAGICAL","ad":0,"ap":78,"hp":850,"vel":0.84,"pm":230,"atk":78,"speed":0.84,"attack_range":500.0,"desired_range":487.4,"move_speed":40.0,"attack_interval":1.55,"max_energy":100,"ultimate_energy_cost":100,"crit_chance":0.04,"crit_damage":1.5,"basic_skill":{},"ultimate":{"key":"curse_d_dps_magico_ultimate","name":"Ultimate de Maldicion Hostigadora Grado D","type":"AOE_DAMAGE","target_rule":"NEAREST_ENEMY","area_rule":"LANES_AROUND_TARGET","area_lanes":1,"power":1.43,"energy_cost":100,"vfx_key":"magic_ultimate_area"},"art_path":"","schema_version":1,"sort_order":120},
      {"enemy_key":"curse_c_dps_magico","enemy_type":"CURSE","enemy_grade":"C","rarity":"COMMON","display_name":"Maldicion Hostigadora Grado C","role":"DPS_MAGICO","damage_type":"MAGICAL","scaling":"MAGICAL","ad":0,"ap":92,"hp":980,"vel":0.84,"pm":257,"atk":92,"speed":0.84,"attack_range":500.0,"desired_range":487.4,"move_speed":40.0,"attack_interval":1.55,"max_energy":100,"ultimate_energy_cost":100,"crit_chance":0.04,"crit_damage":1.5,"basic_skill":{},"ultimate":{"key":"curse_c_dps_magico_ultimate","name":"Ultimate de Maldicion Hostigadora Grado C","type":"AOE_DAMAGE","target_rule":"NEAREST_ENEMY","area_rule":"LANES_AROUND_TARGET","area_lanes":1,"power":1.43,"energy_cost":100,"vfx_key":"magic_ultimate_area"},"art_path":"","schema_version":1,"sort_order":220},
      {"enemy_key":"curse_b_dps_magico","enemy_type":"CURSE","enemy_grade":"B","rarity":"EPIC","display_name":"Maldicion Hostigadora Grado B","role":"DPS_MAGICO","damage_type":"MAGICAL","scaling":"MAGICAL","ad":0,"ap":108,"hp":1110,"vel":0.84,"pm":286,"atk":108,"speed":0.84,"attack_range":500.0,"desired_range":487.4,"move_speed":40.0,"attack_interval":1.55,"max_energy":100,"ultimate_energy_cost":100,"crit_chance":0.04,"crit_damage":1.5,"basic_skill":{},"ultimate":{"key":"curse_b_dps_magico_ultimate","name":"Ultimate de Maldicion Hostigadora Grado B","type":"AOE_DAMAGE","target_rule":"NEAREST_ENEMY","area_rule":"LANES_AROUND_TARGET","area_lanes":1,"power":1.43,"energy_cost":100,"vfx_key":"magic_ultimate_area"},"art_path":"","schema_version":1,"sort_order":320},
      {"enemy_key":"curse_a_dps_magico","enemy_type":"CURSE","enemy_grade":"A","rarity":"LEGENDARY","display_name":"Maldicion Hostigadora Grado A","role":"DPS_MAGICO","damage_type":"MAGICAL","scaling":"MAGICAL","ad":0,"ap":126,"hp":1260,"vel":0.84,"pm":319,"atk":126,"speed":0.84,"attack_range":500.0,"desired_range":487.4,"move_speed":40.0,"attack_interval":1.55,"max_energy":100,"ultimate_energy_cost":100,"crit_chance":0.04,"crit_damage":1.5,"basic_skill":{},"ultimate":{"key":"curse_a_dps_magico_ultimate","name":"Ultimate de Maldicion Hostigadora Grado A","type":"AOE_DAMAGE","target_rule":"NEAREST_ENEMY","area_rule":"LANES_AROUND_TARGET","area_lanes":1,"power":1.43,"energy_cost":100,"vfx_key":"magic_ultimate_area"},"art_path":"","schema_version":1,"sort_order":420},
      {"enemy_key":"curse_s_dps_magico","enemy_type":"CURSE","enemy_grade":"S","rarity":"MYTHIC","display_name":"Maldicion Hostigadora Grado S","role":"DPS_MAGICO","damage_type":"MAGICAL","scaling":"MAGICAL","ad":0,"ap":146,"hp":1420,"vel":0.84,"pm":355,"atk":146,"speed":0.84,"attack_range":500.0,"desired_range":487.4,"move_speed":40.0,"attack_interval":1.55,"max_energy":100,"ultimate_energy_cost":100,"crit_chance":0.04,"crit_damage":1.5,"basic_skill":{},"ultimate":{"key":"curse_s_dps_magico_ultimate","name":"Ultimate de Maldicion Hostigadora Grado S","type":"AOE_DAMAGE","target_rule":"NEAREST_ENEMY","area_rule":"LANES_AROUND_TARGET","area_lanes":1,"power":1.43,"energy_cost":100,"vfx_key":"magic_ultimate_area"},"art_path":"","schema_version":1,"sort_order":520},
      {"enemy_key":"curse_s_plus_dps_magico","enemy_type":"CURSE","enemy_grade":"S+","rarity":"MYTHIC","display_name":"Maldicion Hostigadora Grado S+","role":"DPS_MAGICO","damage_type":"MAGICAL","scaling":"MAGICAL","ad":0,"ap":168,"hp":1590,"vel":0.84,"pm":394,"atk":168,"speed":0.84,"attack_range":500.0,"desired_range":487.4,"move_speed":40.0,"attack_interval":1.55,"max_energy":100,"ultimate_energy_cost":100,"crit_chance":0.04,"crit_damage":1.5,"basic_skill":{},"ultimate":{"key":"curse_s_plus_dps_magico_ultimate","name":"Ultimate de Maldicion Hostigadora Grado S+","type":"AOE_DAMAGE","target_rule":"NEAREST_ENEMY","area_rule":"LANES_AROUND_TARGET","area_lanes":1,"power":1.43,"energy_cost":100,"vfx_key":"magic_ultimate_area"},"art_path":"","schema_version":1,"sort_order":620},
      {"enemy_key":"curse_d_dps_debuffer","enemy_type":"CURSE","enemy_grade":"D","rarity":"COMMON","display_name":"Maldicion Corruptora Grado D","role":"DPS_DEBUFFER","damage_type":"TRUE","scaling":"HYBRID","ad":48,"ap":48,"hp":920,"vel":0.82,"pm":254,"atk":48,"speed":0.82,"attack_range":300.0,"desired_range":289.4,"move_speed":43.0,"attack_interval":1.55,"max_energy":100,"ultimate_energy_cost":100,"crit_chance":0.04,"crit_damage":1.5,"basic_skill":{},"ultimate":{"key":"curse_d_dps_debuffer_ultimate","name":"Ultimate de Maldicion Corruptora Grado D","type":"DEBUFF","target_rule":"NEAREST_ENEMY","area_rule":"SAME_LANE","area_lanes":0,"power":1.1,"energy_cost":100,"vfx_key":"debuff_ultimate_curse"},"art_path":"","schema_version":1,"sort_order":130},
      {"enemy_key":"curse_c_dps_debuffer","enemy_type":"CURSE","enemy_grade":"C","rarity":"COMMON","display_name":"Maldicion Corruptora Grado C","role":"DPS_DEBUFFER","damage_type":"TRUE","scaling":"HYBRID","ad":54,"ap":54,"hp":1040,"vel":0.82,"pm":278,"atk":54,"speed":0.82,"attack_range":300.0,"desired_range":289.4,"move_speed":43.0,"attack_interval":1.55,"max_energy":100,"ultimate_energy_cost":100,"crit_chance":0.04,"crit_damage":1.5,"basic_skill":{},"ultimate":{"key":"curse_c_dps_debuffer_ultimate","name":"Ultimate de Maldicion Corruptora Grado C","type":"DEBUFF","target_rule":"NEAREST_ENEMY","area_rule":"SAME_LANE","area_lanes":0,"power":1.1,"energy_cost":100,"vfx_key":"debuff_ultimate_curse"},"art_path":"","schema_version":1,"sort_order":230},
      {"enemy_key":"curse_b_dps_debuffer","enemy_type":"CURSE","enemy_grade":"B","rarity":"EPIC","display_name":"Maldicion Corruptora Grado B","role":"DPS_DEBUFFER","damage_type":"TRUE","scaling":"HYBRID","ad":61,"ap":61,"hp":1170,"vel":0.82,"pm":305,"atk":61,"speed":0.82,"attack_range":300.0,"desired_range":289.4,"move_speed":43.0,"attack_interval":1.55,"max_energy":100,"ultimate_energy_cost":100,"crit_chance":0.04,"crit_damage":1.5,"basic_skill":{},"ultimate":{"key":"curse_b_dps_debuffer_ultimate","name":"Ultimate de Maldicion Corruptora Grado B","type":"DEBUFF","target_rule":"NEAREST_ENEMY","area_rule":"SAME_LANE","area_lanes":0,"power":1.1,"energy_cost":100,"vfx_key":"debuff_ultimate_curse"},"art_path":"","schema_version":1,"sort_order":330},
      {"enemy_key":"curse_a_dps_debuffer","enemy_type":"CURSE","enemy_grade":"A","rarity":"LEGENDARY","display_name":"Maldicion Corruptora Grado A","role":"DPS_DEBUFFER","damage_type":"TRUE","scaling":"HYBRID","ad":68,"ap":68,"hp":1310,"vel":0.82,"pm":333,"atk":68,"speed":0.82,"attack_range":300.0,"desired_range":289.4,"move_speed":43.0,"attack_interval":1.55,"max_energy":100,"ultimate_energy_cost":100,"crit_chance":0.04,"crit_damage":1.5,"basic_skill":{},"ultimate":{"key":"curse_a_dps_debuffer_ultimate","name":"Ultimate de Maldicion Corruptora Grado A","type":"DEBUFF","target_rule":"NEAREST_ENEMY","area_rule":"SAME_LANE","area_lanes":0,"power":1.1,"energy_cost":100,"vfx_key":"debuff_ultimate_curse"},"art_path":"","schema_version":1,"sort_order":430},
      {"enemy_key":"curse_s_dps_debuffer","enemy_type":"CURSE","enemy_grade":"S","rarity":"MYTHIC","display_name":"Maldicion Corruptora Grado S","role":"DPS_DEBUFFER","damage_type":"TRUE","scaling":"HYBRID","ad":76,"ap":76,"hp":1460,"vel":0.82,"pm":364,"atk":76,"speed":0.82,"attack_range":300.0,"desired_range":289.4,"move_speed":43.0,"attack_interval":1.55,"max_energy":100,"ultimate_energy_cost":100,"crit_chance":0.04,"crit_damage":1.5,"basic_skill":{},"ultimate":{"key":"curse_s_dps_debuffer_ultimate","name":"Ultimate de Maldicion Corruptora Grado S","type":"DEBUFF","target_rule":"NEAREST_ENEMY","area_rule":"SAME_LANE","area_lanes":0,"power":1.1,"energy_cost":100,"vfx_key":"debuff_ultimate_curse"},"art_path":"","schema_version":1,"sort_order":530},
      {"enemy_key":"curse_s_plus_dps_debuffer","enemy_type":"CURSE","enemy_grade":"S+","rarity":"MYTHIC","display_name":"Maldicion Corruptora Grado S+","role":"DPS_DEBUFFER","damage_type":"TRUE","scaling":"HYBRID","ad":85,"ap":85,"hp":1620,"vel":0.82,"pm":398,"atk":85,"speed":0.82,"attack_range":300.0,"desired_range":289.4,"move_speed":43.0,"attack_interval":1.55,"max_energy":100,"ultimate_energy_cost":100,"crit_chance":0.04,"crit_damage":1.5,"basic_skill":{},"ultimate":{"key":"curse_s_plus_dps_debuffer_ultimate","name":"Ultimate de Maldicion Corruptora Grado S+","type":"DEBUFF","target_rule":"NEAREST_ENEMY","area_rule":"SAME_LANE","area_lanes":0,"power":1.1,"energy_cost":100,"vfx_key":"debuff_ultimate_curse"},"art_path":"","schema_version":1,"sort_order":630},
      {"enemy_key":"curse_d_invocador","enemy_type":"CURSE","enemy_grade":"D","rarity":"COMMON","display_name":"Maldicion Ritualista Grado D","role":"INVOCADOR","damage_type":"MAGICAL","scaling":"HYBRID","ad":40,"ap":40,"hp":1000,"vel":0.76,"pm":241,"atk":40,"speed":0.76,"attack_range":300.0,"desired_range":289.4,"move_speed":42.0,"attack_interval":1.55,"max_energy":100,"ultimate_energy_cost":100,"crit_chance":0.04,"crit_damage":1.5,"basic_skill":{},"ultimate":{"key":"curse_d_invocador_ultimate","name":"Ultimate de Maldicion Ritualista Grado D","type":"SUMMON","target_rule":"SELF","area_rule":"SELF","area_lanes":0,"power":1.1,"energy_cost":100,"vfx_key":"summoner_ultimate_ritual"},"art_path":"","schema_version":1,"sort_order":140},
      {"enemy_key":"curse_c_invocador","enemy_type":"CURSE","enemy_grade":"C","rarity":"COMMON","display_name":"Maldicion Ritualista Grado C","role":"INVOCADOR","damage_type":"MAGICAL","scaling":"HYBRID","ad":45,"ap":45,"hp":1130,"vel":0.76,"pm":264,"atk":45,"speed":0.76,"attack_range":300.0,"desired_range":289.4,"move_speed":42.0,"attack_interval":1.55,"max_energy":100,"ultimate_energy_cost":100,"crit_chance":0.04,"crit_damage":1.5,"basic_skill":{},"ultimate":{"key":"curse_c_invocador_ultimate","name":"Ultimate de Maldicion Ritualista Grado C","type":"SUMMON","target_rule":"SELF","area_rule":"SELF","area_lanes":0,"power":1.1,"energy_cost":100,"vfx_key":"summoner_ultimate_ritual"},"art_path":"","schema_version":1,"sort_order":240},
      {"enemy_key":"curse_b_invocador","enemy_type":"CURSE","enemy_grade":"B","rarity":"EPIC","display_name":"Maldicion Ritualista Grado B","role":"INVOCADOR","damage_type":"MAGICAL","scaling":"HYBRID","ad":51,"ap":51,"hp":1270,"vel":0.76,"pm":290,"atk":51,"speed":0.76,"attack_range":300.0,"desired_range":289.4,"move_speed":42.0,"attack_interval":1.55,"max_energy":100,"ultimate_energy_cost":100,"crit_chance":0.04,"crit_damage":1.5,"basic_skill":{},"ultimate":{"key":"curse_b_invocador_ultimate","name":"Ultimate de Maldicion Ritualista Grado B","type":"SUMMON","target_rule":"SELF","area_rule":"SELF","area_lanes":0,"power":1.1,"energy_cost":100,"vfx_key":"summoner_ultimate_ritual"},"art_path":"","schema_version":1,"sort_order":340},
      {"enemy_key":"curse_a_invocador","enemy_type":"CURSE","enemy_grade":"A","rarity":"LEGENDARY","display_name":"Maldicion Ritualista Grado A","role":"INVOCADOR","damage_type":"MAGICAL","scaling":"HYBRID","ad":58,"ap":58,"hp":1420,"vel":0.76,"pm":319,"atk":58,"speed":0.76,"attack_range":300.0,"desired_range":289.4,"move_speed":42.0,"attack_interval":1.55,"max_energy":100,"ultimate_energy_cost":100,"crit_chance":0.04,"crit_damage":1.5,"basic_skill":{},"ultimate":{"key":"curse_a_invocador_ultimate","name":"Ultimate de Maldicion Ritualista Grado A","type":"SUMMON","target_rule":"SELF","area_rule":"SELF","area_lanes":0,"power":1.1,"energy_cost":100,"vfx_key":"summoner_ultimate_ritual"},"art_path":"","schema_version":1,"sort_order":440},
      {"enemy_key":"curse_s_invocador","enemy_type":"CURSE","enemy_grade":"S","rarity":"MYTHIC","display_name":"Maldicion Ritualista Grado S","role":"INVOCADOR","damage_type":"MAGICAL","scaling":"HYBRID","ad":66,"ap":66,"hp":1580,"vel":0.76,"pm":351,"atk":66,"speed":0.76,"attack_range":300.0,"desired_range":289.4,"move_speed":42.0,"attack_interval":1.55,"max_energy":100,"ultimate_energy_cost":100,"crit_chance":0.04,"crit_damage":1.5,"basic_skill":{},"ultimate":{"key":"curse_s_invocador_ultimate","name":"Ultimate de Maldicion Ritualista Grado S","type":"SUMMON","target_rule":"SELF","area_rule":"SELF","area_lanes":0,"power":1.1,"energy_cost":100,"vfx_key":"summoner_ultimate_ritual"},"art_path":"","schema_version":1,"sort_order":540},
      {"enemy_key":"curse_s_plus_invocador","enemy_type":"CURSE","enemy_grade":"S+","rarity":"MYTHIC","display_name":"Maldicion Ritualista Grado S+","role":"INVOCADOR","damage_type":"MAGICAL","scaling":"HYBRID","ad":75,"ap":75,"hp":1750,"vel":0.76,"pm":386,"atk":75,"speed":0.76,"attack_range":300.0,"desired_range":289.4,"move_speed":42.0,"attack_interval":1.55,"max_energy":100,"ultimate_energy_cost":100,"crit_chance":0.04,"crit_damage":1.5,"basic_skill":{},"ultimate":{"key":"curse_s_plus_invocador_ultimate","name":"Ultimate de Maldicion Ritualista Grado S+","type":"SUMMON","target_rule":"SELF","area_rule":"SELF","area_lanes":0,"power":1.1,"energy_cost":100,"vfx_key":"summoner_ultimate_ritual"},"art_path":"","schema_version":1,"sort_order":640},
      {"enemy_key":"curse_d_soporte","enemy_type":"CURSE","enemy_grade":"D","rarity":"COMMON","display_name":"Maldicion Resonante Grado D","role":"SOPORTE","damage_type":"MAGICAL","scaling":"SUPPORT","ad":28,"ap":28,"hp":1020,"vel":0.70,"pm":235,"atk":66,"speed":0.70,"attack_range":530.0,"desired_range":517.4,"move_speed":32.0,"attack_interval":1.55,"max_energy":100,"ultimate_energy_cost":100,"crit_chance":0.04,"crit_damage":1.5,"basic_skill":{},"ultimate":{"key":"curse_d_soporte_ultimate","name":"Ultimate de Maldicion Resonante Grado D","type":"HEAL","target_rule":"ALL_ALLIES","area_rule":"ALL_ALLIES","area_lanes":2,"power":1.1,"energy_cost":100,"vfx_key":"support_ultimate_heal"},"art_path":"","schema_version":1,"sort_order":150},
      {"enemy_key":"curse_c_soporte","enemy_type":"CURSE","enemy_grade":"C","rarity":"COMMON","display_name":"Maldicion Resonante Grado C","role":"SOPORTE","damage_type":"MAGICAL","scaling":"SUPPORT","ad":31,"ap":31,"hp":1150,"vel":0.70,"pm":256,"atk":72,"speed":0.70,"attack_range":530.0,"desired_range":517.4,"move_speed":32.0,"attack_interval":1.55,"max_energy":100,"ultimate_energy_cost":100,"crit_chance":0.04,"crit_damage":1.5,"basic_skill":{},"ultimate":{"key":"curse_c_soporte_ultimate","name":"Ultimate de Maldicion Resonante Grado C","type":"HEAL","target_rule":"ALL_ALLIES","area_rule":"ALL_ALLIES","area_lanes":2,"power":1.1,"energy_cost":100,"vfx_key":"support_ultimate_heal"},"art_path":"","schema_version":1,"sort_order":250},
      {"enemy_key":"curse_b_soporte","enemy_type":"CURSE","enemy_grade":"B","rarity":"EPIC","display_name":"Maldicion Resonante Grado B","role":"SOPORTE","damage_type":"MAGICAL","scaling":"SUPPORT","ad":35,"ap":35,"hp":1290,"vel":0.70,"pm":280,"atk":78,"speed":0.70,"attack_range":530.0,"desired_range":517.4,"move_speed":32.0,"attack_interval":1.55,"max_energy":100,"ultimate_energy_cost":100,"crit_chance":0.04,"crit_damage":1.5,"basic_skill":{},"ultimate":{"key":"curse_b_soporte_ultimate","name":"Ultimate de Maldicion Resonante Grado B","type":"HEAL","target_rule":"ALL_ALLIES","area_rule":"ALL_ALLIES","area_lanes":2,"power":1.1,"energy_cost":100,"vfx_key":"support_ultimate_heal"},"art_path":"","schema_version":1,"sort_order":350},
      {"enemy_key":"curse_a_soporte","enemy_type":"CURSE","enemy_grade":"A","rarity":"LEGENDARY","display_name":"Maldicion Resonante Grado A","role":"SOPORTE","damage_type":"MAGICAL","scaling":"SUPPORT","ad":39,"ap":39,"hp":1440,"vel":0.70,"pm":306,"atk":86,"speed":0.70,"attack_range":530.0,"desired_range":517.4,"move_speed":32.0,"attack_interval":1.55,"max_energy":100,"ultimate_energy_cost":100,"crit_chance":0.04,"crit_damage":1.5,"basic_skill":{},"ultimate":{"key":"curse_a_soporte_ultimate","name":"Ultimate de Maldicion Resonante Grado A","type":"HEAL","target_rule":"ALL_ALLIES","area_rule":"ALL_ALLIES","area_lanes":2,"power":1.1,"energy_cost":100,"vfx_key":"support_ultimate_heal"},"art_path":"","schema_version":1,"sort_order":450},
      {"enemy_key":"curse_s_soporte","enemy_type":"CURSE","enemy_grade":"S","rarity":"MYTHIC","display_name":"Maldicion Resonante Grado S","role":"SOPORTE","damage_type":"MAGICAL","scaling":"SUPPORT","ad":44,"ap":44,"hp":1600,"vel":0.70,"pm":334,"atk":94,"speed":0.70,"attack_range":530.0,"desired_range":517.4,"move_speed":32.0,"attack_interval":1.55,"max_energy":100,"ultimate_energy_cost":100,"crit_chance":0.04,"crit_damage":1.5,"basic_skill":{},"ultimate":{"key":"curse_s_soporte_ultimate","name":"Ultimate de Maldicion Resonante Grado S","type":"HEAL","target_rule":"ALL_ALLIES","area_rule":"ALL_ALLIES","area_lanes":2,"power":1.1,"energy_cost":100,"vfx_key":"support_ultimate_heal"},"art_path":"","schema_version":1,"sort_order":550},
      {"enemy_key":"curse_s_plus_soporte","enemy_type":"CURSE","enemy_grade":"S+","rarity":"MYTHIC","display_name":"Maldicion Resonante Grado S+","role":"SOPORTE","damage_type":"MAGICAL","scaling":"SUPPORT","ad":49,"ap":49,"hp":1770,"vel":0.70,"pm":364,"atk":102,"speed":0.70,"attack_range":530.0,"desired_range":517.4,"move_speed":32.0,"attack_interval":1.55,"max_energy":100,"ultimate_energy_cost":100,"crit_chance":0.04,"crit_damage":1.5,"basic_skill":{},"ultimate":{"key":"curse_s_plus_soporte_ultimate","name":"Ultimate de Maldicion Resonante Grado S+","type":"HEAL","target_rule":"ALL_ALLIES","area_rule":"ALL_ALLIES","area_lanes":2,"power":1.1,"energy_cost":100,"vfx_key":"support_ultimate_heal"},"art_path":"","schema_version":1,"sort_order":650}
    ]'::jsonb
  ) as e(
    enemy_key text,
    enemy_type text,
    enemy_grade text,
    rarity text,
    display_name text,
    role text,
    damage_type text,
    scaling text,
    ad integer,
    ap integer,
    hp integer,
    vel double precision,
    pm integer,
    atk integer,
    speed double precision,
    attack_range double precision,
    desired_range double precision,
    move_speed double precision,
    attack_interval double precision,
    max_energy integer,
    ultimate_energy_cost integer,
    crit_chance double precision,
    crit_damage double precision,
    basic_skill jsonb,
    ultimate jsonb,
    art_path text,
    schema_version integer,
    sort_order integer
  )
),
normalized_enemy_seed as (
  select
    enemy_key,
    enemy_type,
    enemy_grade,
    case enemy_grade
      when 'D' then 1
      when 'C' then 2
      when 'B' then 3
      when 'A' then 4
      when 'S' then 5
      when 'S+' then 6
      else 1
    end as level,
    hp as base_hp,
    ad as base_ad,
    ap as base_ap,
    0 as base_def,
    0 as base_res,
    pm as base_pm,
    atk as base_atk,
    speed as base_speed,
    vel as base_vel,
    rarity,
    format('Maldicion Grado %s', enemy_grade) as display_name,
    role,
    damage_type,
    scaling,
    ad,
    ap,
    hp,
    vel,
    pm,
    atk,
    speed,
    attack_range,
    desired_range,
    move_speed,
    attack_interval,
    max_energy,
    ultimate_energy_cost,
    crit_chance,
    crit_damage,
    basic_skill,
    jsonb_set(
      coalesce(ultimate, '{}'::jsonb),
      '{name}',
      to_jsonb(format('Ultimate de Maldicion Grado %s', enemy_grade)),
      true
    ) as ultimate,
    coalesce(nullif(art_path, ''), enemy_key) as sprite_key,
    art_path,
    schema_version,
    sort_order
  from enemy_seed
),
upserted_enemies as (
  insert into public.enemy_definitions (
    enemy_key,
    enemy_type,
    enemy_grade,
    level,
    base_hp,
    base_ad,
    base_ap,
    base_def,
    base_res,
    base_pm,
    base_atk,
    base_speed,
    base_vel,
    rarity,
    display_name,
    name,
    role,
    damage_type,
    scaling,
    ad,
    ap,
    hp,
    vel,
    pm,
    atk,
    speed,
    attack_range,
    desired_range,
    move_speed,
    attack_interval,
    max_energy,
    ultimate_energy_cost,
    crit_chance,
    crit_damage,
    basic_skill,
    ultimate,
    sprite_key,
    art_path,
    schema_version,
    sort_order,
    is_enabled,
    updated_at
  )
  select
    enemy_key,
    enemy_type,
    enemy_grade,
    level,
    base_hp,
    base_ad,
    base_ap,
    base_def,
    base_res,
    base_pm,
    base_atk,
    base_speed,
    base_vel,
    rarity,
    display_name,
    display_name,
    role,
    damage_type,
    scaling,
    ad,
    ap,
    hp,
    vel,
    pm,
    atk,
    speed,
    attack_range,
    desired_range,
    move_speed,
    attack_interval,
    max_energy,
    ultimate_energy_cost,
    crit_chance,
    crit_damage,
    coalesce(basic_skill, '{}'::jsonb),
    coalesce(ultimate, '{}'::jsonb),
    coalesce(sprite_key, enemy_key),
    coalesce(art_path, ''),
    schema_version,
    sort_order,
    true,
    now()
  from normalized_enemy_seed
  on conflict (enemy_key) do update
  set
    enemy_type = excluded.enemy_type,
    enemy_grade = excluded.enemy_grade,
    level = excluded.level,
    base_hp = excluded.base_hp,
    base_ad = excluded.base_ad,
    base_ap = excluded.base_ap,
    base_def = excluded.base_def,
    base_res = excluded.base_res,
    base_pm = excluded.base_pm,
    base_atk = excluded.base_atk,
    base_speed = excluded.base_speed,
    base_vel = excluded.base_vel,
    rarity = excluded.rarity,
    display_name = excluded.display_name,
    name = excluded.name,
    role = excluded.role,
    damage_type = excluded.damage_type,
    scaling = excluded.scaling,
    ad = excluded.ad,
    ap = excluded.ap,
    hp = excluded.hp,
    vel = excluded.vel,
    pm = excluded.pm,
    atk = excluded.atk,
    speed = excluded.speed,
    attack_range = excluded.attack_range,
    desired_range = excluded.desired_range,
    move_speed = excluded.move_speed,
    attack_interval = excluded.attack_interval,
    max_energy = excluded.max_energy,
    ultimate_energy_cost = excluded.ultimate_energy_cost,
    crit_chance = excluded.crit_chance,
    crit_damage = excluded.crit_damage,
    basic_skill = excluded.basic_skill,
    ultimate = excluded.ultimate,
    sprite_key = excluded.sprite_key,
    art_path = excluded.art_path,
    schema_version = excluded.schema_version,
    sort_order = excluded.sort_order,
    is_enabled = true,
    updated_at = now()
  returning enemy_key
),
disabled_old_curse_enemies as (
  update public.enemy_definitions
  set
    is_enabled = false,
    updated_at = now()
  where enemy_key not in (select enemy_key from enemy_seed)
    and (
      coalesce(enemy_type, '') = 'CURSE'
      or enemy_key like 'curse_%'
    )
  returning enemy_key
),
ordered_encounters as (
  select
    encounter_key,
    row_number() over (order by coalesce(sort_order, 999999), encounter_key) - 1 as encounter_index
  from public.encounter_definitions
  where coalesce(is_enabled, true) = true
),
encounter_slots as (
  select 0 as slot_index
  union all select 1
  union all select 2
),
encounter_metadata as (
  select
    oe.encounter_key,
    oe.encounter_index,
    coalesce(nullif(substring(oe.encounter_key from 'encounter_ch([0-9]+)_'), ''), '1')::integer as chapter_number,
    case
      when oe.encounter_key like '%boss%' then 17
      else coalesce(nullif(substring(oe.encounter_key from 'stage_([0-9]+)_'), ''), '1')::integer
    end as stage_number,
    oe.encounter_key like '%boss%' as is_boss
  from ordered_encounters oe
),
generated_entries as (
  select
    em.encounter_key,
    es.slot_index,
    case role_slug
      when 'dps_magico' then 2
      when 'soporte' then 2
      else 1
    end as lane_index,
    ((em.chapter_number - 1) * 100) + (em.stage_number * 10) + es.slot_index + 1 as sort_order,
    grade_slug,
    role_slug
  from encounter_metadata em
  cross join encounter_slots es
  cross join lateral (
    select
      case
        when em.is_boss and em.chapter_number <= 4 then
          case es.slot_index when 0 then 's_plus' when 1 then 'a' else 'a' end
        when em.is_boss and em.chapter_number <= 8 then
          case es.slot_index when 0 then 's_plus' when 1 then 's' else 'a' end
        when em.is_boss then
          case es.slot_index when 0 then 's_plus' when 1 then 's_plus' else 's' end
        when em.chapter_number <= 4 and em.stage_number <= 6 then
          case es.slot_index when 0 then 'c' else 'd' end
        when em.chapter_number <= 4 and em.stage_number <= 12 then
          case es.slot_index when 0 then 'b' else 'c' end
        when em.chapter_number <= 4 then
          case es.slot_index when 0 then 'a' else 'b' end
        when em.chapter_number <= 8 and em.stage_number <= 6 then
          case es.slot_index when 0 then 'a' else 'b' end
        when em.chapter_number <= 8 then
          case es.slot_index when 0 then 's' else 'a' end
        when em.stage_number <= 10 then
          's'
        else
          case es.slot_index when 0 then 's_plus' else 's' end
      end as grade_slug,
      case
        when em.is_boss and em.chapter_number <= 4 then
          case es.slot_index when 0 then 'dps_fisico' when 1 then 'dps_debuffer' else 'dps_magico' end
        when em.is_boss and em.chapter_number <= 8 then
          case es.slot_index when 0 then 'dps_fisico' when 1 then 'invocador' else 'dps_magico' end
        when em.is_boss then
          case es.slot_index when 0 then 'dps_fisico' when 1 then 'dps_debuffer' else 'dps_magico' end
        when mod(em.stage_number - 1, 5) = 0 then case es.slot_index when 0 then 'dps_fisico' when 1 then 'dps_fisico' else 'dps_magico' end
        when mod(em.stage_number - 1, 5) = 1 then case es.slot_index when 0 then 'dps_fisico' when 1 then 'dps_debuffer' else 'dps_magico' end
        when mod(em.stage_number - 1, 5) = 2 then case es.slot_index when 0 then 'dps_fisico' when 1 then 'invocador' else 'dps_magico' end
        when mod(em.stage_number - 1, 5) = 3 then case es.slot_index when 0 then 'dps_fisico' when 1 then 'soporte' else 'dps_magico' end
        else case es.slot_index when 0 then 'dps_fisico' when 1 then 'dps_debuffer' else 'invocador' end
      end as role_slug
  ) planned
),
deleted_entries as (
  delete from public.encounter_enemy_entries
  where encounter_key in (select encounter_key from ordered_encounters)
  returning encounter_key
),
inserted_entries as (
  insert into public.encounter_enemy_entries (
    encounter_key,
    slot_index,
    enemy_key,
    lane_index,
    sort_order,
    is_enabled
  )
  select
    encounter_key,
    slot_index,
    'curse_' || grade_slug || '_' || role_slug as enemy_key,
    lane_index,
    sort_order,
    true
  from generated_entries
  returning encounter_key
)
select
  (select count(*) from upserted_enemies) as upserted_enemy_rows,
  (select count(*) from disabled_old_curse_enemies) as disabled_old_enemy_rows,
  (select count(*) from inserted_entries) as inserted_encounter_rows;

commit;

-- Verificacion sugerida:
-- select count(*) from public.enemy_definitions where is_enabled = true and enemy_key like 'curse_%';
-- select encounter_key, count(*) from public.encounter_enemy_entries where is_enabled = true group by encounter_key order by encounter_key;

-- ============================================================
-- Original: 2026-06-23_stage_definitions_campaign_overhaul.sql
-- ============================================================
begin;

alter table public.stage_definitions
  add column if not exists display_name text,
  add column if not exists name text,
  add column if not exists description text,
  add column if not exists world_key text,
  add column if not exists stage_type text default 'NORMAL',
  add column if not exists sort_order integer,
  add column if not exists encounter_key text,
  add column if not exists recommended_level integer default 1,
  add column if not exists enemy_count integer default 3,
  add column if not exists loot_source text default 'LOOT_TABLE',
  add column if not exists s_rank_slots integer default 0,
  add column if not exists target_pm integer default 0,
  add column if not exists chapter_boss_pm integer default 0,
  add column if not exists normal_pm_start integer default 0,
  add column if not exists normal_pm_end integer default 0,
  add column if not exists threat_label text,
  add column if not exists clear_gold integer default 0,
  add column if not exists clear_gems integer default 0,
  add column if not exists clear_xp integer default 0,
  add column if not exists is_enabled boolean default true,
  add column if not exists chapter_number integer,
  add column if not exists stage_number integer,
  add column if not exists is_boss boolean default false,
  add column if not exists replay_gold integer default 50,
  add column if not exists replay_gems integer default 0,
  add column if not exists replay_xp integer default 0,
  add column if not exists difficulty_band text,
  add column if not exists boss_ss_cap integer,
  add column if not exists grade_floor text,
  add column if not exists grade_ceiling text,
  add column if not exists updated_at timestamptz default now();

alter table public.encounter_definitions
  add column if not exists display_name text,
  add column if not exists name text,
  add column if not exists description text,
  add column if not exists encounter_type text default 'PVE',
  add column if not exists stage_type text default 'NORMAL',
  add column if not exists spawn_pattern text default 'STATIC',
  add column if not exists recommended_level integer default 1,
  add column if not exists enemy_count integer default 3,
  add column if not exists sort_order integer,
  add column if not exists is_enabled boolean default true,
  add column if not exists chapter_number integer,
  add column if not exists stage_number integer,
  add column if not exists is_boss boolean default false,
  add column if not exists updated_at timestamptz default now();

with chapters as (
  select generate_series(1, 12) as chapter_number
),
buckets as (
  select 1 as bucket_id, 1 as chapter_start, 4 as chapter_end, 8000::integer as gem_total
  union all
  select 2 as bucket_id, 5 as chapter_start, 8 as chapter_end, 18000::integer as gem_total
  union all
  select 3 as bucket_id, 9 as chapter_start, 12 as chapter_end, 34000::integer as gem_total
),
stages as (
  select
    chapter_number,
    generate_series(1, 17) as stage_number
  from chapters
),
stage_seed_raw as (
  select
    format('world_%s_stage_%s', chapter_number, stage_number) as stage_key,
    format('%s-%s', chapter_number, stage_number) as display_name,
    format('Capitulo %s - Etapa %s', chapter_number, stage_number) as name,
    case
      when stage_number = 17 then format('Jefe del capitulo %s. La maldicion dominante marca el salto real de dificultad.', chapter_number)
      else format('Avanza por el capitulo %s, etapa %s, siguiendo la ruta maldita del mapa.', chapter_number, stage_number)
    end as description,
    format('chapter_%02s', chapter_number) as world_key,
    ((chapter_number - 1) * 17) + stage_number as sort_order,
    chapter_number,
    stage_number,
    (stage_number = 17) as is_boss,
    case
      when stage_number = 17 then format('encounter_ch%1$02s_boss_live', chapter_number)
      else format('encounter_ch%1$02s_stage_%2$02s_live', chapter_number, stage_number)
    end as encounter_key,
    greatest(1, ((chapter_number - 1) * 8) + least(stage_number, 8))::integer as recommended_level,
    3::integer as enemy_count,
    'LOOT_TABLE'::text as loot_source,
    case
      when stage_number = 17 then case when chapter_number <= 4 then 1 when chapter_number <= 8 then 2 else 3 end
      when chapter_number <= 4 then 0
      when chapter_number <= 8 then case when stage_number >= 14 then 1 else 0 end
      when stage_number >= 14 then 2
      else 1
    end as s_rank_slots,
    round(
      400.0
      + (7000.0 - 400.0)
      * power(((((chapter_number - 1) * 17) + (stage_number - 1))::double precision / 203.0), 1.12)
    )::integer as target_pm,
    round(
      400.0
      + (7000.0 - 400.0)
      * power(((((chapter_number - 1) * 17) + 16)::double precision / 203.0), 1.12)
    )::integer as chapter_boss_pm,
    round(
      400.0
      + (7000.0 - 400.0)
      * power(((((chapter_number - 1) * 17))::double precision / 203.0), 1.12)
    )::integer as normal_pm_start,
    round(
      400.0
      + (7000.0 - 400.0)
      * power(((((chapter_number - 1) * 17) + 15)::double precision / 203.0), 1.12)
    )::integer as normal_pm_end,
    case
      when stage_number = 17 then
        case
          when chapter_number <= 4 then 'Boss Ascendente'
          when chapter_number <= 8 then 'Boss Dominante'
          else 'Boss Apocaliptico'
        end
      when chapter_number <= 4 then
        case when stage_number <= 10 then 'Ruta Inicial' else 'Ruta de Ascenso' end
      when chapter_number <= 8 then
        case when stage_number <= 10 then 'Ruta de Presion' else 'Ruta de Ruptura' end
      else
        case when stage_number <= 10 then 'Ruta Final' else 'Ruta Extrema' end
    end as threat_label,
    (
      24
      + ((chapter_number - 1) * 10)
      + ((stage_number - 1) * 6)
      + case when stage_number = 17 then 80 else 0 end
    )::integer as clear_xp,
    50::integer as replay_gold,
    0::integer as replay_gems,
    0::integer as replay_xp,
    case
      when chapter_number <= 4 then 'EASY'
      when chapter_number <= 8 then 'MID'
      else 'HARD'
    end as difficulty_band,
    case
      when chapter_number <= 4 then 1
      when chapter_number <= 8 then 2
      else 3
    end as boss_ss_cap,
    case
      when stage_number = 17 and chapter_number <= 2 then 'C'
      when stage_number = 17 and chapter_number <= 4 then 'B'
      when stage_number = 17 and chapter_number <= 8 then 'A'
      when stage_number = 17 then 'S'
      when stage_number <= 4 and chapter_number <= 4 then 'D'
      when stage_number <= 4 and chapter_number <= 8 then 'C'
      when stage_number <= 4 then 'B'
      when stage_number <= 8 and chapter_number <= 4 then 'C'
      when stage_number <= 8 and chapter_number <= 8 then 'B'
      when stage_number <= 8 then 'A'
      when stage_number <= 12 and chapter_number <= 4 then 'C'
      when stage_number <= 12 and chapter_number <= 8 then 'B'
      when stage_number <= 12 then 'A'
      when chapter_number <= 4 then 'B'
      when chapter_number <= 8 then 'A'
      else 'S'
    end as grade_floor,
    case
      when stage_number = 17 and chapter_number <= 2 then 'B'
      when stage_number = 17 and chapter_number <= 4 then 'A'
      when stage_number = 17 and chapter_number <= 8 then 'S'
      when stage_number = 17 then 'S+'
      when stage_number <= 4 and chapter_number <= 4 then 'C'
      when stage_number <= 4 and chapter_number <= 8 then 'B'
      when stage_number <= 4 then 'A'
      when stage_number <= 8 and chapter_number <= 4 then 'B'
      when stage_number <= 8 and chapter_number <= 8 then 'A'
      when stage_number <= 8 then 'S'
      when stage_number <= 12 and chapter_number <= 4 then 'B'
      when stage_number <= 12 and chapter_number <= 8 then 'A'
      when stage_number <= 12 then 'S'
      when chapter_number <= 4 then 'A'
      when chapter_number <= 8 then 'S'
      else 'S+'
    end as grade_ceiling,
    (
      60
      + (chapter_number * 8)
      + stage_number
      + case when stage_number = 17 then 40 else 0 end
    )::integer as reward_weight,
    case
      when chapter_number <= 4 then 1
      when chapter_number <= 8 then 2
      else 3
    end as gem_bucket_id
  from stages
),
stage_reward_distribution as (
  select
    ssr.*,
    b.gem_total,
    floor((b.gem_total::numeric * ssr.reward_weight::numeric) / sum(ssr.reward_weight) over (partition by ssr.gem_bucket_id))::integer as base_clear_gems,
    ((b.gem_total::numeric * ssr.reward_weight::numeric) / sum(ssr.reward_weight) over (partition by ssr.gem_bucket_id))
      - floor((b.gem_total::numeric * ssr.reward_weight::numeric) / sum(ssr.reward_weight) over (partition by ssr.gem_bucket_id)) as clear_gems_fraction,
    floor((2000000::numeric * ssr.reward_weight::numeric) / sum(ssr.reward_weight) over ())::integer as base_clear_gold,
    ((2000000::numeric * ssr.reward_weight::numeric) / sum(ssr.reward_weight) over ())
      - floor((2000000::numeric * ssr.reward_weight::numeric) / sum(ssr.reward_weight) over ()) as clear_gold_fraction
  from stage_seed_raw ssr
  join buckets b
    on b.bucket_id = ssr.gem_bucket_id
),
stage_reward_ranked as (
  select
    srd.*,
    row_number() over (
      partition by gem_bucket_id
      order by clear_gems_fraction desc, sort_order asc
    ) as clear_gems_rank,
    (
      gem_total
      - sum(base_clear_gems) over (partition by gem_bucket_id)
    )::integer as bonus_gem_slots,
    row_number() over (
      order by clear_gold_fraction desc, sort_order asc
    ) as clear_gold_rank,
    (2000000 - sum(base_clear_gold) over ())::integer as bonus_gold_slots
  from stage_reward_distribution srd
),
stage_seed as (
  select
    stage_key,
    display_name,
    name,
    description,
    world_key,
    sort_order,
    chapter_number,
    stage_number,
    is_boss,
    encounter_key,
    recommended_level,
    enemy_count,
    loot_source,
    s_rank_slots,
    target_pm,
    chapter_boss_pm,
    normal_pm_start,
    normal_pm_end,
    threat_label,
    (
      base_clear_gold
      + case when clear_gold_rank <= bonus_gold_slots then 1 else 0 end
    )::integer as clear_gold,
    (
      base_clear_gems
      + case when clear_gems_rank <= bonus_gem_slots then 1 else 0 end
    )::integer as clear_gems,
    clear_xp,
    replay_gold,
    replay_gems,
    replay_xp,
    difficulty_band,
    boss_ss_cap,
    grade_floor,
    grade_ceiling
  from stage_reward_ranked
),
encounter_seed as (
  select
    encounter_key,
    format('Encuentro %s-%s', chapter_number, stage_number) as display_name,
    format('Encuentro %s-%s', chapter_number, stage_number) as name,
    format('Encuentro canónico de campaña para %s-%s.', chapter_number, stage_number) as description,
    'PVE'::text as encounter_type,
    case when is_boss then 'BOSS' else 'NORMAL' end as stage_type,
    'STATIC'::text as spawn_pattern,
    recommended_level,
    enemy_count,
    sort_order,
    chapter_number,
    stage_number,
    is_boss
  from stage_seed
),
upserted_stages as (
  insert into public.stage_definitions (
    stage_key,
    display_name,
    name,
    description,
    world_key,
    sort_order,
    chapter_number,
    stage_number,
    is_boss,
    encounter_key,
    recommended_level,
    enemy_count,
    loot_source,
    s_rank_slots,
    target_pm,
    chapter_boss_pm,
    normal_pm_start,
    normal_pm_end,
    threat_label,
    clear_gold,
    clear_gems,
    clear_xp,
    replay_gold,
    replay_gems,
    replay_xp,
    difficulty_band,
    boss_ss_cap,
    grade_floor,
    grade_ceiling,
    is_enabled,
    updated_at
  )
  select
    stage_key,
    display_name,
    name,
    description,
    world_key,
    sort_order,
    chapter_number,
    stage_number,
    is_boss,
    encounter_key,
    recommended_level,
    enemy_count,
    loot_source,
    s_rank_slots,
    target_pm,
    chapter_boss_pm,
    normal_pm_start,
    normal_pm_end,
    threat_label,
    clear_gold,
    clear_gems,
    clear_xp,
    replay_gold,
    replay_gems,
    replay_xp,
    difficulty_band,
    boss_ss_cap,
    grade_floor,
    grade_ceiling,
    true,
    now()
  from stage_seed
  on conflict (stage_key) do update
  set
    display_name = excluded.display_name,
    name = excluded.name,
    description = excluded.description,
    world_key = excluded.world_key,
    sort_order = excluded.sort_order,
    chapter_number = excluded.chapter_number,
    stage_number = excluded.stage_number,
    is_boss = excluded.is_boss,
    encounter_key = excluded.encounter_key,
    recommended_level = excluded.recommended_level,
    enemy_count = excluded.enemy_count,
    loot_source = excluded.loot_source,
    s_rank_slots = excluded.s_rank_slots,
    target_pm = excluded.target_pm,
    chapter_boss_pm = excluded.chapter_boss_pm,
    normal_pm_start = excluded.normal_pm_start,
    normal_pm_end = excluded.normal_pm_end,
    threat_label = excluded.threat_label,
    clear_gold = excluded.clear_gold,
    clear_gems = excluded.clear_gems,
    clear_xp = excluded.clear_xp,
    replay_gold = excluded.replay_gold,
    replay_gems = excluded.replay_gems,
    replay_xp = excluded.replay_xp,
    difficulty_band = excluded.difficulty_band,
    boss_ss_cap = excluded.boss_ss_cap,
    grade_floor = excluded.grade_floor,
    grade_ceiling = excluded.grade_ceiling,
    is_enabled = true,
    updated_at = now()
  returning stage_key
),
disabled_old_stages as (
  update public.stage_definitions
  set
    is_enabled = false,
    updated_at = now()
  where stage_key not in (select stage_key from stage_seed)
    and stage_key like 'world_%_stage_%'
  returning stage_key
),
upserted_encounters as (
  insert into public.encounter_definitions (
    encounter_key,
    display_name,
    name,
    description,
    encounter_type,
    stage_type,
    spawn_pattern,
    recommended_level,
    enemy_count,
    sort_order,
    chapter_number,
    stage_number,
    is_boss,
    is_enabled,
    updated_at
  )
  select
    encounter_key,
    display_name,
    name,
    description,
    encounter_type,
    stage_type,
    spawn_pattern,
    recommended_level,
    enemy_count,
    sort_order,
    chapter_number,
    stage_number,
    is_boss,
    true,
    now()
  from encounter_seed
  on conflict (encounter_key) do update
  set
    display_name = excluded.display_name,
    name = excluded.name,
    description = excluded.description,
    encounter_type = excluded.encounter_type,
    stage_type = excluded.stage_type,
    spawn_pattern = excluded.spawn_pattern,
    recommended_level = excluded.recommended_level,
    enemy_count = excluded.enemy_count,
    sort_order = excluded.sort_order,
    chapter_number = excluded.chapter_number,
    stage_number = excluded.stage_number,
    is_boss = excluded.is_boss,
    is_enabled = true,
    updated_at = now()
  returning encounter_key
),
disabled_old_encounters as (
  update public.encounter_definitions
  set
    is_enabled = false,
    updated_at = now()
  where encounter_key not in (select encounter_key from encounter_seed)
    and encounter_key like 'encounter_ch%'
  returning encounter_key
)
select
  (select count(*) from upserted_stages) as upserted_stage_rows,
  (select count(*) from disabled_old_stages) as disabled_old_stage_rows,
  (select count(*) from upserted_encounters) as upserted_encounter_rows,
  (select count(*) from disabled_old_encounters) as disabled_old_encounter_rows;

commit;

-- Verificacion sugerida:
-- select chapter_number, count(*) from public.stage_definitions where is_enabled = true group by chapter_number order by chapter_number;
-- select count(*) from public.stage_definitions where is_enabled = true and is_boss = true;

-- ============================================================
-- Original: 2026-06-23_profiles_onboarding_seen.sql
-- ============================================================
begin;

alter table public.profiles
  add column if not exists onboarding_seen boolean;

update public.profiles
set onboarding_seen = true
where onboarding_seen is null;

alter table public.profiles
  alter column onboarding_seen set default false,
  alter column onboarding_seen set not null;

commit;

-- ============================================================
-- Original: 2026-06-25_user_cards_and_formations_rls.sql
-- ============================================================
begin;

alter table if exists public.user_cards enable row level security;
alter table if exists public.user_formations enable row level security;
alter table if exists public.user_formation_slots enable row level security;

drop policy if exists user_cards_select_own on public.user_cards;
create policy user_cards_select_own
  on public.user_cards
  for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists user_cards_insert_own on public.user_cards;
create policy user_cards_insert_own
  on public.user_cards
  for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists user_cards_update_own on public.user_cards;
create policy user_cards_update_own
  on public.user_cards
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists user_cards_delete_own on public.user_cards;
create policy user_cards_delete_own
  on public.user_cards
  for delete
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists user_formations_select_own on public.user_formations;
create policy user_formations_select_own
  on public.user_formations
  for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists user_formations_insert_own on public.user_formations;
create policy user_formations_insert_own
  on public.user_formations
  for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists user_formations_update_own on public.user_formations;
create policy user_formations_update_own
  on public.user_formations
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists user_formations_delete_own on public.user_formations;
create policy user_formations_delete_own
  on public.user_formations
  for delete
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists user_formation_slots_select_own on public.user_formation_slots;
create policy user_formation_slots_select_own
  on public.user_formation_slots
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.user_formations uf
      where uf.id = user_formation_slots.formation_id
        and uf.user_id = auth.uid()
    )
  );

drop policy if exists user_formation_slots_insert_own on public.user_formation_slots;
create policy user_formation_slots_insert_own
  on public.user_formation_slots
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.user_formations uf
      where uf.id = user_formation_slots.formation_id
        and uf.user_id = auth.uid()
    )
  );

drop policy if exists user_formation_slots_update_own on public.user_formation_slots;
create policy user_formation_slots_update_own
  on public.user_formation_slots
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.user_formations uf
      where uf.id = user_formation_slots.formation_id
        and uf.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from public.user_formations uf
      where uf.id = user_formation_slots.formation_id
        and uf.user_id = auth.uid()
    )
  );

drop policy if exists user_formation_slots_delete_own on public.user_formation_slots;
create policy user_formation_slots_delete_own
  on public.user_formation_slots
  for delete
  to authenticated
  using (
    exists (
      select 1
      from public.user_formations uf
      where uf.id = user_formation_slots.formation_id
        and uf.user_id = auth.uid()
    )
  );

commit;

-- ============================================================
-- Original: 2026-06-25_user_cards_progression_replacement.sql
-- ============================================================
begin;

alter table if exists public.user_cards
  add column if not exists card_definition_id text,
  add column if not exists character_id text,
  add column if not exists card_definition_uuid text,
  add column if not exists character_definition_uuid text,
  add column if not exists card_key text,
  add column if not exists character_key text,
  add column if not exists variant text,
  add column if not exists card_type text,
  add column if not exists rarity text,
  add column if not exists definition_rarity text,
  add column if not exists level integer default 1,
  add column if not exists xp integer default 0,
  add column if not exists stars integer default 1,
  add column if not exists ascension integer default 0,
  add column if not exists awakening integer default 0,
  add column if not exists fragments integer default 0,
  add column if not exists energy integer default 0,
  add column if not exists max_energy integer default 100,
  add column if not exists is_starter boolean default false,
  add column if not exists acquired_at timestamptz default now(),
  add column if not exists updated_at timestamptz default now();

alter table if exists public.user_formation_slots
  add column if not exists card_definition_uuid text,
  add column if not exists character_definition_uuid text,
  add column if not exists updated_at timestamptz default now();

delete from public.user_formation_slots;

delete from public.user_cards;

create unique index if not exists user_cards_user_id_card_definition_id_uidx
  on public.user_cards (user_id, card_definition_id);

create index if not exists user_cards_user_id_idx
  on public.user_cards (user_id);

create index if not exists user_cards_user_id_card_type_idx
  on public.user_cards (user_id, card_type);

create index if not exists user_formation_slots_formation_id_idx
  on public.user_formation_slots (formation_id);

select
  'user_cards_replacement_ready' as status,
  (select count(*) from public.user_cards) as remaining_user_cards,
  (select count(*) from public.user_formation_slots) as remaining_formation_slots;

commit;

-- ============================================================
-- Original: 2026-06-26_user_cards_rls_grants.sql
-- ============================================================
grant usage on schema public to authenticated;

grant select, insert, update, delete
  on table public.user_cards
  to authenticated;

grant select, insert, update, delete
  on table public.user_formations
  to authenticated;

grant select, insert, update, delete
  on table public.user_formation_slots
  to authenticated;

-- ============================================================
-- Original: 2026-06-26_user_cards_definition_rarity_alignment.sql
-- ============================================================
update public.user_cards
set definition_rarity = case lower(definition_rarity)
  when 'basic' then 'COMMON'
  when 'common' then 'COMMON'
  when 'epic' then 'EPIC'
  when 'legendary' then 'LEGENDARY'
  when 'mythic' then 'MYTHIC'
  else definition_rarity
end,
updated_at = now()
where definition_rarity is not null
  and definition_rarity <> upper(definition_rarity);

-- ============================================================
-- Original: 2026-06-26_equipment_inventory_enum_alignment.sql
-- ============================================================
update public.user_inventory
set rarity = (
  case lower(rarity::text)
    when 'basico' then 'comun'
    when 'basic' then 'comun'
    when 'common' then 'comun'
    when 'epic' then 'epico'
    when 'rare' then 'raro'
    when 'legendary' then 'legendario'
    when 'mythic' then 'mitico'
    else lower(rarity::text)
  end
)::public.equip_rarity,
updated_at = now()
where lower(rarity::text) in ('basico', 'basic', 'common', 'epic', 'rare', 'legendary', 'mythic');

-- ============================================================
-- Original: 2026-06-26_card_fragments_material_backfill.sql
-- ============================================================
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

-- ============================================================
-- Original: 2026-06-26_wipe_equipment_inventory_start_empty.sql
-- ============================================================
delete from public.user_inventory;

with normalized_characters as (
  select
    ps.user_id,
    coalesce(
      jsonb_object_agg(
        character_entry.key,
        jsonb_set(character_entry.value, '{equipment}', '{}'::jsonb, true)
      ) filter (where character_entry.key is not null),
      '{}'::jsonb
    ) as characters_payload
  from public.player_saves ps
  left join lateral jsonb_each(coalesce(ps.save->'characters', '{}'::jsonb)) as character_entry(key, value) on true
  group by ps.user_id
)
update public.player_saves ps
set save = jsonb_set(
      jsonb_set(
        coalesce(ps.save, '{}'::jsonb),
        '{inventory}',
        '[]'::jsonb,
        true
      ),
      '{characters}',
      normalized_characters.characters_payload,
      true
    ),
    updated_at = now()
from normalized_characters
where ps.user_id = normalized_characters.user_id;

-- ============================================================
-- Original: 2026-07-16_pity_system_and_launch_balances.sql
-- ============================================================
begin;

drop table if exists public.user_pity;

create table public.user_pity (
  user_id uuid not null references auth.users(id) on delete cascade,
  pack_id text not null,
  pity_legendary int not null default 0,
  pity_mythic int not null default 0,
  target_counter int not null default 0,
  soft_pity_step int not null default 0,
  config_version int not null default 1,
  updated_at timestamptz not null default now(),
  last_target_hit_at timestamptz,
  primary key (user_id, pack_id)
);

alter table public.user_pity enable row level security;

drop policy if exists "user_pity_select_own" on public.user_pity;
create policy "user_pity_select_own" on public.user_pity
  for select using (auth.uid() = user_id);

commit;

-- ============================================================
-- Original: 2026-07-16_tutorial_progress.sql
-- ============================================================
begin;

alter table public.profiles
  add column if not exists tutorial_progress integer default 0 not null;

alter table public.profiles
  add column if not exists tutorial_completed boolean default false not null;

comment on column public.profiles.tutorial_progress is 'Step number the player reached in the interactive tutorial (0=not started, 7=done)';
comment on column public.profiles.tutorial_completed is 'True once the player completes all tutorial steps';

commit;
