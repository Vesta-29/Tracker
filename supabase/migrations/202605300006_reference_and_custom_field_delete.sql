create or replace function public.delete_contractor_permanently(target_contractor_id uuid)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if not public.current_user_is_admin() then
    raise exception 'Only admins may permanently delete contractors';
  end if;

  if exists(select 1 from public.installations where contractor_id = target_contractor_id) then
    raise exception 'Contractor is used by installation records. Deactivate it to preserve historical references.';
  end if;

  delete from public.contractors where id = target_contractor_id;
end;
$$;

create or replace function public.delete_unit_type_permanently(target_unit_type_id uuid)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if not public.current_user_is_admin() then
    raise exception 'Only admins may permanently delete unit types';
  end if;

  if exists(select 1 from public.installations where unit_type_id = target_unit_type_id) then
    raise exception 'Unit type is used by installation records. Deactivate it to preserve historical references.';
  end if;

  delete from public.unit_types where id = target_unit_type_id;
end;
$$;

create or replace function public.delete_custom_field_permanently(target_field_id uuid)
returns bigint language plpgsql security definer set search_path = ''
as $$
declare
  removed_values bigint;
begin
  if not public.current_user_is_admin() then
    raise exception 'Only admins may permanently delete custom fields';
  end if;

  select count(*) into removed_values
  from public.installation_custom_values where field_id = target_field_id;

  delete from public.installation_custom_values where field_id = target_field_id;
  delete from public.custom_field_options where field_id = target_field_id;
  delete from public.custom_field_definitions where id = target_field_id;

  return removed_values;
end;
$$;
