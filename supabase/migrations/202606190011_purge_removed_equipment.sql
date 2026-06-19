delete from public.service_visit_component_changes change
using public.installation_components component
where change.installation_component_id = component.id
  and component.removed_at is not null;

delete from public.installation_components
where removed_at is not null;
