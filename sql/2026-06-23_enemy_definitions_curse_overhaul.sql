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
