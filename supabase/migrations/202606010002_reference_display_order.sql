alter table public.contractors add column display_order integer not null default 0;
alter table public.unit_types add column display_order integer not null default 0;
alter table public.component_types add column display_order integer not null default 0;
alter table public.service_visit_types add column display_order integer not null default 0;

with ranked as (
  select id, row_number() over (order by name) - 1 as display_order
  from public.contractors
)
update public.contractors target
set display_order = ranked.display_order
from ranked
where target.id = ranked.id;

with ranked as (
  select id, row_number() over (order by name) - 1 as display_order
  from public.unit_types
)
update public.unit_types target
set display_order = ranked.display_order
from ranked
where target.id = ranked.id;

with ranked as (
  select id, row_number() over (order by name) - 1 as display_order
  from public.component_types
)
update public.component_types target
set display_order = ranked.display_order
from ranked
where target.id = ranked.id;

with ranked as (
  select id, row_number() over (order by name) - 1 as display_order
  from public.service_visit_types
)
update public.service_visit_types target
set display_order = ranked.display_order
from ranked
where target.id = ranked.id;
