alter table public.installations
  alter column install_date drop not null;

do $$
declare
  definition text;
  updated text;
begin
  select pg_get_functiondef('public.save_installation(jsonb)'::regprocedure) into definition;
  updated := replace(definition, '(payload ->> ''installDate'')::date', 'nullif(payload ->> ''installDate'', '''')::date');
  if updated = definition then
    raise exception 'Unable to update save_installation for optional config date';
  end if;
  execute updated;
end $$;
