-- ============================================================
-- MISIONES CANONICAS - v1
-- Config: config_version=1
-- Fecha: 2026-07-18
-- ============================================================
-- Este archivo:
-- 1. Hace RESET total de todos los estados de usuario
-- 2. Elimina definiciones existentes
-- 3. Inserta las 53 misiones canonicas (23 diarias, 15 semanales, 15 temporada)
-- 4. Inserta los 5 cofres diarios
-- ============================================================

begin;

-- ============================================================
-- RESET TOTAL DE ESTADOS DE USUARIO
-- ============================================================

delete from public.user_daily_mission_state;
delete from public.user_weekly_mission_state;
delete from public.user_season_mission_state;
delete from public.user_daily_chest_state;
delete from public.user_weekly_chest_state;
delete from public.user_season_chest_state;

-- ============================================================
-- ELIMINAR DEFINICIONES EXISTENTES
-- ============================================================

delete from public.daily_mission_definitions;
delete from public.weekly_mission_definitions;
delete from public.season_mission_definitions;
delete from public.daily_chest_definitions;
delete from public.weekly_chest_definitions;
delete from public.season_chest_definitions;

-- ============================================================
-- COFRES DIARIOS (5)
-- ============================================================

insert into public.daily_chest_definitions (config_version, chest_id, required_points, reward_gold, reward_gems, sort_order, is_enabled)
values
  (1, 'daily_chest_20',  20,  1000, 10, 20,  true),
  (1, 'daily_chest_40',  40,  1200, 15, 40,  true),
  (1, 'daily_chest_60',  60,  1500, 20, 60,  true),
  (1, 'daily_chest_80',  80,  1500, 25, 80,  true),
  (1, 'daily_chest_100', 100, 1800, 30, 100, true);

-- ============================================================
-- MISIONES DIARIAS (23)
-- ============================================================

insert into public.daily_mission_definitions (config_version, mission_id, event_key, reward_gold, reward_gems, reward_points, reward_type, reward_config, target, sort_order, is_enabled)
values
  (1, 'login',                       'login',                        400,  5,  5,  'gold_gems',        '{}',                                                                     1,     10,   true),
  (1, 'claim_afk',                   'claim_afk',                    600,  5,  5,  'gold_gems',        '{}',                                                                     1,     20,   true),
  (1, 'complete_5_campaign_battles', 'campaign_battle_completed',    500,  0,  5,  'basic_pack',       '{"packId":"basicPack","packCount":1}',                                    5,     30,   true),
  (1, 'win_3_battles',               'battle_won',                   700,  5,  5,  'gold_gems',        '{}',                                                                     3,     40,   true),
  (1, 'clear_3_tower_floors',        'tower_floor_cleared',          800,  5,  5,  'epic_pack',        '{"packId":"epicPack","packCount":1}',                                     3,     45,   true),
  (1, 'clear_1_tower_boss',          'tower_boss_cleared',           1400, 15, 5,  'basic_pack',       '{"packId":"basicPack","packCount":1}',                                    1,     46,   true),
  (1, 'upgrade_1_card',              'card_upgraded',                800,  8,  5,  'gold_gems',        '{}',                                                                     1,     50,   true),
  (1, 'upgrade_8_cards',             'card_upgraded',                600,  5,  5,  'choice_epic',      '{"choiceType":"epic","choiceCount":1}',                                   8,     60,   true),
  (1, 'complete_8_campaign_battles', 'campaign_battle_completed',    700,  0,  5,  'choice_epic',      '{"choiceType":"epic","choiceCount":1}',                                   8,     65,   true),
  (1, 'equip_or_upgrade_1_item',     'item_equipped_or_upgraded',    700,  8,  5,  'gold_gems',        '{}',                                                                     1,     70,   true),
  (1, 'open_1_basic_pack',           'basic_pack_opened',            500,  5,  5,  'gold_gems',        '{}',                                                                     1,     80,   true),
  (1, 'complete_1_daily_dungeon',    'daily_dungeon_completed',      600,  5,  5,  'epic_pack',        '{"packId":"epicPack","packCount":1}',                                     1,     90,   true),
  (1, 'defeat_1_daily_boss',         'daily_boss_defeated',          1400, 15, 5,  'basic_pack',       '{"packId":"basicPack","packCount":1}',                                    1,     100,  true),
  (1, 'play_3_arena_pvp',            'arena_pvp_played',             600,  5,  5,  'basic_pack',       '{"packId":"basicPack","packCount":1}',                                    3,     110,  true),
  (1, 'use_friend_support',          'friend_support_used',          500,  5,  5,  'gold_gems',        '{}',                                                                     1,     120,  true),
  (1, 'clan_participation',          'clan_participation',           600,  8,  5,  'gold_gems',        '{}',                                                                     1,     130,  true),
  (1, 'clear_1_idle_stage',          'idle_stage_cleared',           800,  8,  5,  'gold_gems',        '{}',                                                                     1,     140,  true),
  (1, 'sell_or_dismantle_1_item',    'item_sold_or_dismantled',      600,  6,  5,  'gold_gems',        '{}',                                                                     1,     150,  true),
  (1, 'spend_15000_gold',            'gold_spent',                   500,  5,  5,  'basic_pack',       '{"packId":"basicPack","packCount":1}',                                    15000, 160,  true),
  (1, 'claim_free_shop_reward',      'free_shop_reward_claimed',     400,  5,  5,  'gold_gems',        '{}',                                                                     1,     170,  true),
  (1, 'use_ultimate_20_times',       'ultimate_used',                400,  0,  5,  'epic_pack',        '{"packId":"epicPack","packCount":1}',                                     20,    180,  true),
  (1, 'complete_1_expedition',       'expedition_completed',         800,  8,  5,  'basic_pack',       '{"packId":"basicPack","packCount":1}',                                    1,     190,  true),
  (1, 'complete_10_daily_missions',  'daily_mission_completed_other',800,  12, 10, 'epic_pack',        '{"packId":"epicPack","packCount":1}',                                     10,    200,  true);

-- ============================================================
-- MISIONES SEMANALES (15)
-- ============================================================

insert into public.weekly_mission_definitions (config_version, mission_id, event_key, reward_gold, reward_gems, reward_points, reward_type, reward_config, target, sort_order, is_enabled)
values
  (1, 'weekly_complete_20_campaign',    'campaign_battle_completed',    2000, 15, 15, 'gold_gems',        '{}',                                                     20,    10,  true),
  (1, 'weekly_win_10_battles',          'battle_won',                   1800, 20, 15, 'epic_pack',        '{"packId":"epicPack","packCount":1}',                     10,    20,  true),
  (1, 'weekly_upgrade_15_cards',        'card_upgraded',                1800, 12, 15, 'choice_epic',      '{"choiceType":"epic","choiceCount":1}',                    15,    25,  true),
  (1, 'weekly_clear_20_tower_floors',   'tower_floor_cleared',          1500, 10, 15, 'legendary_pack',   '{"packId":"legendaryPack","packCount":1}',                 20,    30,  true),
  (1, 'weekly_clear_5_tower_bosses',    'tower_boss_cleared',           2000, 15, 20, 'choice_legendary', '{"choiceType":"legendary","choiceCount":1}',               5,     40,  true),
  (1, 'weekly_complete_30_campaign',    'campaign_battle_completed',    2200, 12, 15, 'choice_epic',      '{"choiceType":"epic","choiceCount":1}',                    30,    45,  true),
  (1, 'weekly_upgrade_5_cards',         'card_upgraded',                1500, 15, 15, 'basic_pack',       '{"packId":"basicPack","packCount":1}',                     5,     50,  true),
  (1, 'weekly_open_5_packs',            'basic_pack_opened',            1600, 10, 15, 'gold_gems',        '{}',                                                     5,     60,  true),
  (1, 'weekly_play_10_pvp',             'arena_pvp_played',             2500, 25, 15, 'gold_gems',        '{}',                                                     10,    70,  true),
  (1, 'weekly_spend_50000_gold',        'gold_spent',                   2200, 18, 15, 'epic_pack',        '{"packId":"epicPack","packCount":1}',                     50000, 80,  true),
  (1, 'weekly_win_60_battles',          'battle_won',                   3000, 20, 25, 'choice_legendary', '{"choiceType":"legendary","choiceCount":1}',               60,    85,  true),
  (1, 'weekly_use_ultimate_60',         'ultimate_used',                1600, 10, 15, 'gold_gems',        '{}',                                                     60,    90,  true),
  (1, 'weekly_equip_or_upgrade_5_items','item_equipped_or_upgraded',    1400, 12, 15, 'gold_gems',        '{}',                                                     5,    100,  true),
  (1, 'weekly_clear_7_tower_bosses',    'tower_boss_cleared',           3500, 25, 20, 'choice_legendary', '{"choiceType":"legendary","choiceCount":1}',               7,    105,  true),
  (1, 'weekly_complete_7_daily',        'daily_mission_completed_other',2500, 25, 20, 'epic_pack',        '{"packId":"epicPack","packCount":1}',                     7,    110,  true);

-- ============================================================
-- MISIONES TEMPORADA (15)
-- ============================================================

insert into public.season_mission_definitions (config_version, mission_id, event_key, reward_gold, reward_gems, reward_points, reward_type, reward_config, target, sort_order, is_enabled)
values
  (1, 'season_complete_50_campaign',     'campaign_battle_completed',    3000, 20, 30, 'epic_pack',        '{"packId":"epicPack","packCount":1}',                     50,     10,  true),
  (1, 'season_win_100_battles',          'battle_won',                   4000, 30, 30, 'legendary_pack',   '{"packId":"legendaryPack","packCount":1}',                 100,    20,  true),
  (1, 'season_upgrade_50_cards',         'card_upgraded',                4000, 30, 30, 'choice_legendary', '{"choiceType":"legendary","choiceCount":1}',               50,     25,  true),
  (1, 'season_clear_30_tower_floors',    'tower_floor_cleared',          4000, 30, 30, 'mythic_pack',      '{"packId":"mythicPack","packCount":1}',                    30,     30,  true),
  (1, 'season_upgrade_15_cards',         'card_upgraded',                4500, 35, 30, 'basic_pack',       '{"packId":"basicPack","packCount":1}',                     15,     40,  true),
  (1, 'season_clear_40_tower_floors',    'tower_floor_cleared',          5000, 35, 30, 'choice_legendary', '{"choiceType":"legendary","choiceCount":1}',               40,     45,  true),
  (1, 'season_open_40_packs',            'basic_pack_opened',            2500,  0, 30, 'mythic_pack',      '{"packId":"mythicPack","packCount":1}',                    40,     50,  true),
  (1, 'season_play_30_pvp',              'arena_pvp_played',             5000, 45, 30, 'basic_pack',       '{"packId":"basicPack","packCount":1}',                     30,     60,  true),
  (1, 'season_win_200_campaign',         'battle_won',                   4500, 30, 35, 'choice_legendary', '{"choiceType":"legendary","choiceCount":1}',               200,    65,  true),
  (1, 'season_spend_480k_gold',          'gold_spent',                   2000, 20, 30, 'mythic_pack',      '{"packId":"mythicPack","packCount":1}',                    480000, 70,  true),
  (1, 'season_use_ultimate_200',         'ultimate_used',                3000,  0, 30, 'legendary_pack',   '{"packId":"legendaryPack","packCount":1}',                 200,    80,  true),
  (1, 'season_equip_or_upgrade_15_items','item_equipped_or_upgraded',    3000, 25, 30, 'epic_pack',        '{"packId":"epicPack","packCount":1}',                     15,     90,  true),
  (1, 'season_clear_9_tower_bosses',     'tower_boss_cleared',           5000, 40, 30, 'choice_legendary', '{"choiceType":"legendary","choiceCount":1}',               9,     100,  true),
  (1, 'season_complete_50_daily',        'daily_mission_completed_other',6000, 50, 40, 'mythic_pack',      '{"packId":"mythicPack","packCount":1}',                    50,    110,  true),
  (1, 'season_complete_all',             'season_all_missions_completed',0,    0,  50, 'choice_definitiva','{"choiceType":"definitiva","choiceCount":1}',               1,     200,  true);

commit;
