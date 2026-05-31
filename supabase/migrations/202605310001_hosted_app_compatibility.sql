alter table public.installations alter column kit_number drop not null;
alter table public.installation_components alter column serial_number drop not null;
alter table public.custom_field_definitions add constraint custom_field_definitions_label_key unique(label);

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.profiles(id, full_name, email, role, active)
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data ->> 'full_name', ''), split_part(new.email, '@', 1)),
    coalesce(new.email, ''),
    'staff',
    true
  )
  on conflict(id) do update set email = excluded.email, updated_at = now();
  return new;
end;
$$;

create trigger auth_user_profile_created
after insert or update of email on auth.users
for each row execute function public.handle_new_user();

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('service-visit-photos', 'service-visit-photos', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create policy "active users update installation photos" on storage.objects for update
using (bucket_id = 'installation-photos' and public.current_user_is_active())
with check (bucket_id = 'installation-photos' and public.current_user_is_active());
create policy "active users delete installation photos" on storage.objects for delete
using (bucket_id = 'installation-photos' and public.current_user_is_active());
create policy "active users read service visit photos" on storage.objects for select
using (bucket_id = 'service-visit-photos' and public.current_user_is_active());
create policy "active users upload service visit photos" on storage.objects for insert
with check (bucket_id = 'service-visit-photos' and public.current_user_is_active());
create policy "active users update service visit photos" on storage.objects for update
using (bucket_id = 'service-visit-photos' and public.current_user_is_active())
with check (bucket_id = 'service-visit-photos' and public.current_user_is_active());
create policy "active users delete service visit photos" on storage.objects for delete
using (bucket_id = 'service-visit-photos' and public.current_user_is_active());

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
    update public.installations set site_name = nullif(payload ->> 'siteName', ''), kit_number = nullif(payload ->> 'legacyKitNumber', ''), unit_type_id = unit_type, contractor_id = contractor, install_date = (payload ->> 'installDate')::date, status = (payload ->> 'status')::public.installation_status, region_code = payload ->> 'regionCode', province_code = nullif(payload ->> 'provinceCode', ''), municipality_code = payload ->> 'municipalityCode', barangay_code = payload ->> 'barangayCode', address = payload ->> 'address', remarks = payload ->> 'remarks', updated_by = actor, updated_at = now()
    where id = installation;
    delete from public.installation_custom_values where installation_id = installation;
  end if;

  for component in select * from jsonb_array_elements(coalesce(payload -> 'components', '[]'::jsonb)) loop
    component_id := null;
    requested_component_id := null;
    if coalesce(component ->> 'id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
      requested_component_id := (component ->> 'id')::uuid;
      select id into component_id
      from public.installation_components
      where id = requested_component_id and installation_id = installation;
    end if;
    if component_id is null then
      insert into public.installation_components(id, installation_id, component_type_id, serial_number, notes, installed_at, removed_at)
      select coalesce(requested_component_id, gen_random_uuid()), installation, type.id, null, component ->> 'notes', coalesce(nullif(component ->> 'installedAt', '')::timestamptz, now()), nullif(component ->> 'removedAt', '')::timestamptz
      from public.component_types type where type.name = component ->> 'type'
      returning id into component_id;
    else
      update public.installation_components target
      set component_type_id = type.id,
          notes = component ->> 'notes',
          installed_at = coalesce(nullif(component ->> 'installedAt', '')::timestamptz, target.installed_at),
          removed_at = nullif(component ->> 'removedAt', '')::timestamptz
      from public.component_types type
      where target.id = component_id and type.name = component ->> 'type';
      delete from public.installation_component_values where installation_component_id = component_id;
    end if;
    for component_value in select key, value from jsonb_each_text(coalesce(component -> 'values', '{}'::jsonb)) loop
      insert into public.installation_component_values(installation_component_id, field_definition_id, value, duplicate_mac_acknowledged)
      values (component_id, component_value.key::uuid, component_value.value, coalesce((component ->> 'duplicateMacAcknowledged')::boolean, false));
    end loop;
  end loop;
  for custom_value in select key, value from jsonb_each_text(coalesce(payload -> 'customValues', '{}'::jsonb)) loop
    if custom_value.value <> '' then insert into public.installation_custom_values(installation_id, field_id, value) values (installation, custom_value.key::uuid, custom_value.value); end if;
  end loop;
  return installation;
end;
$$;

create or replace function public.save_service_visit(payload jsonb, installation_payload jsonb default null)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  visit uuid := nullif(payload ->> 'dbId', '')::uuid;
  actor uuid := auth.uid();
  contractor uuid;
  visit_type uuid;
  component_change jsonb;
  component_id uuid;
begin
  if not public.current_user_is_active() then raise exception 'Inactive user'; end if;
  if installation_payload is not null then perform public.save_installation(installation_payload); end if;
  select id into contractor from public.contractors where name = payload ->> 'contractor';
  select id into visit_type from public.service_visit_types where name = payload ->> 'type';
  if contractor is null or visit_type is null then raise exception 'Unknown contractor or visit type'; end if;
  if visit is null then
    insert into public.service_visits(display_id, installation_id, visit_type_id, status, ticket_reference, contractor_id, scheduled_date, completed_date, notes, created_by, updated_by)
    values (payload ->> 'id', (payload ->> 'installationDbId')::uuid, visit_type, (payload ->> 'status')::public.service_visit_status, nullif(payload ->> 'ticketReference', ''), contractor, (payload ->> 'scheduledDate')::date, nullif(payload ->> 'completedDate', '')::date, payload ->> 'notes', actor, actor)
    returning id into visit;
  else
    update public.service_visits set visit_type_id = visit_type, status = (payload ->> 'status')::public.service_visit_status, ticket_reference = nullif(payload ->> 'ticketReference', ''), contractor_id = contractor, scheduled_date = (payload ->> 'scheduledDate')::date, completed_date = nullif(payload ->> 'completedDate', '')::date, notes = payload ->> 'notes', updated_by = actor, updated_at = now()
    where id = visit;
  end if;
  delete from public.service_visit_component_changes where service_visit_id = visit;
  for component_change in select * from jsonb_array_elements(coalesce(payload -> 'componentChanges', '[]'::jsonb)) loop
    component_id := nullif(component_change ->> 'componentId', '')::uuid;
    if exists(select 1 from public.installation_components where id = component_id and installation_id = (payload ->> 'installationDbId')::uuid) then
      insert into public.service_visit_component_changes(service_visit_id, installation_component_id, action, notes, created_by)
      values (visit, component_id, component_change ->> 'action', component_change ->> 'summary', actor);
      if component_change ->> 'action' = 'installed' then
        update public.installation_components set installed_via_visit_id = visit where id = component_id;
      elsif component_change ->> 'action' = 'removed' then
        update public.installation_components set removed_via_visit_id = visit where id = component_id;
      end if;
    end if;
  end loop;
  return visit;
end;
$$;

create or replace function public.save_installation_batch(payload jsonb, source_filename text)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  batch uuid;
  actor uuid := auth.uid();
  installation jsonb;
  row_count integer := jsonb_array_length(coalesce(payload, '[]'::jsonb));
begin
  if not public.current_user_is_active() then raise exception 'Inactive user'; end if;
  insert into public.import_batches(filename, status, total_rows, valid_rows, invalid_rows, uploaded_by)
  values (source_filename, 'previewed', row_count, row_count, 0, actor)
  returning id into batch;
  for installation in select * from jsonb_array_elements(coalesce(payload, '[]'::jsonb)) loop
    perform public.save_installation(installation);
  end loop;
  update public.import_batches set status = 'completed' where id = batch;
  return batch;
end;
$$;
