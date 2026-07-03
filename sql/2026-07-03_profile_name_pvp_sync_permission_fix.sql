begin;

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

commit;
