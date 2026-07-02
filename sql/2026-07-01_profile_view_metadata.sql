alter table public.profiles
  add column if not exists profile_created_at timestamptz,
  add column if not exists display_name_changed_at timestamptz,
  add column if not exists profile_backdrop text;

update public.profiles
set
  profile_created_at = coalesce(profile_created_at, updated_at, now()),
  profile_backdrop = case
    when profile_backdrop in ('abyss', 'eclipse') then profile_backdrop
    else 'abyss'
  end;

alter table public.profiles
  alter column profile_created_at set default now(),
  alter column profile_backdrop set default 'abyss';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'profiles_profile_backdrop_check'
  ) then
    alter table public.profiles
      add constraint profiles_profile_backdrop_check
      check (profile_backdrop in ('abyss', 'eclipse'));
  end if;
end $$;

create or replace function public.prevent_profile_display_name_second_change()
returns trigger
language plpgsql
as $$
begin
  if old.display_name is distinct from new.display_name then
    if old.display_name_changed_at is not null then
      raise exception 'display_name can only be changed once';
    end if;

    if old.display_name is not null and new.display_name_changed_at is null then
      new.display_name_changed_at = now();
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists profiles_display_name_once_trigger on public.profiles;

create trigger profiles_display_name_once_trigger
before update of display_name on public.profiles
for each row
execute function public.prevent_profile_display_name_second_change();
