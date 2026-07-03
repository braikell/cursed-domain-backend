begin;

alter table public.user_pack_limits enable row level security;

drop policy if exists user_pack_limits_select_own on public.user_pack_limits;
create policy user_pack_limits_select_own
  on public.user_pack_limits
  for select
  to authenticated
  using (auth.uid() = user_id);

grant usage on schema public to authenticated;
grant select on table public.user_pack_limits to authenticated;

commit;
