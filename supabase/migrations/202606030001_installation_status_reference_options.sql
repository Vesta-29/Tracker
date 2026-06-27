create table public.installation_status_options (
  id uuid primary key default gen_random_uuid(),
  value public.installation_status not null unique,
  name text not null unique,
  active boolean not null default true,
  display_order integer not null default 0,
  color text not null default '#168399' check (color ~ '^#[0-9A-Fa-f]{6}$')
);

insert into public.installation_status_options(value, name, active, display_order, color) values
  ('scheduled', 'Scheduled', true, 0, '#2f6fcb'),
  ('installed', 'Installed', true, 1, '#138a54'),
  ('issue', 'Issue', true, 2, '#b97812'),
  ('cancelled', 'Cancelled', true, 3, '#b85643')
on conflict (value) do update set
  name = excluded.name,
  active = excluded.active,
  display_order = excluded.display_order,
  color = excluded.color;

create trigger installation_status_options_audit after insert or update or delete on public.installation_status_options
for each row execute function public.audit_configuration_change();

alter table public.installation_status_options enable row level security;

create policy "active users read installation status options" on public.installation_status_options
for select using (public.current_user_is_active());

create policy "admins manage installation status options" on public.installation_status_options
for all using (public.current_user_is_admin()) with check (public.current_user_is_admin());
