begin;

create table if not exists public.user_pity (
  user_id uuid primary key references auth.users(id) on delete cascade,
  pity_counter int not null default 0 check (pity_counter >= 0),
  updated_at timestamptz not null default now()
);

alter table public.user_pity enable row level security;

drop policy if exists "user_pity_select_own" on public.user_pity;
create policy "user_pity_select_own" on public.user_pity
  for select using (auth.uid() = user_id);

drop policy if exists "user_pity_upsert_own" on public.user_pity;
create policy "user_pity_upsert_own" on public.user_pity
  for insert with check (auth.uid() = user_id);

drop policy if exists "user_pity_update_own" on public.user_pity;
create policy "user_pity_update_own" on public.user_pity
  for update using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

comment on table public.user_pity is 'Contador de pity del sistema gacha. Soft pity a 70, hard pity a 90.';
comment on column public.user_pity.pity_counter is 'Numero consecutivo de pulls sin legendary ni mythic. Max efectivo 90.';

commit;
