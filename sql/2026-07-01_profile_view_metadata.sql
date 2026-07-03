alter table public.profiles
  add column if not exists profile_created_at timestamptz,
  add column if not exists display_name_changed_at timestamptz,
  add column if not exists profile_backdrop text,
  add column if not exists display_name_normalized text;

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

create or replace function public.normalize_profile_display_name(value text)
returns text
language sql
immutable
as $$
  select nullif(regexp_replace(btrim(coalesce(value, '')), '\s+', ' ', 'g'), '');
$$;

create or replace function public.profile_display_name_key(value text)
returns text
language sql
immutable
as $$
  select nullif(regexp_replace(lower(public.normalize_profile_display_name(value)), '\s+', '', 'g'), '');
$$;

create or replace function public.profile_display_name_has_blocked_word(normalized_name text)
returns boolean
language sql
immutable
as $$
  select exists (
    select 1
    from unnest(array[
      'admin',
      'moderador',
      'soporte',
      'system',
      'puta',
      'puto',
      'mierda',
      'pene',
      'vagina',
      'sexo',
      'porno',
      'porn',
      'fuck',
      'shit',
      'bitch',
      'nazi'
    ]) as blocked(word)
    where normalized_name like '%' || blocked.word || '%'
  );
$$;

create or replace function public.prevent_profile_display_name_second_change()
returns trigger
language plpgsql
as $$
declare
  normalized_name text;
begin
  if old.display_name is distinct from new.display_name then
    if old.display_name_changed_at is not null and old.display_name_normalized is not null then
      raise exception 'display_name_can_only_be_changed_once';
    end if;

    new.display_name = public.normalize_profile_display_name(new.display_name);
    normalized_name = public.profile_display_name_key(new.display_name);

    if normalized_name is null
      or length(new.display_name) < 3
      or length(new.display_name) > 24
      or new.display_name !~ '^[A-Za-z0-9 ]+$'
    then
      raise exception 'display_name_invalid_format';
    end if;

    if public.profile_display_name_has_blocked_word(normalized_name) then
      raise exception 'display_name_reserved_or_obscene';
    end if;

    if exists (
      select 1
      from public.profiles p
      where p.id <> old.id
        and public.profile_display_name_key(p.display_name) = normalized_name
    ) then
      raise exception 'display_name_already_taken';
    end if;

    new.display_name_normalized = normalized_name;
    new.display_name_changed_at = now();
  end if;

  return new;
end;
$$;

drop trigger if exists profiles_display_name_once_trigger on public.profiles;

create trigger profiles_display_name_once_trigger
before update of display_name on public.profiles
for each row
execute function public.prevent_profile_display_name_second_change();

with changed_profiles as (
  select
    id,
    public.profile_display_name_key(display_name) as normalized_name,
    row_number() over (
      partition by public.profile_display_name_key(display_name)
      order by display_name_changed_at nulls last, id
    ) as duplicate_rank
  from public.profiles
  where display_name_changed_at is not null
    and public.profile_display_name_key(display_name) is not null
)
update public.profiles p
set display_name_normalized = changed_profiles.normalized_name
from changed_profiles
where p.id = changed_profiles.id
  and changed_profiles.duplicate_rank = 1
  and p.display_name_normalized is not null;

create unique index if not exists profiles_display_name_normalized_unique
  on public.profiles (display_name_normalized)
  where display_name_normalized is not null;

create or replace function public.sync_profile_display_name_to_pvp()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.display_name is distinct from new.display_name
    and to_regclass('public.user_pvp_profiles') is not null
  then
    update public.user_pvp_profiles
    set
      display_name = new.display_name,
      defense_snapshot = case
        when defense_snapshot is null or defense_snapshot = '{}'::jsonb then defense_snapshot
        else jsonb_set(defense_snapshot, '{displayName}', to_jsonb(new.display_name), true)
      end,
      updated_at = now()
    where user_id = new.id;
  end if;

  return new;
end;
$$;

drop trigger if exists profiles_sync_display_name_to_pvp_trigger on public.profiles;

create trigger profiles_sync_display_name_to_pvp_trigger
after update of display_name on public.profiles
for each row
execute function public.sync_profile_display_name_to_pvp();
