begin;

-- Visual-only correction. Runtime ids stay canonical as "toge" /
-- "toge_base_basic", but the player-facing name is "Toge Inumaki".

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'character_definitions'
      and column_name = 'display_name'
  ) then
    update public.character_definitions
    set display_name = 'Toge Inumaki'
    where lower(coalesce(character_key, '')) in ('toge', 'inumaki')
       or lower(coalesce(display_name, '')) in ('toge', 'inumaki');
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'character_definitions'
      and column_name = 'name'
  ) then
    update public.character_definitions
    set name = 'Toge Inumaki'
    where lower(coalesce(character_key, '')) in ('toge', 'inumaki')
       or lower(coalesce(name, '')) in ('toge', 'inumaki');
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'card_definitions'
      and column_name = 'display_name'
  ) then
    update public.card_definitions
    set display_name = 'Toge Inumaki'
    where lower(coalesce(character_key, '')) in ('toge', 'inumaki')
       or lower(coalesce(card_key, '')) in ('toge_base_basic', 'inumaki_base_basic')
       or lower(coalesce(display_name, '')) in ('toge', 'inumaki');
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'card_definitions'
      and column_name = 'name'
  ) then
    update public.card_definitions
    set name = 'Toge Inumaki'
    where lower(coalesce(character_key, '')) in ('toge', 'inumaki')
       or lower(coalesce(card_key, '')) in ('toge_base_basic', 'inumaki_base_basic')
       or lower(coalesce(name, '')) in ('toge', 'inumaki');
  end if;
end $$;

commit;
