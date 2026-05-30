create extension if not exists "pgcrypto";

create type public.app_role as enum ('admin', 'staff');
create type public.installation_status as enum ('scheduled', 'installed', 'issue', 'cancelled');
create type public.location_level as enum ('region', 'province', 'municipality', 'barangay');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  email text not null,
  role public.app_role not null default 'staff',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.contractors (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  code text unique,
  contact_details text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.unit_types (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  active boolean not null default true
);

create table public.component_types (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  active boolean not null default true
);

create table public.locations (
  psgc_code text primary key,
  level public.location_level not null,
  name text not null,
  parent_code text references public.locations(psgc_code),
  active boolean not null default true
);

create table public.import_batches (
  id uuid primary key default gen_random_uuid(),
  filename text not null,
  status text not null check (status in ('previewed', 'completed', 'failed')),
  total_rows integer not null default 0,
  valid_rows integer not null default 0,
  invalid_rows integer not null default 0,
  uploaded_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

create table public.installations (
  id uuid primary key default gen_random_uuid(),
  display_id text not null unique,
  kit_number text not null,
  unit_type_id uuid not null references public.unit_types(id),
  contractor_id uuid not null references public.contractors(id),
  install_date date not null,
  status public.installation_status not null default 'scheduled',
  region_code text not null references public.locations(psgc_code),
  province_code text references public.locations(psgc_code),
  municipality_code text not null references public.locations(psgc_code),
  barangay_code text not null references public.locations(psgc_code),
  address text,
  remarks text,
  duplicate_kit_acknowledged boolean not null default false,
  import_batch_id uuid references public.import_batches(id),
  created_by uuid not null references public.profiles(id),
  updated_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.installation_components (
  id uuid primary key default gen_random_uuid(),
  installation_id uuid not null references public.installations(id) on delete cascade,
  component_type_id uuid not null references public.component_types(id),
  serial_number text not null,
  notes text,
  created_at timestamptz not null default now()
);

create table public.installation_photos (
  id uuid primary key default gen_random_uuid(),
  installation_id uuid not null references public.installations(id) on delete cascade,
  storage_path text not null unique,
  caption text,
  uploaded_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

create table public.audit_events (
  id bigint generated always as identity primary key,
  entity_type text not null,
  entity_id uuid not null,
  action text not null,
  actor_id uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create index installations_install_date_idx on public.installations(install_date desc);
create index installations_status_idx on public.installations(status);
create index installations_contractor_idx on public.installations(contractor_id);
create index installations_region_idx on public.installations(region_code);
create index installations_barangay_idx on public.installations(barangay_code);
create index installations_kit_number_idx on public.installations(lower(kit_number));
create index installation_components_installation_idx on public.installation_components(installation_id);
create index installation_components_serial_idx on public.installation_components(lower(serial_number));
create index locations_parent_idx on public.locations(parent_code);

create or replace function public.current_user_is_admin()
returns boolean language sql stable security definer set search_path = ''
as $$ select exists(select 1 from public.profiles where id = auth.uid() and active and role = 'admin'); $$;

create or replace function public.current_user_is_active()
returns boolean language sql stable security definer set search_path = ''
as $$ select exists(select 1 from public.profiles where id = auth.uid() and active); $$;

create or replace function public.audit_installation_change()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.audit_events(entity_type, entity_id, action, actor_id)
  values ('installation', coalesce(new.id, old.id), lower(tg_op), auth.uid());
  return coalesce(new, old);
end;
$$;

create trigger installations_audit after insert or update or delete on public.installations
for each row execute function public.audit_installation_change();

alter table public.profiles enable row level security;
alter table public.contractors enable row level security;
alter table public.unit_types enable row level security;
alter table public.component_types enable row level security;
alter table public.locations enable row level security;
alter table public.installations enable row level security;
alter table public.installation_components enable row level security;
alter table public.installation_photos enable row level security;
alter table public.import_batches enable row level security;
alter table public.audit_events enable row level security;

create policy "active users read profiles" on public.profiles for select using (public.current_user_is_active());
create policy "admins manage profiles" on public.profiles for all using (public.current_user_is_admin()) with check (public.current_user_is_admin());
create policy "active users read contractors" on public.contractors for select using (public.current_user_is_active());
create policy "admins manage contractors" on public.contractors for all using (public.current_user_is_admin()) with check (public.current_user_is_admin());
create policy "active users read unit types" on public.unit_types for select using (public.current_user_is_active());
create policy "admins manage unit types" on public.unit_types for all using (public.current_user_is_admin()) with check (public.current_user_is_admin());
create policy "active users read component types" on public.component_types for select using (public.current_user_is_active());
create policy "admins manage component types" on public.component_types for all using (public.current_user_is_admin()) with check (public.current_user_is_admin());
create policy "active users read locations" on public.locations for select using (public.current_user_is_active());
create policy "active users manage installations" on public.installations for all using (public.current_user_is_active()) with check (public.current_user_is_active());
create policy "active users manage components" on public.installation_components for all using (public.current_user_is_active()) with check (public.current_user_is_active());
create policy "active users manage photos" on public.installation_photos for all using (public.current_user_is_active()) with check (public.current_user_is_active());
create policy "active users manage import batches" on public.import_batches for all using (public.current_user_is_active()) with check (public.current_user_is_active());
create policy "admins read audit events" on public.audit_events for select using (public.current_user_is_admin());

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('installation-photos', 'installation-photos', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create policy "active users read installation photos" on storage.objects for select
using (bucket_id = 'installation-photos' and public.current_user_is_active());
create policy "active users upload installation photos" on storage.objects for insert
with check (bucket_id = 'installation-photos' and public.current_user_is_active());
