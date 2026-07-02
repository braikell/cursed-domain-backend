begin;

with completed_pack_purchases as (
  select
    user_id,
    response->>'packId' as pack_id,
    (response->>'purchaseCurrency')::public.pack_currency_type as purchase_currency,
    response #>> '{limitWindow,windowKey}' as window_key,
    sum((response->>'count')::int) as actual_purchase_count
  from public.idempotency_keys
  where operation like 'purchase_pack_v1:%'
    and response is not null
    and response->>'packId' is not null
    and response->>'purchaseCurrency' in ('gold', 'gems')
    and response->>'count' is not null
    and response #>> '{limitWindow,windowKey}' is not null
  group by
    user_id,
    response->>'packId',
    response->>'purchaseCurrency',
    response #>> '{limitWindow,windowKey}'
),
repaired_limits as (
  update public.user_pack_limits upl
  set
    purchases = cpp.actual_purchase_count,
    updated_at = now()
  from completed_pack_purchases cpp
  where upl.user_id = cpp.user_id
    and upl.pack_id = cpp.pack_id
    and upl.purchase_currency = cpp.purchase_currency
    and upl.window_key = cpp.window_key
    and upl.purchases <> cpp.actual_purchase_count
  returning
    upl.user_id,
    upl.pack_id,
    upl.purchase_currency,
    upl.window_key,
    cpp.actual_purchase_count as repaired_purchases
)
select
  count(*) as repaired_user_pack_limit_rows
from repaired_limits;

commit;

-- Verificacion sugerida:
-- select user_id, pack_id, purchase_currency, purchases, window_key, updated_at
-- from public.user_pack_limits
-- order by updated_at desc
-- limit 50;
