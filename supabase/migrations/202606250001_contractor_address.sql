alter table public.installations
  add column if not exists contractor_address text;

do $$
declare
  definition text;
  updated text;
begin
  select pg_get_functiondef('public.save_installation(jsonb)'::regprocedure) into definition;
  updated := definition;
  updated := replace(updated, 'longitude_value numeric;', 'contractor_address_value text;
  longitude_value numeric;');
  updated := replace(updated, 'latitude_value := nullif(payload ->> ''latitude'', '''')::numeric;', 'contractor_address_value := nullif(payload ->> ''contractorAddress'', '''');
  latitude_value := nullif(payload ->> ''latitude'', '''')::numeric;');
  updated := replace(updated, 'barangay_code, longitude, latitude', 'barangay_code, contractor_address, longitude, latitude');
  updated := replace(updated, 'nullif(payload ->> ''barangayCode'', ''''), longitude_value, latitude_value', 'nullif(payload ->> ''barangayCode'', ''''), contractor_address_value, longitude_value, latitude_value');
  updated := replace(updated, 'barangay_code = nullif(payload ->> ''barangayCode'', ''''), longitude = longitude_value', 'barangay_code = nullif(payload ->> ''barangayCode'', ''''), contractor_address = contractor_address_value, longitude = longitude_value');
  updated := replace(updated, 'target.barangay_code, target.longitude, target.latitude', 'target.barangay_code, target.contractor_address, target.longitude, target.latitude');
  updated := replace(updated, 'nullif(payload ->> ''barangayCode'', ''''), longitude_value, latitude_value', 'nullif(payload ->> ''barangayCode'', ''''), contractor_address_value, longitude_value, latitude_value');
  if updated = definition then
    raise exception 'Unable to update save_installation for contractor_address';
  end if;
  execute updated;
end $$;
