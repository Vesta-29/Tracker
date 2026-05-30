alter table public.installations
  add column site_name text,
  add column site_name_required boolean not null default true;

create unique index installations_site_name_unique_idx
  on public.installations(lower(site_name))
  where site_name is not null;

create or replace function public.sync_site_name_required()
returns trigger language plpgsql as $$
begin
  new.site_name_required := new.site_name is null or btrim(new.site_name) = '';
  return new;
end;
$$;

create trigger installations_sync_site_name_required
before insert or update of site_name on public.installations
for each row execute function public.sync_site_name_required();

create type public.component_field_type as enum ('text', 'mac');

create table public.component_field_definitions (
  id uuid primary key default gen_random_uuid(),
  component_type_id uuid not null references public.component_types(id) on delete cascade,
  label text not null,
  field_type public.component_field_type not null default 'text',
  required boolean not null default false,
  display_order integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(component_type_id, label)
);

create table public.installation_component_values (
  id uuid primary key default gen_random_uuid(),
  installation_component_id uuid not null references public.installation_components(id) on delete cascade,
  field_definition_id uuid not null references public.component_field_definitions(id),
  value text not null,
  duplicate_mac_acknowledged boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(installation_component_id, field_definition_id)
);

create table public.legacy_kit_reassignments (
  id uuid primary key default gen_random_uuid(),
  installation_id uuid not null unique references public.installations(id) on delete cascade,
  legacy_kit_number text not null,
  resolved boolean not null default false,
  resolved_component_value_id uuid references public.installation_component_values(id),
  resolved_by uuid references public.profiles(id),
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);

create index component_field_definitions_type_idx on public.component_field_definitions(component_type_id);
create index installation_component_values_component_idx on public.installation_component_values(installation_component_id);
create index installation_component_values_mac_lookup_idx on public.installation_component_values(lower(value));
create index legacy_kit_reassignments_pending_idx on public.legacy_kit_reassignments(resolved) where not resolved;

insert into public.legacy_kit_reassignments(installation_id, legacy_kit_number)
select id, kit_number from public.installations where kit_number is not null and kit_number <> '';

alter table public.component_field_definitions enable row level security;
alter table public.installation_component_values enable row level security;
alter table public.legacy_kit_reassignments enable row level security;

create policy "active users read component field definitions" on public.component_field_definitions
  for select using (public.current_user_is_active());
create policy "admins manage component field definitions" on public.component_field_definitions
  for all using (public.current_user_is_admin()) with check (public.current_user_is_admin());
create policy "active users manage component values" on public.installation_component_values
  for all using (public.current_user_is_active()) with check (public.current_user_is_active());
create policy "active users manage legacy kit queue" on public.legacy_kit_reassignments
  for all using (public.current_user_is_active()) with check (public.current_user_is_active());

create trigger component_field_definitions_audit after insert or update or delete on public.component_field_definitions
for each row execute function public.audit_configuration_change();

-- Seed per-type Serial number fields and carry current fixed values into the flexible model.
insert into public.component_field_definitions(component_type_id, label, field_type, required, display_order)
select id, 'Serial number', 'text', false, 0 from public.component_types;

insert into public.installation_component_values(installation_component_id, field_definition_id, value)
select component.id, field.id, component.serial_number
from public.installation_components component
join public.component_field_definitions field on field.component_type_id = component.component_type_id and field.label = 'Serial number'
where component.serial_number is not null and component.serial_number <> '';

-- Seed MAC address only for component types that already have MAC-bearing records.
insert into public.component_field_definitions(component_type_id, label, field_type, required, display_order)
select distinct component_type_id, 'MAC address', 'mac', false, 1
from public.installation_components where mac_address is not null
on conflict(component_type_id, label) do nothing;

insert into public.installation_component_values(installation_component_id, field_definition_id, value, duplicate_mac_acknowledged)
select component.id, field.id, component.mac_address, component.duplicate_mac_acknowledged
from public.installation_components component
join public.component_field_definitions field on field.component_type_id = component.component_type_id and field.label = 'MAC address'
where component.mac_address is not null;
