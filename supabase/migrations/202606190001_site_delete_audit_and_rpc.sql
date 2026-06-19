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
  values (
    'installation',
    coalesce(new.id, old.id),
    case when tg_op = 'DELETE' then null else new.id end,
    lower(tg_op),
    auth.uid(),
    before_payload,
    after_payload,
    changed
  );
  return coalesce(new, old);
end;
$$;

create or replace function public.delete_installation_permanently(target_display_id text)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  installation uuid;
begin
  if not public.current_user_can_edit() then raise exception 'Editor access required'; end if;

  select id into installation
  from public.installations
  where display_id = target_display_id;

  if installation is null then raise exception 'Site % was not found', target_display_id; end if;

  update public.installation_components
  set installed_via_visit_id = null,
      removed_via_visit_id = null
  where installation_id = installation;

  delete from public.service_visit_component_changes change
  using public.service_visits visit
  where change.service_visit_id = visit.id
    and visit.installation_id = installation;

  delete from public.service_visit_photos photo
  using public.service_visits visit
  where photo.service_visit_id = visit.id
    and visit.installation_id = installation;

  delete from public.service_visits
  where installation_id = installation;

  delete from public.installation_component_values value
  using public.installation_components component
  where value.installation_component_id = component.id
    and component.installation_id = installation;

  delete from public.installation_components
  where installation_id = installation;

  delete from public.installation_custom_values
  where installation_id = installation;

  delete from public.installation_photos
  where installation_id = installation;

  delete from public.legacy_kit_reassignments
  where installation_id = installation;

  delete from public.installations
  where id = installation;
end;
$$;
