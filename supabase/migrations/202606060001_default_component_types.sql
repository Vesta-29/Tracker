alter table public.component_types
add column if not exists default_on_new_site boolean not null default false;
