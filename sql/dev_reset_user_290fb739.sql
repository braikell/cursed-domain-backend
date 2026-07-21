begin;

delete from public.user_daily_mission_state  where user_id = '290fb739-fa19-4924-a4f6-9b2eb2495150';
delete from public.user_weekly_mission_state where user_id = '290fb739-fa19-4924-a4f6-9b2eb2495150';
delete from public.user_season_mission_state where user_id = '290fb739-fa19-4924-a4f6-9b2eb2495150';
delete from public.user_daily_chest_state   where user_id = '290fb739-fa19-4924-a4f6-9b2eb2495150';
delete from public.user_weekly_chest_state  where user_id = '290fb739-fa19-4924-a4f6-9b2eb2495150';
delete from public.user_season_chest_state  where user_id = '290fb739-fa19-4924-a4f6-9b2eb2495150';

update public.user_economy set choice_tokens = '[]'::jsonb where user_id = '290fb739-fa19-4924-a4f6-9b2eb2495150';

commit;
