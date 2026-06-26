begin;

-- Canonical progression foundation for cards.
-- This migration upgrades the runtime-facing schema and then removes all
-- existing canonical card rows so the backend bootstrap can rebuild them
-- cleanly from player_saves on the next login.

alter table if exists public.user_cards
  add column if not exists card_definition_id text,
  add column if not exists character_id text,
  add column if not exists card_definition_uuid text,
  add column if not exists character_definition_uuid text,
  add column if not exists card_key text,
  add column if not exists character_key text,
  add column if not exists variant text,
  add column if not exists card_type text,
  add column if not exists rarity text,
  add column if not exists definition_rarity text,
  add column if not exists level integer default 1,
  add column if not exists xp integer default 0,
  add column if not exists stars integer default 1,
  add column if not exists ascension integer default 0,
  add column if not exists awakening integer default 0,
  add column if not exists fragments integer default 0,
  add column if not exists energy integer default 0,
  add column if not exists max_energy integer default 100,
  add column if not exists is_starter boolean default false,
  add column if not exists acquired_at timestamptz default now(),
  add column if not exists updated_at timestamptz default now();

alter table if exists public.user_formation_slots
  add column if not exists card_definition_uuid text,
  add column if not exists character_definition_uuid text,
  add column if not exists updated_at timestamptz default now();

delete from public.user_formation_slots;

delete from public.user_cards;

create unique index if not exists user_cards_user_id_card_definition_id_uidx
  on public.user_cards (user_id, card_definition_id);

create index if not exists user_cards_user_id_idx
  on public.user_cards (user_id);

create index if not exists user_cards_user_id_card_type_idx
  on public.user_cards (user_id, card_type);

create index if not exists user_formation_slots_formation_id_idx
  on public.user_formation_slots (formation_id);

select
  'user_cards_replacement_ready' as status,
  (select count(*) from public.user_cards) as remaining_user_cards,
  (select count(*) from public.user_formation_slots) as remaining_formation_slots;

commit;

-- Despues de ejecutar:
-- 1. vuelve a iniciar sesion en el juego
-- 2. el bootstrap recreara user_cards y user_formation_slots con el formato nuevo
-- 3. probar de nuevo Mejorar y Ascender
