alter table public.installation_status_options
  add column if not exists color text;

update public.installation_status_options
set color = case value
  when 'scheduled' then '#2f6fcb'
  when 'installed' then '#138a54'
  when 'issue' then '#b97812'
  when 'cancelled' then '#b85643'
  else coalesce(color, '#168399')
end
where color is null;

alter table public.installation_status_options
  alter column color set default '#168399';

alter table public.installation_status_options
  alter column color set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'installation_status_options_color_hex'
      and conrelid = 'public.installation_status_options'::regclass
  ) then
    alter table public.installation_status_options
      add constraint installation_status_options_color_hex
      check (color ~ '^#[0-9A-Fa-f]{6}$');
  end if;
end $$;
