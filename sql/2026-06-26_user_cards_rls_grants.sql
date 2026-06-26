-- PostgREST needs table privileges in addition to RLS policies.
-- The policies in 2026-06-25_user_cards_and_formations_rls.sql restrict rows
-- to auth.uid() = user_id; these grants only allow the authenticated role to
-- reach those policies.

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
