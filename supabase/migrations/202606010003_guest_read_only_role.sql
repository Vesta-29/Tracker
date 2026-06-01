alter type public.app_role add value if not exists 'guest';

create or replace function public.current_user_can_edit()
returns boolean language sql stable security definer set search_path = ''
as $$ select exists(select 1 from public.profiles where id = auth.uid() and active and role::text <> 'guest'); $$;

drop policy if exists "active users manage installations" on public.installations;
create policy "active users read installations" on public.installations for select using (public.current_user_is_active());
create policy "editors manage installations" on public.installations for all using (public.current_user_can_edit()) with check (public.current_user_can_edit());

drop policy if exists "active users manage components" on public.installation_components;
create policy "active users read components" on public.installation_components for select using (public.current_user_is_active());
create policy "editors manage components" on public.installation_components for all using (public.current_user_can_edit()) with check (public.current_user_can_edit());

drop policy if exists "active users manage photos" on public.installation_photos;
create policy "active users read installation photo records" on public.installation_photos for select using (public.current_user_is_active());
create policy "editors manage installation photo records" on public.installation_photos for all using (public.current_user_can_edit()) with check (public.current_user_can_edit());

drop policy if exists "active users manage import batches" on public.import_batches;
create policy "active users read import batches" on public.import_batches for select using (public.current_user_is_active());
create policy "editors manage import batches" on public.import_batches for all using (public.current_user_can_edit()) with check (public.current_user_can_edit());

drop policy if exists "active users manage installation custom values" on public.installation_custom_values;
create policy "active users read installation custom values" on public.installation_custom_values for select using (public.current_user_is_active());
create policy "editors manage installation custom values" on public.installation_custom_values for all using (public.current_user_can_edit()) with check (public.current_user_can_edit());

drop policy if exists "active users manage component values" on public.installation_component_values;
create policy "active users read component values" on public.installation_component_values for select using (public.current_user_is_active());
create policy "editors manage component values" on public.installation_component_values for all using (public.current_user_can_edit()) with check (public.current_user_can_edit());

drop policy if exists "active users manage legacy kit queue" on public.legacy_kit_reassignments;
create policy "active users read legacy kit queue" on public.legacy_kit_reassignments for select using (public.current_user_is_active());
create policy "editors manage legacy kit queue" on public.legacy_kit_reassignments for all using (public.current_user_can_edit()) with check (public.current_user_can_edit());

drop policy if exists "active users manage service visits" on public.service_visits;
create policy "active users read service visits" on public.service_visits for select using (public.current_user_is_active());
create policy "editors manage service visits" on public.service_visits for all using (public.current_user_can_edit()) with check (public.current_user_can_edit());

drop policy if exists "active users manage service visit photos" on public.service_visit_photos;
create policy "active users read service visit photo records" on public.service_visit_photos for select using (public.current_user_is_active());
create policy "editors manage service visit photo records" on public.service_visit_photos for all using (public.current_user_can_edit()) with check (public.current_user_can_edit());

drop policy if exists "active users manage service visit component changes" on public.service_visit_component_changes;
create policy "active users read service visit component changes" on public.service_visit_component_changes for select using (public.current_user_is_active());
create policy "editors manage service visit component changes" on public.service_visit_component_changes for all using (public.current_user_can_edit()) with check (public.current_user_can_edit());

drop policy if exists "active users upload installation photos" on storage.objects;
create policy "editors upload installation photos" on storage.objects for insert
with check (bucket_id = 'installation-photos' and public.current_user_can_edit());
drop policy if exists "active users update installation photos" on storage.objects;
create policy "editors update installation photos" on storage.objects for update
using (bucket_id = 'installation-photos' and public.current_user_can_edit())
with check (bucket_id = 'installation-photos' and public.current_user_can_edit());
drop policy if exists "active users delete installation photos" on storage.objects;
create policy "editors delete installation photos" on storage.objects for delete
using (bucket_id = 'installation-photos' and public.current_user_can_edit());

drop policy if exists "active users upload service visit photos" on storage.objects;
create policy "editors upload service visit photos" on storage.objects for insert
with check (bucket_id = 'service-visit-photos' and public.current_user_can_edit());
drop policy if exists "active users update service visit photos" on storage.objects;
create policy "editors update service visit photos" on storage.objects for update
using (bucket_id = 'service-visit-photos' and public.current_user_can_edit())
with check (bucket_id = 'service-visit-photos' and public.current_user_can_edit());
drop policy if exists "active users delete service visit photos" on storage.objects;
create policy "editors delete service visit photos" on storage.objects for delete
using (bucket_id = 'service-visit-photos' and public.current_user_can_edit());

do $$
declare
  definition text;
  guarded text;
begin
  select pg_get_functiondef('public.save_installation(jsonb)'::regprocedure) into definition;
  guarded := replace(definition, 'if not public.current_user_is_active() then raise exception ''Inactive user''; end if;', 'if not public.current_user_can_edit() then raise exception ''Editor access required''; end if;');
  if guarded = definition then raise exception 'Unable to guard save_installation'; end if;
  execute guarded;

  select pg_get_functiondef('public.save_service_visit(jsonb,jsonb)'::regprocedure) into definition;
  guarded := replace(definition, 'if not public.current_user_is_active() then raise exception ''Inactive user''; end if;', 'if not public.current_user_can_edit() then raise exception ''Editor access required''; end if;');
  if guarded = definition then raise exception 'Unable to guard save_service_visit'; end if;
  execute guarded;

  select pg_get_functiondef('public.save_installation_batch(jsonb,text)'::regprocedure) into definition;
  guarded := replace(definition, 'if not public.current_user_is_active() then raise exception ''Inactive user''; end if;', 'if not public.current_user_can_edit() then raise exception ''Editor access required''; end if;');
  if guarded = definition then raise exception 'Unable to guard save_installation_batch'; end if;
  execute guarded;
end;
$$;
