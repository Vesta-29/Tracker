alter table public.installation_components
  add column mac_address text,
  add column duplicate_mac_acknowledged boolean not null default false,
  add constraint installation_components_mac_format
    check (mac_address is null or mac_address ~ '^[0-9A-F]{2}(:[0-9A-F]{2}){5}$');

create index installation_components_mac_idx
  on public.installation_components(lower(mac_address))
  where mac_address is not null;

create type public.custom_field_type as enum ('text', 'number', 'date', 'dropdown');

create table public.custom_field_definitions (
  id uuid primary key default gen_random_uuid(),
  label text not null,
  field_type public.custom_field_type not null,
  required boolean not null default false,
  display_order integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.custom_field_options (
  id uuid primary key default gen_random_uuid(),
  field_id uuid not null references public.custom_field_definitions(id) on delete cascade,
  name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique(field_id, name)
);

create table public.installation_custom_values (
  installation_id uuid not null references public.installations(id) on delete cascade,
  field_id uuid not null references public.custom_field_definitions(id),
  value text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key(installation_id, field_id)
);

create index custom_field_options_field_idx on public.custom_field_options(field_id);
create index installation_custom_values_installation_idx on public.installation_custom_values(installation_id);

create or replace function public.audit_configuration_change()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.audit_events(entity_type, entity_id, action, actor_id)
  values (tg_table_name, coalesce(new.id, old.id), lower(tg_op), auth.uid());
  return coalesce(new, old);
end;
$$;

create trigger contractors_audit after insert or update or delete on public.contractors
for each row execute function public.audit_configuration_change();
create trigger unit_types_audit after insert or update or delete on public.unit_types
for each row execute function public.audit_configuration_change();
create trigger component_types_audit after insert or update or delete on public.component_types
for each row execute function public.audit_configuration_change();
create trigger custom_field_definitions_audit after insert or update or delete on public.custom_field_definitions
for each row execute function public.audit_configuration_change();
create trigger custom_field_options_audit after insert or update or delete on public.custom_field_options
for each row execute function public.audit_configuration_change();

alter table public.custom_field_definitions enable row level security;
alter table public.custom_field_options enable row level security;
alter table public.installation_custom_values enable row level security;

create policy "active users read custom field definitions" on public.custom_field_definitions
  for select using (public.current_user_is_active());
create policy "admins manage custom field definitions" on public.custom_field_definitions
  for all using (public.current_user_is_admin()) with check (public.current_user_is_admin());
create policy "active users read custom field options" on public.custom_field_options
  for select using (public.current_user_is_active());
create policy "admins manage custom field options" on public.custom_field_options
  for all using (public.current_user_is_admin()) with check (public.current_user_is_admin());
create policy "active users manage installation custom values" on public.installation_custom_values
  for all using (public.current_user_is_active()) with check (public.current_user_is_active());
