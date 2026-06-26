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
