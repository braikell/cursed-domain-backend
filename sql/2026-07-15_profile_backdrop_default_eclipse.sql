-- Cambia el default visual del perfil a Eclipse sin sobrescribir usuarios existentes.
-- Los jugadores que elijan Abismo conservan profile_backdrop = 'abyss'.

alter table public.profiles
  alter column profile_backdrop set default 'eclipse';

update public.profiles
set profile_backdrop = 'eclipse'
where profile_backdrop is null
   or profile_backdrop not in ('abyss', 'eclipse');
