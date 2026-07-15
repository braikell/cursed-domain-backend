-- Diagnostico no destructivo: confirma si las gemas por subida de nivel
-- fueron otorgadas por el backend y registradas en el ledger.

select
  created_at,
  user_id,
  source,
  source_id,
  request_id,
  status,
  xp_amount,
  xp_before,
  xp_after,
  level_before,
  level_after,
  gems_granted,
  reward_gems
from public.user_player_xp_grants
order by created_at desc
limit 30;

-- Ver economia actual por cuenta:
-- select user_id, gold, gems, updated_at
-- from public.user_economy
-- order by updated_at desc;
