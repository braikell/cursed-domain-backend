begin;

alter table public.profiles
  add column if not exists display_name_changed_at timestamptz,
  add column if not exists display_name_normalized text;

update public.profiles
set
  display_name_changed_at = null,
  display_name_normalized = null;

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

commit;
