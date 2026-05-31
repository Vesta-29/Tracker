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
    update public.service_visits target set visit_type_id = visit_type, status = (payload ->> 'status')::public.service_visit_status, ticket_reference = nullif(payload ->> 'ticketReference', ''), contractor_id = contractor, scheduled_date = (payload ->> 'scheduledDate')::date, completed_date = nullif(payload ->> 'completedDate', '')::date, notes = payload ->> 'notes', updated_by = actor, updated_at = now()
    where target.id = visit and
      (target.visit_type_id, target.status, target.ticket_reference, target.contractor_id, target.scheduled_date, target.completed_date, target.notes)
      is distinct from
      (visit_type, (payload ->> 'status')::public.service_visit_status, nullif(payload ->> 'ticketReference', ''), contractor, (payload ->> 'scheduledDate')::date, nullif(payload ->> 'completedDate', '')::date, payload ->> 'notes');
  end if;

  delete from public.service_visit_component_changes existing
  where existing.service_visit_id = visit and not exists (
    select 1 from jsonb_array_elements(coalesce(payload -> 'componentChanges', '[]'::jsonb)) requested
    where nullif(requested ->> 'componentId', '')::uuid = existing.installation_component_id
      and requested ->> 'action' = existing.action
  );
  for component_change in select * from jsonb_array_elements(coalesce(payload -> 'componentChanges', '[]'::jsonb)) loop
    component_id := nullif(component_change ->> 'componentId', '')::uuid;
    if exists(select 1 from public.installation_components where id = component_id and installation_id = (payload ->> 'installationDbId')::uuid) then
      update public.service_visit_component_changes existing set notes = component_change ->> 'summary'
      where existing.service_visit_id = visit and existing.installation_component_id = component_id and existing.action = component_change ->> 'action'
        and existing.notes is distinct from component_change ->> 'summary';
      if not found then
        insert into public.service_visit_component_changes(service_visit_id, installation_component_id, action, notes, created_by)
        select visit, component_id, component_change ->> 'action', component_change ->> 'summary', actor
        where not exists (
          select 1 from public.service_visit_component_changes existing
          where existing.service_visit_id = visit and existing.installation_component_id = component_id and existing.action = component_change ->> 'action'
        );
      end if;
      if component_change ->> 'action' = 'installed' then
        update public.installation_components set installed_via_visit_id = visit where id = component_id and installed_via_visit_id is distinct from visit;
      elsif component_change ->> 'action' = 'removed' then
        update public.installation_components set removed_via_visit_id = visit where id = component_id and removed_via_visit_id is distinct from visit;
      end if;
    end if;
  end loop;
  return visit;
end;
$$;
