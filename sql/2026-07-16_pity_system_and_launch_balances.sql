begin;

drop table if exists public.user_pity;

create table public.user_pity (
  user_id uuid not null references auth.users(id) on delete cascade,
  pack_id text not null,
  pity_legendary int not null default 0,
  pity_mythic int not null default 0,
  target_counter int not null default 0,
  soft_pity_step int not null default 0,
  config_version int not null default 1,
  updated_at timestamptz not null default now(),
  last_target_hit_at timestamptz,
  primary key (user_id, pack_id)
);

alter table public.user_pity enable row level security;

drop policy if exists "user_pity_select_own" on public.user_pity;
create policy "user_pity_select_own" on public.user_pity
  for select using (auth.uid() = user_id);

commit;
