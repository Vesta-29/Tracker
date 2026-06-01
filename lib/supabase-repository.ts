/* eslint-disable @typescript-eslint/no-explicit-any */
import { getSupabaseBrowser } from "@/lib/supabase-browser";
import { getIslandGroup } from "@/lib/location-groups";
import type { AuditEvent, Component, Installation, Profile, ReferenceData, ServiceVisit } from "@/lib/types";

const supabase = () => getSupabaseBrowser();
const value = <T>(row: T | T[] | null | undefined) => Array.isArray(row) ? row[0] : row;
export type LocationOption = { code: string; name: string };
const locationOptionsCache = new Map<string, LocationOption[]>();
let cachedUsers: Profile[] | undefined;
let cachedUsersAt = 0;
let usersRequest: Promise<Profile[]> | undefined;
const usersCacheMs = 60_000;
function invalidRefreshToken(error: unknown) { return typeof error === "object" && error !== null && "code" in error && (error.code === "refresh_token_not_found" || error.code === "refresh_token_already_used"); }
export async function clearInvalidSession(error: unknown) {
  if (!invalidRefreshToken(error)) return false;
  await supabase().auth.signOut({ scope: "local" }).catch(() => undefined);
  return true;
}

export async function listLocationOptions(level: "region" | "province" | "municipality" | "barangay", parentCode?: string) {
  const key = `${level}:${parentCode ?? "root"}`;
  const cached = locationOptionsCache.get(key);
  if (cached) return cached;
  let query = supabase().from("locations").select("psgc_code,name").eq("level", level).eq("active", true).order("name");
  query = parentCode ? query.eq("parent_code", parentCode) : query.is("parent_code", null);
  const { data, error } = await query;
  if (error) throw error;
  const options = data.map((row) => ({ code: row.psgc_code, name: row.name }));
  locationOptionsCache.set(key, options);
  return options;
}

async function signedPhotos(bucket: string, rows: { storage_path: string; caption?: string | null }[] = []) {
  return Promise.all(rows.map(async (row) => {
    const { data } = await supabase().storage.from(bucket).createSignedUrl(row.storage_path, 3600);
    return { name: row.caption || row.storage_path.split("/").at(-1) || "Photo", url: data?.signedUrl || "" };
  }));
}

export async function signIn(email: string, password: string) {
  const { error } = await supabase().auth.signInWithPassword({ email, password });
  if (error) throw error;
}
export async function signOut() { cachedUsers = undefined; cachedUsersAt = 0; await supabase().auth.signOut({ scope: "local" }); }
export async function currentSession() {
  const { data, error } = await supabase().auth.getSession();
  if (error) { if (await clearInvalidSession(error)) return null; throw error; }
  return data.session;
}
export async function consumeAuthCallback() {
  const query = new URLSearchParams(window.location.search);
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const type = query.get("type") || hash.get("type");
  const code = query.get("code");
  const tokenHash = query.get("token_hash");
  const accessToken = hash.get("access_token");
  const refreshToken = hash.get("refresh_token");
  if (code) {
    const { error } = await supabase().auth.exchangeCodeForSession(code);
    if (error) throw error;
  } else if (tokenHash && (type === "invite" || type === "recovery")) {
    const { error } = await supabase().auth.verifyOtp({ token_hash: tokenHash, type });
    if (error) throw error;
  } else if (accessToken && refreshToken) {
    const { error } = await supabase().auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
    if (error) throw error;
  }
  const passwordSetup = type === "invite" || type === "recovery";
  if (passwordSetup && !(await currentSession())) throw new Error("This password setup link is invalid or expired. Request a new password setup email.");
  if (code || tokenHash || window.location.hash) window.history.replaceState({}, document.title, window.location.pathname);
  return passwordSetup;
}
export async function setPassword(password: string) {
  const { error } = await supabase().auth.updateUser({ password });
  if (error) throw error;
}
export async function changePassword(currentPassword: string, password: string) {
  const { error } = await supabase().auth.updateUser({ current_password: currentPassword, password });
  if (error) throw error;
}
export async function requestPasswordReset(email: string) {
  const { error } = await supabase().auth.resetPasswordForEmail(email, { redirectTo: window.location.origin });
  if (error) throw error;
}

export async function loadProfile(): Promise<Profile> {
  const { data: { user } } = await supabase().auth.getUser();
  if (!user) throw new Error("Sign in to continue.");
  const { data, error } = await supabase().from("profiles").select("id,full_name,email,role,active").eq("id", user.id).single();
  if (error) throw error;
  if (!data.active) throw new Error("Your FieldTrack account is inactive. Ask an administrator to restore access.");
  return { id: data.id, fullName: data.full_name, email: data.email, role: data.role, active: data.active };
}

export async function loadReferences(): Promise<ReferenceData> {
  const client = supabase();
  const [contractors, unitTypes, componentTypes, equipmentFields, customFields, serviceVisitTypes] = await Promise.all([
    client.from("contractors").select("id,name,active,display_order").order("display_order").order("name"),
    client.from("unit_types").select("id,name,active,display_order").order("display_order").order("name"),
    client.from("component_types").select("id,name,active,display_order,component_field_definitions(id,library_field_id,required,active,display_order)").order("display_order").order("name"),
    client.from("equipment_field_library").select("id,label,field_type,active").order("label"),
    client.from("custom_field_definitions").select("id,label,field_type,required,active,display_order,custom_field_options(id,name,active)").order("display_order"),
    client.from("service_visit_types").select("id,name,active,display_order").order("display_order").order("name"),
  ]);
  for (const result of [contractors, unitTypes, componentTypes, equipmentFields, customFields, serviceVisitTypes]) if (result.error) throw result.error;
  return {
    contractors: contractors.data!.map((row) => ({ id: row.id, name: row.name, active: row.active, order: row.display_order })),
    unitTypes: unitTypes.data!.map((row) => ({ id: row.id, name: row.name, active: row.active, order: row.display_order })),
    componentTypes: componentTypes.data!.map((row) => ({ id: row.id, name: row.name, active: row.active, order: row.display_order, fields: row.component_field_definitions.map((field) => ({ id: field.id, libraryFieldId: field.library_field_id, required: field.required, active: field.active, order: field.display_order })) })),
    equipmentFields: equipmentFields.data!.map((row) => ({ id: row.id, label: row.label, type: row.field_type, active: row.active })),
    customFields: customFields.data!.map((row) => ({ id: row.id, label: row.label, type: row.field_type, required: row.required, active: row.active, order: row.display_order, options: row.custom_field_options })),
    serviceVisitTypes: serviceVisitTypes.data!.map((row) => ({ id: row.id, name: row.name, active: row.active, order: row.display_order })),
  };
}

function mapAudit(row: any): AuditEvent {
  const actor = value(row.actor)?.full_name || "System";
  const entity = ({ installation: "site record", installation_components: "equipment", installation_component_values: "equipment value", installation_custom_values: "custom field value", installation_photos: "site photo", service_visits: "service visit", service_visit_photos: "service visit photo", service_visit_component_changes: "service visit equipment change" } as Record<string, string>)[row.entity_type] || row.entity_type.replaceAll("_", " ");
  const action = ({ insert: "added", update: "updated", delete: "removed" } as Record<string, string>)[row.action] || row.action;
  return { id: String(row.id), action: row.action, actor, createdAt: row.created_at, summary: `${actor} ${action} ${entity}.`, beforeData: row.before_data, afterData: row.after_data, changedFields: row.changed_fields || [] };
}
function mapComponent(row: any): Component {
  return { id: row.id, type: value(row.type)?.name || "", notes: row.notes || "", installedAt: row.installed_at, removedAt: row.removed_at, installedViaVisitId: row.installed_via_visit_id, removedViaVisitId: row.removed_via_visit_id, values: Object.fromEntries((row.installation_component_values || []).map((item: any) => [item.field_definition_id, item.value])), duplicateMacAcknowledged: (row.installation_component_values || []).some((item: any) => item.duplicate_mac_acknowledged) };
}
async function mapVisit(row: any): Promise<ServiceVisit> {
  return { id: row.display_id, dbId: row.id, type: value(row.type)?.name || "", status: row.status, ticketReference: row.ticket_reference || "", contractor: value(row.contractor)?.name || "", scheduledDate: row.scheduled_date, completedDate: row.completed_date, notes: row.notes || "", photos: await signedPhotos("service-visit-photos", row.service_visit_photos), componentChanges: (row.service_visit_component_changes || []).map((change: any) => ({ id: change.id, action: change.action, componentId: change.installation_component_id, componentType: "", summary: change.notes || change.action })), createdBy: value(row.createdBy)?.full_name || "System", updatedBy: value(row.updatedBy)?.full_name || "System", createdAt: row.created_at, updatedAt: row.updated_at };
}
async function mapInstallation(row: any, locationNames: Map<string, string>): Promise<Installation> {
  const location = { islandGroup: getIslandGroup(row.region_code) || "", region: locationNames.get(row.region_code) || "", regionCode: row.region_code, province: locationNames.get(row.province_code) || "", provinceCode: row.province_code || "", municipality: locationNames.get(row.municipality_code) || "", municipalityCode: row.municipality_code, barangay: locationNames.get(row.barangay_code) || "", barangayCode: row.barangay_code };
  return { id: row.display_id, dbId: row.id, siteName: row.site_name || "", legacyKitNumber: row.kit_number || undefined, unitType: value(row.unitType)?.name || "", contractor: value(row.contractor)?.name || "", installDate: row.install_date, status: row.status, ...location, address: row.address || "", remarks: row.remarks || "", components: row.installation_components.map(mapComponent), customValues: Object.fromEntries(row.installation_custom_values.map((item: any) => [item.field_id, item.value])), photos: await signedPhotos("installation-photos", row.installation_photos), createdBy: value(row.createdBy)?.full_name || "System", createdAt: row.created_at, updatedBy: value(row.updatedBy)?.full_name || "System", updatedAt: row.updated_at, serviceVisits: await Promise.all(row.service_visits.map(mapVisit)), auditEvents: row.audit_events.map(mapAudit) };
}

export async function loadInstallations() {
  const { data, error } = await supabase().from("installations").select(`
    *, unitType:unit_types(name), contractor:contractors(name), createdBy:profiles!installations_created_by_fkey(full_name), updatedBy:profiles!installations_updated_by_fkey(full_name),
    installation_photos(storage_path,caption), installation_custom_values(field_id,value),
    installation_components(*,type:component_types(name),installation_component_values(field_definition_id,value,duplicate_mac_acknowledged)),
    service_visits(*,type:service_visit_types(name),contractor:contractors(name),createdBy:profiles!service_visits_created_by_fkey(full_name),updatedBy:profiles!service_visits_updated_by_fkey(full_name),service_visit_photos(storage_path,caption),service_visit_component_changes(*)),
    audit_events(*,actor:profiles!audit_events_actor_id_fkey(full_name))
  `).order("install_date", { ascending: false });
  if (error) throw error;
  const codes = [...new Set(data.flatMap((row) => [row.region_code, row.province_code, row.municipality_code, row.barangay_code]).filter(Boolean))];
  const { data: locations, error: locationError } = codes.length ? await supabase().from("locations").select("psgc_code,name").in("psgc_code", codes) : { data: [], error: null };
  if (locationError) throw locationError;
  const locationNames = new Map(locations.map((row) => [row.psgc_code, row.name]));
  return Promise.all(data.map((row) => mapInstallation(row, locationNames)));
}

export async function saveInstallation(record: Installation) {
  const { data, error } = await supabase().rpc("save_installation", { payload: record });
  if (error) throw error;
  await uploadPhotos("installation-photos", "installation_photos", "installation_id", data as string, record.photos);
  return data as string;
}
export async function saveInstallationBatch(filename: string, records: Installation[]) {
  const { error } = await supabase().rpc("save_installation_batch", { source_filename: filename, payload: records });
  if (error) throw error;
}
export async function saveVisit(installation: Installation, visit: ServiceVisit, components: Component[]) {
  const { data, error } = await supabase().rpc("save_service_visit", { payload: { ...visit, installationDbId: installation.dbId }, installation_payload: { ...installation, components } });
  if (error) throw error;
  await uploadPhotos("service-visit-photos", "service_visit_photos", "service_visit_id", data as string, visit.photos);
  return data as string;
}

async function uploadPhotos(bucket: string, table: string, ownerColumn: string, ownerId: string, photos: { name: string; url: string }[]) {
  const client = supabase();
  const { data: { user } } = await client.auth.getUser();
  if (!user) throw new Error("Sign in before uploading photos.");
  for (const photo of photos.filter((item) => item.url.startsWith("blob:"))) {
    const body = await (await fetch(photo.url)).blob();
    const path = `${ownerId}/${crypto.randomUUID()}-${photo.name.replace(/[^a-zA-Z0-9._-]/g, "-")}`;
    const { error: uploadError } = await client.storage.from(bucket).upload(path, body, { contentType: body.type });
    if (uploadError) throw uploadError;
    const { error } = await client.from(table).insert({ [ownerColumn]: ownerId, storage_path: path, caption: photo.name, uploaded_by: user.id });
    if (error) throw error;
  }
}

export async function persistReferences(refs: ReferenceData, previous?: ReferenceData) {
  const client = supabase();
  const save = async (table: string, rows: object[], onConflict = "id") => { if (!rows.length) return; const { error } = await client.from(table).upsert(rows, { onConflict }); if (error) throw error; };
  const changed = <K extends keyof ReferenceData>(key: K) => !previous || JSON.stringify(refs[key]) !== JSON.stringify(previous[key]);
  if (changed("contractors")) await save("contractors", refs.contractors.map(({ id, name, active, order }, index) => ({ id, name, active, display_order: order ?? index })));
  if (changed("unitTypes")) await save("unit_types", refs.unitTypes.map(({ id, name, active, order }, index) => ({ id, name, active, display_order: order ?? index })));
  if (changed("serviceVisitTypes")) await save("service_visit_types", refs.serviceVisitTypes.map(({ id, name, active, order }, index) => ({ id, name, active, display_order: order ?? index })));
  if (changed("componentTypes")) {
    await save("component_types", refs.componentTypes.map(({ id, name, active, order }, index) => ({ id, name, active, display_order: order ?? index })));
  }
  if (changed("equipmentFields")) await save("equipment_field_library", refs.equipmentFields.map(({ id, label, type, active }) => ({ id, label, field_type: type, active })));
  if (changed("componentTypes")) await save("component_field_definitions", refs.componentTypes.flatMap((type) => type.fields.map((field) => ({ id: field.id, component_type_id: type.id, library_field_id: field.libraryFieldId, required: field.required, active: field.active, display_order: field.order }))));
  if (changed("customFields")) {
    await save("custom_field_definitions", refs.customFields.map(({ id, label, type, required, active, order }) => ({ id, label, field_type: type, required, active, display_order: order })));
    await save("custom_field_options", refs.customFields.flatMap((field) => field.options.map((option) => ({ ...option, field_id: field.id }))));
  }
}

export async function deleteReferencePermanently(kind: "contractor" | "unitType" | "customField" | "componentType" | "equipmentField", id: string) {
  const functions = { contractor: "delete_contractor_permanently", unitType: "delete_unit_type_permanently", customField: "delete_custom_field_permanently", componentType: "delete_component_type_permanently", equipmentField: "delete_equipment_field_permanently" } as const;
  const args = { contractor: { target_contractor_id: id }, unitType: { target_unit_type_id: id }, customField: { target_field_id: id }, componentType: { target_component_type_id: id }, equipmentField: { target_library_field_id: id } } as const;
  const { error } = await supabase().rpc(functions[kind], args[kind]);
  if (error) throw error;
}

export async function loadWorkspace() {
  const [profile, refs, records] = await Promise.all([loadProfile(), loadReferences(), loadInstallations()]);
  return { profile, refs, records };
}

export function getCachedUsers() { return cachedUsers; }
export async function listUsers({ force = false }: { force?: boolean } = {}): Promise<Profile[]> {
  if (!force && cachedUsers && Date.now() - cachedUsersAt < usersCacheMs) return cachedUsers;
  if (usersRequest) return usersRequest;
  usersRequest = (async () => {
    const session = await currentSession(); const response = await fetch("/api/users", { headers: { Authorization: `Bearer ${session?.access_token}` } });
    const data = await response.json(); if (!response.ok) throw new Error(data.error);
    const profiles: Profile[] = data.map((row: any) => ({ id: row.id, fullName: row.full_name, email: row.email, role: row.role, active: row.active }));
    cachedUsers = profiles;
    cachedUsersAt = Date.now();
    return profiles;
  })();
  try { return await usersRequest; } finally { usersRequest = undefined; }
}
export async function prefetchUsers() { await listUsers().catch(() => undefined); }
export async function createUser(fullName: string, email: string) {
  const session = await currentSession(); const response = await fetch("/api/users", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token}` }, body: JSON.stringify({ fullName, email }) });
  const data = await response.json(); if (!response.ok) throw new Error(data.error); return data as { id: string; temporaryPassword: string };
}
export async function generateUserTemporaryPassword(id: string) {
  const session = await currentSession(); const response = await fetch("/api/users/password", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token}` }, body: JSON.stringify({ id }) });
  const data = await response.json(); if (!response.ok) throw new Error(data.error); return data as { temporaryPassword: string };
}
export async function updateUser(profile: Profile) {
  const session = await currentSession(); const response = await fetch("/api/users", { method: "PATCH", headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token}` }, body: JSON.stringify(profile) });
  const data = await response.json(); if (!response.ok) throw new Error(data.error);
}
export async function updateOwnProfile(fullName: string) {
  const session = await currentSession(); const response = await fetch("/api/profile", { method: "PATCH", headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token}` }, body: JSON.stringify({ fullName }) });
  const data = await response.json(); if (!response.ok) throw new Error(data.error); return data as { fullName: string };
}
