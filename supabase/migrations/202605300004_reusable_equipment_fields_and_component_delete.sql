create table public.equipment_field_library (
  id uuid primary key default gen_random_uuid(),
  label text not null,
  field_type public.component_field_type not null default 'text',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(label, field_type)
);

alter table public.component_field_definitions
  add column library_field_id uuid references public.equipment_field_library(id);

insert into public.equipment_field_library(label, field_type)
select distinct label, field_type from public.component_field_definitions
on conflict(label, field_type) do nothing;

update public.component_field_definitions definition
set library_field_id = library.id
from public.equipment_field_library library
where library.label = definition.label and library.field_type = definition.field_type;

alter table public.equipment_field_library enable row level security;

create policy "active users read equipment field library" on public.equipment_field_library
  for select using (public.current_user_is_active());
create policy "admins manage equipment field library" on public.equipment_field_library
  for all using (public.current_user_is_admin()) with check (public.current_user_is_admin());

create trigger equipment_field_library_audit after insert or update or delete on public.equipment_field_library
for each row execute function public.audit_configuration_change();

create or replace function public.delete_component_type_permanently(target_component_type_id uuid)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if not public.current_user_is_admin() then
    raise exception 'Only admins may permanently delete component types';
  end if;

  delete from public.installation_components
  where component_type_id = target_component_type_id;

  delete from public.component_types
  where id = target_component_type_id;
end;
$$;
