alter table public.component_field_definitions
  alter column library_field_id set not null;

alter table public.component_field_definitions
  drop constraint component_field_definitions_component_type_id_label_key,
  add constraint component_field_definitions_component_type_library_unique
    unique(component_type_id, library_field_id);

create or replace function public.delete_equipment_field_permanently(target_library_field_id uuid)
returns table(attachment_count bigint, saved_value_count bigint)
language plpgsql security definer set search_path = ''
as $$
declare
  affected_attachments bigint;
  affected_values bigint;
begin
  if not public.current_user_is_admin() then
    raise exception 'Only admins may permanently delete reusable equipment fields';
  end if;

  select count(*) into affected_attachments
  from public.component_field_definitions
  where library_field_id = target_library_field_id;

  select count(*) into affected_values
  from public.installation_component_values value
  join public.component_field_definitions definition on definition.id = value.field_definition_id
  where definition.library_field_id = target_library_field_id;

  delete from public.installation_component_values
  where field_definition_id in (
    select id from public.component_field_definitions
    where library_field_id = target_library_field_id
  );

  delete from public.component_field_definitions
  where library_field_id = target_library_field_id;

  delete from public.equipment_field_library
  where id = target_library_field_id;

  return query select affected_attachments, affected_values;
end;
$$;

-- Shared label and type are authoritative. Template rows now store attachment settings only.
alter table public.component_field_definitions
  drop column label,
  drop column field_type;
