create type public.service_visit_status as enum ('scheduled', 'in_progress', 'completed', 'cancelled');

create table public.service_visit_types (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.service_visit_types(name) values
  ('Maintenance'),
  ('Repair'),
  ('Inspection'),
  ('Equipment replacement'),
  ('Other')
on conflict(name) do nothing;

create table public.service_visits (
  id uuid primary key default gen_random_uuid(),
  display_id text not null unique,
  installation_id uuid not null references public.installations(id) on delete cascade,
  visit_type_id uuid not null references public.service_visit_types(id),
  status public.service_visit_status not null default 'scheduled',
  ticket_reference text,
  contractor_id uuid not null references public.contractors(id),
  scheduled_date date not null,
  completed_date date,
  notes text,
  created_by uuid not null references public.profiles(id),
  updated_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.service_visit_photos (
  id uuid primary key default gen_random_uuid(),
  service_visit_id uuid not null references public.service_visits(id) on delete cascade,
  storage_path text not null unique,
  caption text,
  uploaded_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

alter table public.installation_components
  add column installed_at timestamptz not null default now(),
  add column removed_at timestamptz,
  add column installed_via_visit_id uuid references public.service_visits(id),
  add column removed_via_visit_id uuid references public.service_visits(id);

create table public.service_visit_component_changes (
  id uuid primary key default gen_random_uuid(),
  service_visit_id uuid not null references public.service_visits(id) on delete cascade,
  installation_component_id uuid not null references public.installation_components(id),
  action text not null check(action in ('installed', 'removed')),
  notes text,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

alter table public.audit_events
  add column installation_id uuid references public.installations(id) on delete cascade,
  add column before_data jsonb,
  add column after_data jsonb,
  add column changed_fields jsonb not null default '[]'::jsonb;

create index service_visits_installation_idx on public.service_visits(installation_id, scheduled_date desc);
create index service_visits_status_idx on public.service_visits(status);
create index service_visits_type_idx on public.service_visits(visit_type_id);
create index service_visits_contractor_idx on public.service_visits(contractor_id);
create index service_visits_ticket_idx on public.service_visits(lower(ticket_reference));
create index installation_components_active_idx on public.installation_components(installation_id) where removed_at is null;
create index audit_events_installation_idx on public.audit_events(installation_id, created_at desc);

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
  where before_payload -> key is distinct from after_payload -> key;

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
    select component.installation_id into installation
    from public.installation_components component
    where component.id = entity;
  elsif tg_table_name = 'service_visit_photos' then
    entity := coalesce(new.id, old.id);
    select visit.installation_id into installation
    from public.service_visits visit
    where visit.id = coalesce(new.service_visit_id, old.service_visit_id);
  elsif tg_table_name = 'service_visit_component_changes' then
    entity := coalesce(new.id, old.id);
    select visit.installation_id into installation
    from public.service_visits visit
    where visit.id = coalesce(new.service_visit_id, old.service_visit_id);
  end if;

  select coalesce(jsonb_agg(key order by key), '[]'::jsonb) into changed
  from jsonb_object_keys(coalesce(before_payload, '{}'::jsonb) || coalesce(after_payload, '{}'::jsonb)) as keys(key)
  where before_payload -> key is distinct from after_payload -> key;

  insert into public.audit_events(entity_type, entity_id, installation_id, action, actor_id, before_data, after_data, changed_fields)
  values (tg_table_name, entity, installation, lower(tg_op), auth.uid(), before_payload, after_payload, changed);
  return coalesce(new, old);
end;
$$;

create trigger installation_components_audit after insert or update or delete on public.installation_components
for each row execute function public.audit_installation_child_change();
create trigger installation_component_values_audit after insert or update or delete on public.installation_component_values
for each row execute function public.audit_installation_child_change();
create trigger installation_custom_values_audit after insert or update or delete on public.installation_custom_values
for each row execute function public.audit_installation_child_change();
create trigger installation_photos_audit after insert or update or delete on public.installation_photos
for each row execute function public.audit_installation_child_change();
create trigger service_visits_audit after insert or update or delete on public.service_visits
for each row execute function public.audit_installation_child_change();
create trigger service_visit_photos_audit after insert or update or delete on public.service_visit_photos
for each row execute function public.audit_installation_child_change();
create trigger service_visit_component_changes_audit after insert or update or delete on public.service_visit_component_changes
for each row execute function public.audit_installation_child_change();
create trigger service_visit_types_audit after insert or update or delete on public.service_visit_types
for each row execute function public.audit_configuration_change();

alter table public.service_visit_types enable row level security;
alter table public.service_visits enable row level security;
alter table public.service_visit_photos enable row level security;
alter table public.service_visit_component_changes enable row level security;

create policy "active users read service visit types" on public.service_visit_types
  for select using (public.current_user_is_active());
create policy "admins manage service visit types" on public.service_visit_types
  for all using (public.current_user_is_admin()) with check (public.current_user_is_admin());
create policy "active users manage service visits" on public.service_visits
  for all using (public.current_user_is_active()) with check (public.current_user_is_active());
create policy "active users manage service visit photos" on public.service_visit_photos
  for all using (public.current_user_is_active()) with check (public.current_user_is_active());
create policy "active users manage service visit component changes" on public.service_visit_component_changes
  for all using (public.current_user_is_active()) with check (public.current_user_is_active());
create policy "active users read installation audit events" on public.audit_events
  for select using (installation_id is not null and public.current_user_is_active());
