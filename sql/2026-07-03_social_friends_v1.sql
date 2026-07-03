begin;

alter table public.profiles
  add column if not exists last_seen_at timestamptz;

create table if not exists public.friend_requests (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references auth.users(id) on delete cascade,
  addressee_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  responded_at timestamptz,
  check (requester_id <> addressee_id),
  check (status in ('pending', 'accepted', 'declined', 'canceled'))
);

create table if not exists public.user_friends (
  user_id uuid not null references auth.users(id) on delete cascade,
  friend_user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, friend_user_id),
  check (user_id <> friend_user_id)
);

create unique index if not exists friend_requests_pending_pair_idx
  on public.friend_requests (
    least(requester_id, addressee_id),
    greatest(requester_id, addressee_id)
  )
  where status = 'pending';

create index if not exists friend_requests_requester_idx
  on public.friend_requests (requester_id, status, created_at desc);

create index if not exists friend_requests_addressee_idx
  on public.friend_requests (addressee_id, status, created_at desc);

create index if not exists user_friends_friend_idx
  on public.user_friends (friend_user_id, created_at desc);

create index if not exists profiles_last_seen_at_idx
  on public.profiles (last_seen_at desc);

create or replace function public.refresh_friend_request_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  if old.status = 'pending' and new.status in ('accepted', 'declined', 'canceled') then
    new.responded_at = now();
  end if;
  return new;
end;
$$;

drop trigger if exists friend_requests_refresh_updated_at_trigger on public.friend_requests;
create trigger friend_requests_refresh_updated_at_trigger
before update of status on public.friend_requests
for each row
execute function public.refresh_friend_request_updated_at();

alter table public.friend_requests enable row level security;
alter table public.user_friends enable row level security;

drop policy if exists friend_requests_select_own on public.friend_requests;
create policy friend_requests_select_own
  on public.friend_requests
  for select
  to authenticated
  using (auth.uid() = requester_id or auth.uid() = addressee_id);

drop policy if exists user_friends_select_own on public.user_friends;
create policy user_friends_select_own
  on public.user_friends
  for select
  to authenticated
  using (auth.uid() = user_id);

grant usage on schema public to authenticated;
grant select on table public.friend_requests to authenticated;
grant select on table public.user_friends to authenticated;

commit;
