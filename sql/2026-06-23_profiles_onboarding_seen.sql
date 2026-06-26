begin;

alter table public.profiles
  add column if not exists onboarding_seen boolean;

update public.profiles
set onboarding_seen = true
where onboarding_seen is null;

alter table public.profiles
  alter column onboarding_seen set default false,
  alter column onboarding_seen set not null;

commit;
