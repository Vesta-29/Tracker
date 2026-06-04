create or replace function public.delete_installation_status_permanently(target_status_id uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  target_value text;
  replacement_default text;
begin
  if not public.current_user_is_admin() then
    raise exception 'Only admins may permanently delete site statuses';
  end if;

  select value into target_value
  from public.installation_status_options
  where id = target_status_id;

  if target_value is null then
    raise exception 'Site status was not found';
  end if;

  if exists(select 1 from public.installations where status = target_value) then
    raise exception 'Site status is used by installation records. Deactivate it to preserve historical references.';
  end if;

  if target_value = 'scheduled' then
    select value into replacement_default
    from public.installation_status_options
    where id <> target_status_id
    order by display_order, name
    limit 1;

    if replacement_default is null then
      raise exception 'Create another site status before deleting the default status.';
    end if;

    execute format('alter table public.installations alter column status set default %L', replacement_default);
  end if;

  delete from public.installation_status_options
  where id = target_status_id;
end;
$$;
