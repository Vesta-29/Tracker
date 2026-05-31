create or replace function public.audit_installation_change()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  before_payload jsonb;
  after_payload jsonb;
  changed jsonb;
begin
  before_payload := case when tg_op = 'INSERT' then null else to_jsonb(old) end;
  after_payload := case when tg_op = 'DELETE' then null else to_jsonb(new) end;
  select coalesce(jsonb_agg(key order by key), '[]'::jsonb) into changed
  from jsonb_object_keys(coalesce(before_payload, '{}'::jsonb) || coalesce(after_payload, '{}'::jsonb)) as keys(key)
  where key <> 'updated_at' and before_payload -> key is distinct from after_payload -> key;

  if tg_op = 'UPDATE' and changed = '[]'::jsonb then return new; end if;
  insert into public.audit_events(entity_type, entity_id, installation_id, action, actor_id, before_data, after_data, changed_fields)
  values ('installation', coalesce(new.id, old.id), coalesce(new.id, old.id), lower(tg_op), auth.uid(), before_payload, after_payload, changed);
  return coalesce(new, old);
end;
$$;

create or replace function public.audit_installation_child_change()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  entity uuid;
  installation uuid;
  before_payload jsonb;
  after_payload jsonb;
  changed jsonb;
begin
  before_payload := case when tg_op = 'INSERT' then null else to_jsonb(old) end;
  after_payload := case when tg_op = 'DELETE' then null else to_jsonb(new) end;

  if tg_table_name = 'service_visits' then
    entity := coalesce(new.id, old.id);
    installation := coalesce(new.installation_id, old.installation_id);
  elsif tg_table_name = 'installation_components' then
    entity := coalesce(new.id, old.id);
    installation := coalesce(new.installation_id, old.installation_id);
  elsif tg_table_name = 'installation_photos' then
    entity := coalesce(new.id, old.id);
    installation := coalesce(new.installation_id, old.installation_id);
  elsif tg_table_name = 'installation_custom_values' then
    entity := coalesce(new.installation_id, old.installation_id);
    installation := entity;
  elsif tg_table_name = 'installation_component_values' then
    entity := coalesce(new.installation_component_id, old.installation_component_id);
    select component.installation_id into installation from public.installation_components component where component.id = entity;
  elsif tg_table_name = 'service_visit_photos' then
    entity := coalesce(new.id, old.id);
    select visit.installation_id into installation from public.service_visits visit where visit.id = coalesce(new.service_visit_id, old.service_visit_id);
  elsif tg_table_name = 'service_visit_component_changes' then
    entity := coalesce(new.id, old.id);
    select visit.installation_id into installation from public.service_visits visit where visit.id = coalesce(new.service_visit_id, old.service_visit_id);
  end if;

  select coalesce(jsonb_agg(key order by key), '[]'::jsonb) into changed
  from jsonb_object_keys(coalesce(before_payload, '{}'::jsonb) || coalesce(after_payload, '{}'::jsonb)) as keys(key)
  where key <> 'updated_at' and before_payload -> key is distinct from after_payload -> key;

  if tg_op = 'UPDATE' and changed = '[]'::jsonb then return new; end if;
  insert into public.audit_events(entity_type, entity_id, installation_id, action, actor_id, before_data, after_data, changed_fields)
  values (tg_table_name, entity, installation, lower(tg_op), auth.uid(), before_payload, after_payload, changed);
  return coalesce(new, old);
end;
$$;

create or replace function public.save_installation(payload jsonb)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  installation uuid;
  actor uuid := auth.uid();
  contractor uuid;
  unit_type uuid;
  component jsonb;
  component_id uuid;
  requested_component_id uuid;
  component_value record;
  custom_value record;
begin
  if not public.current_user_is_active() then raise exception 'Inactive user'; end if;
  select id into contractor from public.contractors where name = payload ->> 'contractor';
  select id into unit_type from public.unit_types where name = payload ->> 'unitType';
  if contractor is null or unit_type is null then raise exception 'Unknown contractor or unit type'; end if;

  installation := nullif(payload ->> 'dbId', '')::uuid;
  if installation is null then
    insert into public.installations(display_id, site_name, kit_number, unit_type_id, contractor_id, install_date, status, region_code, province_code, municipality_code, barangay_code, address, remarks, created_by, updated_by)
    values (payload ->> 'id', nullif(payload ->> 'siteName', ''), nullif(payload ->> 'legacyKitNumber', ''), unit_type, contractor, (payload ->> 'installDate')::date, (payload ->> 'status')::public.installation_status, payload ->> 'regionCode', nullif(payload ->> 'provinceCode', ''), payload ->> 'municipalityCode', payload ->> 'barangayCode', payload ->> 'address', payload ->> 'remarks', actor, actor)
    returning id into installation;
  else
    update public.installations target set site_name = nullif(payload ->> 'siteName', ''), kit_number = nullif(payload ->> 'legacyKitNumber', ''), unit_type_id = unit_type, contractor_id = contractor, install_date = (payload ->> 'installDate')::date, status = (payload ->> 'status')::public.installation_status, region_code = payload ->> 'regionCode', province_code = nullif(payload ->> 'provinceCode', ''), municipality_code = payload ->> 'municipalityCode', barangay_code = payload ->> 'barangayCode', address = payload ->> 'address', remarks = payload ->> 'remarks', updated_by = actor, updated_at = now()
    where target.id = installation and
      (target.site_name, target.kit_number, target.unit_type_id, target.contractor_id, target.install_date, target.status, target.region_code, target.province_code, target.municipality_code, target.barangay_code, target.address, target.remarks)
      is distinct from
      (nullif(payload ->> 'siteName', ''), nullif(payload ->> 'legacyKitNumber', ''), unit_type, contractor, (payload ->> 'installDate')::date, (payload ->> 'status')::public.installation_status, payload ->> 'regionCode', nullif(payload ->> 'provinceCode', ''), payload ->> 'municipalityCode', payload ->> 'barangayCode', payload ->> 'address', payload ->> 'remarks');
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
