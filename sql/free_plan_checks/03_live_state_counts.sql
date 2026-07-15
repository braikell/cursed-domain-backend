-- 03 - Estado vivo principal por usuario.
-- Ejecutar en Supabase SQL Editor. No modifica datos.

select
  'player_saves' as source,
  count(*)::bigint as rows,
  count(distinct user_id)::bigint as users
from public.player_saves
union all
select
  'user_cards' as source,
  count(*)::bigint as rows,
  count(distinct user_id)::bigint as users
from public.user_cards
union all
select
  'user_inventory' as source,
  count(*)::bigint as rows,
  count(distinct user_id)::bigint as users
from public.user_inventory
union all
select
  'user_materials' as source,
  count(*)::bigint as rows,
  count(distinct user_id)::bigint as users
from public.user_materials;
