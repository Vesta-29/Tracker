create or replace function public.delete_component_field_attachment(target_field_definition_id uuid)
returns bigint language plpgsql security definer set search_path = ''
as $$
declare
  removed_values bigint;
begin
  if not public.current_user_is_admin() then
    raise exception 'Only admins may remove equipment fields from component types';
  end if;

  select count(*) into removed_values
  from public.installation_component_values
  where field_definition_id = target_field_definition_id;

  delete from public.installation_component_values
  where field_definition_id = target_field_definition_id;

  delete from public.component_field_definitions
  where id = target_field_definition_id;

  return removed_values;
end;
$$;
