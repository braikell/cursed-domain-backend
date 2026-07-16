begin;

alter table public.profiles
  add column if not exists tutorial_progress integer default 0 not null;

alter table public.profiles
  add column if not exists tutorial_completed boolean default false not null;

comment on column public.profiles.tutorial_progress is 'Step number the player reached in the interactive tutorial (0=not started, 7=done)';
comment on column public.profiles.tutorial_completed is 'True once the player completes all tutorial steps';

commit;
