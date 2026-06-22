create table public.school_directory_uploads (
  id uuid primary key default gen_random_uuid(),
  filename text not null,
  total_rows integer not null default 0,
  complete_rows integer not null default 0,
  partial_rows integer not null default 0,
  skipped_rows integer not null default 0,
  uploaded_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

create table public.school_directory_entries (
  id uuid primary key default gen_random_uuid(),
  upload_id uuid not null references public.school_directory_uploads(id) on delete cascade,
  school_id text,
  school_name text not null,
  island_group text,
  region_name text,
  region_code text,
  province_name text,
  province_code text,
  municipality_name text,
  municipality_code text,
  barangay_name text,
  barangay_code text,
  source_row integer not null,
  validation_warning text,
  created_at timestamptz not null default now()
);

create index school_directory_name_idx on public.school_directory_entries(lower(school_name));
create index school_directory_school_id_idx on public.school_directory_entries(lower(school_id));

alter table public.school_directory_uploads enable row level security;
alter table public.school_directory_entries enable row level security;

create policy "active users read school directory uploads" on public.school_directory_uploads
for select using (public.current_user_is_active());
create policy "admins manage school directory uploads" on public.school_directory_uploads
for all using (public.current_user_is_admin()) with check (public.current_user_is_admin());
create policy "active users read school directory entries" on public.school_directory_entries
for select using (public.current_user_is_active());
create policy "admins manage school directory entries" on public.school_directory_entries
for all using (public.current_user_is_admin()) with check (public.current_user_is_admin());

create or replace function public.replace_school_directory(
  source_filename text,
  rows jsonb,
  total_count integer,
  complete_count integer,
  partial_count integer,
  skipped_count integer
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  upload uuid;
begin
  if not public.current_user_is_admin() then raise exception 'Administrator access required'; end if;
  if nullif(trim(source_filename), '') is null then raise exception 'Filename is required'; end if;
  if jsonb_typeof(rows) <> 'array' then raise exception 'Directory rows must be an array'; end if;

  delete from public.school_directory_uploads;
  insert into public.school_directory_uploads(filename, total_rows, complete_rows, partial_rows, skipped_rows, uploaded_by)
  values (source_filename, total_count, complete_count, partial_count, skipped_count, auth.uid())
  returning id into upload;

  insert into public.school_directory_entries(
    upload_id, school_id, school_name, island_group, region_name, region_code,
    province_name, province_code, municipality_name, municipality_code,
    barangay_name, barangay_code, source_row, validation_warning
  )
  select
    upload,
    nullif(trim(item ->> 'schoolId'), ''),
    trim(item ->> 'schoolName'),
    nullif(trim(item ->> 'islandGroup'), ''),
    nullif(trim(item ->> 'region'), ''),
    nullif(trim(item ->> 'regionCode'), ''),
    nullif(trim(item ->> 'province'), ''),
    nullif(trim(item ->> 'provinceCode'), ''),
    nullif(trim(item ->> 'municipality'), ''),
    nullif(trim(item ->> 'municipalityCode'), ''),
    nullif(trim(item ->> 'barangay'), ''),
    nullif(trim(item ->> 'barangayCode'), ''),
    (item ->> 'sourceRow')::integer,
    nullif(trim(item ->> 'warning'), '')
  from jsonb_array_elements(rows) item
  where nullif(trim(item ->> 'schoolName'), '') is not null;

  return upload;
end;
$$;

grant execute on function public.replace_school_directory(text,jsonb,integer,integer,integer,integer) to authenticated;
