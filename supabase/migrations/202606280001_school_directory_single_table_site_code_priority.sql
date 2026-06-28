alter table public.school_directory_entries
add column if not exists site_code text,
add column if not exists priority_tag text;

create index if not exists school_directory_site_code_idx on public.school_directory_entries(lower(site_code));
create index if not exists school_directory_priority_idx on public.school_directory_entries(priority_tag);

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

  delete from public.school_directory_uploads where id is not null;
  insert into public.school_directory_uploads(filename, total_rows, complete_rows, partial_rows, skipped_rows, uploaded_by)
  values (source_filename, total_count, complete_count, partial_count, skipped_count, auth.uid())
  returning id into upload;

  insert into public.school_directory_entries(
    upload_id, school_id, site_code, school_name, island_group, region_name, region_code,
    province_name, province_code, municipality_name, municipality_code,
    barangay_name, barangay_code, priority_tag, source_row, validation_warning
  )
  select
    upload,
    nullif(trim(item ->> 'schoolId'), ''),
    nullif(trim(item ->> 'siteCode'), ''),
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
    nullif(trim(item ->> 'priority'), ''),
    (item ->> 'sourceRow')::integer,
    nullif(trim(item ->> 'warning'), '')
  from jsonb_array_elements(rows) item
  where nullif(trim(item ->> 'schoolName'), '') is not null;

  return upload;
end;
$$;

grant execute on function public.replace_school_directory(text,jsonb,integer,integer,integer,integer) to authenticated;
