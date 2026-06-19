alter table public.installations
  drop constraint if exists installations_longitude_range,
  drop constraint if exists installations_latitude_range,
  alter column barangay_code drop not null,
  add column if not exists plus_code text,
  drop column if exists longitude,
  drop column if exists latitude;

create or replace function public.save_installation(payload jsonb)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  installation uuid;
  actor uuid := auth.uid();
  contractor uuid;
  unit_type uuid;
  status_value text;
  activation date;
  component jsonb;
  component_id uuid;
  requested_component_id uuid;
  component_value record;
  custom_value record;
begin
  if not public.current_user_can_edit() then raise exception 'Editor access required'; end if;
  select id into contractor from public.contractors where name = payload ->> 'contractor';
  select id into unit_type from public.unit_types where name = payload ->> 'unitType';
  select value into status_value from public.installation_status_options where value = payload ->> 'status';
  activation := coalesce(nullif(payload ->> 'activationDate', '')::date, current_date);
  if nullif(payload ->> 'id', '') is null then raise exception 'School ID is required'; end if;
  if contractor is null or unit_type is null then raise exception 'Unknown contractor or unit type'; end if;
  if status_value is null then raise exception 'Unknown site status'; end if;

  installation := nullif(payload ->> 'dbId', '')::uuid;
  if installation is null then
    insert into public.installations(school_id, site_name, kit_number, unit_type_id, contractor_id, installer_team_lead, install_date, activation_date, status, region_code, province_code, municipality_code, barangay_code, plus_code, beneficiary_name, beneficiary_role, beneficiary_phone, remarks, created_by, updated_by)
    values (payload ->> 'id', nullif(payload ->> 'siteName', ''), nullif(payload ->> 'legacyKitNumber', ''), unit_type, contractor, nullif(payload ->> 'installerTeamLead', ''), (payload ->> 'installDate')::date, activation, status_value, payload ->> 'regionCode', nullif(payload ->> 'provinceCode', ''), payload ->> 'municipalityCode', nullif(payload ->> 'barangayCode', ''), nullif(payload ->> 'plusCode', ''), nullif(payload ->> 'beneficiaryName', ''), nullif(payload ->> 'beneficiaryRole', ''), nullif(payload ->> 'beneficiaryPhone', ''), payload ->> 'remarks', actor, actor)
    returning id into installation;
  else
    update public.installations target set school_id = payload ->> 'id', site_name = nullif(payload ->> 'siteName', ''), kit_number = nullif(payload ->> 'legacyKitNumber', ''), unit_type_id = unit_type, contractor_id = contractor, installer_team_lead = nullif(payload ->> 'installerTeamLead', ''), install_date = (payload ->> 'installDate')::date, activation_date = activation, status = status_value, region_code = payload ->> 'regionCode', province_code = nullif(payload ->> 'provinceCode', ''), municipality_code = payload ->> 'municipalityCode', barangay_code = nullif(payload ->> 'barangayCode', ''), plus_code = nullif(payload ->> 'plusCode', ''), beneficiary_name = nullif(payload ->> 'beneficiaryName', ''), beneficiary_role = nullif(payload ->> 'beneficiaryRole', ''), beneficiary_phone = nullif(payload ->> 'beneficiaryPhone', ''), remarks = payload ->> 'remarks', updated_by = actor, updated_at = now()
    where target.id = installation and
      (target.school_id, target.site_name, target.kit_number, target.unit_type_id, target.contractor_id, target.installer_team_lead, target.install_date, target.activation_date, target.status, target.region_code, target.province_code, target.municipality_code, target.barangay_code, target.plus_code, target.beneficiary_name, target.beneficiary_role, target.beneficiary_phone, target.remarks)
      is distinct from
      (payload ->> 'id', nullif(payload ->> 'siteName', ''), nullif(payload ->> 'legacyKitNumber', ''), unit_type, contractor, nullif(payload ->> 'installerTeamLead', ''), (payload ->> 'installDate')::date, activation, status_value, payload ->> 'regionCode', nullif(payload ->> 'provinceCode', ''), payload ->> 'municipalityCode', nullif(payload ->> 'barangayCode', ''), nullif(payload ->> 'plusCode', ''), nullif(payload ->> 'beneficiaryName', ''), nullif(payload ->> 'beneficiaryRole', ''), nullif(payload ->> 'beneficiaryPhone', ''), payload ->> 'remarks');
    delete from public.installation_custom_values target where target.installation_id = installation and not (coalesce(payload -> 'customValues', '{}'::jsonb) ? target.field_id::text);
  end if;

  for component in select * from jsonb_array_elements(coalesce(payload -> 'components', '[]'::jsonb)) loop
    component_id := null;
    requested_component_id := null;
    if coalesce(component ->> 'id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
      requested_component_id := (component ->> 'id')::uuid;
      select id into component_id from public.installation_components where id = requested_component_id and installation_id = installation;
    end if;
    if component_id is null then
      insert into public.installation_components(id, installation_id, component_type_id, serial_number, notes, installed_at, removed_at)
      select coalesce(requested_component_id, gen_random_uuid()), installation, type.id, null, component ->> 'notes', coalesce(nullif(component ->> 'installedAt', '')::timestamptz, now()), nullif(component ->> 'removedAt', '')::timestamptz
      from public.component_types type where type.name = component ->> 'type'
      returning id into component_id;
    else
      update public.installation_components target set component_type_id = type.id, notes = component ->> 'notes', installed_at = coalesce(nullif(component ->> 'installedAt', '')::timestamptz, target.installed_at), removed_at = nullif(component ->> 'removedAt', '')::timestamptz
      from public.component_types type
      where target.id = component_id and type.name = component ->> 'type'
        and (target.component_type_id, target.notes, target.installed_at, target.removed_at) is distinct from (type.id, component ->> 'notes', coalesce(nullif(component ->> 'installedAt', '')::timestamptz, target.installed_at), nullif(component ->> 'removedAt', '')::timestamptz);
      delete from public.installation_component_values target where target.installation_component_id = component_id and not (coalesce(component -> 'values', '{}'::jsonb) ? target.field_definition_id::text);
    end if;
    for component_value in select key, value from jsonb_each_text(coalesce(component -> 'values', '{}'::jsonb)) loop
      insert into public.installation_component_values(installation_component_id, field_definition_id, value, duplicate_mac_acknowledged)
      values (component_id, component_value.key::uuid, component_value.value, coalesce((component ->> 'duplicateMacAcknowledged')::boolean, false))
      on conflict(installation_component_id, field_definition_id) do update
      set value = excluded.value, duplicate_mac_acknowledged = excluded.duplicate_mac_acknowledged, updated_at = now()
      where (installation_component_values.value, installation_component_values.duplicate_mac_acknowledged) is distinct from (excluded.value, excluded.duplicate_mac_acknowledged);
    end loop;
  end loop;

  for custom_value in select key, value from jsonb_each_text(coalesce(payload -> 'customValues', '{}'::jsonb)) loop
    if custom_value.value <> '' then
      insert into public.installation_custom_values(installation_id, field_id, value) values (installation, custom_value.key::uuid, custom_value.value)
      on conflict(installation_id, field_id) do update set value = excluded.value, updated_at = now()
      where installation_custom_values.value is distinct from excluded.value;
    else
      delete from public.installation_custom_values target where target.installation_id = installation and target.field_id = custom_value.key::uuid;
    end if;
  end loop;
  return installation;
end;
$$;
