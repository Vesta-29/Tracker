/* eslint-disable @typescript-eslint/no-explicit-any */
import { getSupabaseBrowser } from "@/lib/supabase-browser";
import { getIslandGroup } from "@/lib/location-groups";
import type { AuditEvent, Component, Installation, Profile, ReferenceData, SchoolDirectoryEntry, SchoolDirectoryStatus, ServiceVisit, Status, StatusReferenceOption } from "@/lib/types";

const supabase = () => getSupabaseBrowser();
const value = <T>(row: T | T[] | null | undefined) => Array.isArray(row) ? row[0] : row;
export type LocationOption = { code: string; name: string };
const locationOptionsCache = new Map<string, LocationOption[]>();
let cachedProfile: Profile | undefined;
let cachedProfileAt = 0;
let profileRequest: Promise<Profile> | undefined;
let cachedReferences: ReferenceData | undefined;
let cachedReferencesAt = 0;
let referencesRequest: Promise<ReferenceData> | undefined;
let cachedUsers: Profile[] | undefined;
let cachedUsersAt = 0;
let usersRequest: Promise<Profile[]> | undefined;
const usersCacheMs = 60_000;
const operationalCacheMs = 60_000;
const defaultSiteStatuses: StatusReferenceOption[] = [
  { id: "status-scheduled", value: "scheduled", name: "Scheduled", active: true, order: 0 },
  { id: "status-installed", value: "installed", name: "Installed", active: true, order: 1 },
  { id: "status-issue", value: "issue", name: "Issue", active: true, order: 2 },
  { id: "status-cancelled", value: "cancelled", name: "Cancelled", active: true, order: 3 },
];
function invalidRefreshToken(error: unknown) { return typeof error === "object" && error !== null && "code" in error && (error.code === "refresh_token_not_found" || error.code === "refresh_token_already_used"); }
function missingStatusReferenceTable(error: unknown) {
  return typeof error === "object"
    && error !== null
    && "message" in error
    && String(error.message).includes("installation_status_options");
}
function missingDefaultComponentTypeColumn(error: unknown) {
  return typeof error === "object"
    && error !== null
    && "message" in error
    && String(error.message).includes("default_on_new_site");
}
function clearOperationalCaches() {
  cachedProfile = undefined; cachedProfileAt = 0; profileRequest = undefined;
  cachedReferences = undefined; cachedReferencesAt = 0; referencesRequest = undefined;
  cachedUsers = undefined; cachedUsersAt = 0;
}
export async function clearInvalidSession(error: unknown) {
  if (!invalidRefreshToken(error)) return false;
  clearOperationalCaches();
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

function mapSchoolDirectoryEntry(row: any): SchoolDirectoryEntry {
  return {
    id: row.id,
    schoolId: row.school_id || "",
    schoolName: row.school_name,
    islandGroup: row.island_group || "",
    region: row.region_name || "",
    regionCode: row.region_code || "",
    province: row.province_name || "",
    provinceCode: row.province_code || "",
    municipality: row.municipality_name || "",
    municipalityCode: row.municipality_code || "",
    barangay: row.barangay_name || "",
    barangayCode: row.barangay_code || "",
    sourceRow: row.source_row,
    warning: row.validation_warning || "",
  };
}

export async function searchSchoolDirectory(query: string) {
  const term = query.trim().replaceAll("%", "\\%").replaceAll("_", "\\_");
  if (term.length < 2) return [];
  const { data, error } = await supabase().from("school_directory_entries").select("id,school_id,school_name,island_group,region_name,region_code,province_name,province_code,municipality_name,municipality_code,barangay_name,barangay_code,source_row,validation_warning").ilike("school_name", `%${term}%`).order("school_name").limit(10);
  if (error) throw error;
  return data.map(mapSchoolDirectoryEntry);
}

export async function loadSchoolDirectoryStatus(): Promise<SchoolDirectoryStatus | null> {
  const { data, error } = await supabase().from("school_directory_uploads").select("filename,total_rows,complete_rows,partial_rows,skipped_rows,created_at,uploader:profiles!school_directory_uploads_uploaded_by_fkey(full_name)").order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return { filename: data.filename, totalRows: data.total_rows, completeRows: data.complete_rows, partialRows: data.partial_rows, skippedRows: data.skipped_rows, uploadedBy: value(data.uploader)?.full_name || "Administrator", uploadedAt: data.created_at };
}

export async function replaceSchoolDirectory(filename: string, rows: SchoolDirectoryEntry[], counts: { total: number; complete: number; partial: number; skipped: number }) {
  const { error } = await supabase().rpc("replace_school_directory", { source_filename: filename, rows, total_count: counts.total, complete_count: counts.complete, partial_count: counts.partial, skipped_count: counts.skipped });
  if (error) throw error;
}

async function signedPhotos(bucket: string, rows: { storage_path: string; caption?: string | null }[] = []) {
  if (!rows.length) return [];
  const { data } = await supabase().storage.from(bucket).createSignedUrls(rows.map((row) => row.storage_path), 3600);
  return rows.map((row, index) => ({ name: row.caption || row.storage_path.split("/").at(-1) || "Photo", url: data?.[index]?.signedUrl || "" }));
}

export async function signIn(email: string, password: string) {
  clearOperationalCaches();
  const { error } = await supabase().auth.signInWithPassword({ email, password });
  if (error) throw error;
  clearOperationalCaches();
}
export async function signOut() {
  clearOperationalCaches();
  await supabase().auth.signOut({ scope: "local" });
}
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
    clearOperationalCaches();
  } else if (tokenHash && (type === "invite" || type === "recovery")) {
    const { error } = await supabase().auth.verifyOtp({ token_hash: tokenHash, type });
    if (error) throw error;
    clearOperationalCaches();
  } else if (accessToken && refreshToken) {
    const { error } = await supabase().auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
    if (error) throw error;
    clearOperationalCaches();
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

export async function loadProfile({ force = false }: { force?: boolean } = {}): Promise<Profile> {
  if (!force && cachedProfile && Date.now() - cachedProfileAt < operationalCacheMs) return cachedProfile;
  if (profileRequest) return profileRequest;
  profileRequest = (async () => {
    const { data: { user } } = await supabase().auth.getUser();
    if (!user) throw new Error("Sign in to continue.");
    const { data, error } = await supabase().from("profiles").select("id,full_name,email,role,active").eq("id", user.id).single();
    if (error) throw error;
    if (!data.active) throw new Error("Your FieldTrack account is inactive. Ask an administrator to restore access.");
    cachedProfile = { id: data.id, fullName: data.full_name, email: data.email, role: data.role, active: data.active };
    cachedProfileAt = Date.now();
    return cachedProfile;
  })();
  try { return await profileRequest; } finally { profileRequest = undefined; }
}

export async function loadReferences({ force = false }: { force?: boolean } = {}): Promise<ReferenceData> {
  if (!force && cachedReferences && Date.now() - cachedReferencesAt < operationalCacheMs) return cachedReferences;
  if (referencesRequest) return referencesRequest;
  referencesRequest = (async () => {
    const client = supabase();
    const [siteStatuses, contractors, unitTypes, componentTypesWithDefault, equipmentFields, customFields, serviceVisitTypes] = await Promise.all([
      client.from("installation_status_options").select("id,value,name,active,display_order").order("display_order").order("name"),
      client.from("contractors").select("id,name,active,display_order").order("display_order").order("name"),
      client.from("unit_types").select("id,name,active,display_order").order("display_order").order("name"),
      client.from("component_types").select("id,name,active,display_order,default_on_new_site,component_field_definitions(id,library_field_id,required,active,display_order)").order("display_order").order("name"),
      client.from("equipment_field_library").select("id,label,field_type,active").order("label"),
      client.from("custom_field_definitions").select("id,label,field_type,required,active,display_order,custom_field_options(id,name,active)").order("display_order"),
      client.from("service_visit_types").select("id,name,active,display_order").order("display_order").order("name"),
    ]);
    const componentTypes = componentTypesWithDefault.error && missingDefaultComponentTypeColumn(componentTypesWithDefault.error)
      ? await client.from("component_types").select("id,name,active,display_order,component_field_definitions(id,library_field_id,required,active,display_order)").order("display_order").order("name")
      : componentTypesWithDefault;
    for (const result of [contractors, unitTypes, componentTypes, equipmentFields, customFields, serviceVisitTypes]) if (result.error) throw result.error;
    if (siteStatuses.error && !missingStatusReferenceTable(siteStatuses.error)) throw siteStatuses.error;
    cachedReferences = {
      schoolDirectory: [],
      siteStatuses: siteStatuses.error ? defaultSiteStatuses : siteStatuses.data!.map((row) => ({ id: row.id, value: row.value as Status, name: row.name, active: row.active, order: row.display_order })),
      contractors: contractors.data!.map((row) => ({ id: row.id, name: row.name, active: row.active, order: row.display_order })),
      unitTypes: unitTypes.data!.map((row) => ({ id: row.id, name: row.name, active: row.active, order: row.display_order })),
      componentTypes: componentTypes.data!.map((row) => ({ id: row.id, name: row.name, active: row.active, order: row.display_order, defaultOnNewSite: Boolean("default_on_new_site" in row && row.default_on_new_site), fields: row.component_field_definitions.map((field) => ({ id: field.id, libraryFieldId: field.library_field_id, required: field.required, active: field.active, order: field.display_order })) })),
      equipmentFields: equipmentFields.data!.map((row) => ({ id: row.id, label: row.label, type: row.field_type, active: row.active })),
      customFields: customFields.data!.map((row) => ({ id: row.id, label: row.label, type: row.field_type, required: row.required, active: row.active, order: row.display_order, options: row.custom_field_options })),
      serviceVisitTypes: serviceVisitTypes.data!.map((row) => ({ id: row.id, name: row.name, active: row.active, order: row.display_order })),
    };
    cachedReferencesAt = Date.now();
    return cachedReferences;
  })();
  try { return await referencesRequest; } finally { referencesRequest = undefined; }
}

export function invalidateReferencesCache() { cachedReferences = undefined; cachedReferencesAt = 0; referencesRequest = undefined; }

function mapAudit(row: any): AuditEvent {
  const actor = value(row.actor)?.full_name || "System";
  const entity = ({ installation: "site record", installation_components: "equipment", installation_component_values: "equipment value", installation_custom_values: "custom field value", installation_photos: "site photo", service_visits: "service visit", service_visit_photos: "service visit photo", service_visit_component_changes: "service visit equipment change" } as Record<string, string>)[row.entity_type] || row.entity_type.replaceAll("_", " ");
  const action = ({ insert: "added", update: "updated", delete: "removed" } as Record<string, string>)[row.action] || row.action;
  return { id: String(row.id), action: row.action, actor, createdAt: row.created_at, summary: `${actor} ${action} ${entity}.`, beforeData: row.before_data, afterData: row.after_data, changedFields: row.changed_fields || [] };
}
function mapComponent(row: any): Component {
  return { id: row.id, type: value(row.type)?.name || "", notes: row.notes || "", installedAt: row.installed_at, removedAt: row.removed_at, installedViaVisitId: row.installed_via_visit_id, removedViaVisitId: row.removed_via_visit_id, values: Object.fromEntries((row.installation_component_values || []).map((item: any) => [item.field_definition_id, item.value])), duplicateMacAcknowledged: (row.installation_component_values || []).some((item: any) => item.duplicate_mac_acknowledged) };
}
function beneficiaryContacts(row: any) {
  const contacts = Array.isArray(row.beneficiary_contacts) ? row.beneficiary_contacts : [];
  const normalized = contacts.map((contact: any) => ({ id: String(contact.id || crypto.randomUUID()), name: String(contact.name || ""), role: String(contact.role || ""), phone: String(contact.phone || "") })).filter((contact: { name: string; role: string; phone: string }) => contact.name || contact.role || contact.phone);
  if (normalized.length) return normalized;
  return row.beneficiary_name || row.beneficiary_role || row.beneficiary_phone ? [{ id: crypto.randomUUID(), name: row.beneficiary_name || "", role: row.beneficiary_role || "", phone: row.beneficiary_phone || "" }] : [];
}
async function mapVisit(row: any): Promise<ServiceVisit> {
  return { id: row.display_id, dbId: row.id, type: value(row.type)?.name || "", status: row.status, ticketReference: row.ticket_reference || "", contractor: value(row.contractor)?.name || "", scheduledDate: row.scheduled_date, completedDate: row.completed_date, notes: row.notes || "", photos: await signedPhotos("service-visit-photos", row.service_visit_photos), componentChanges: (row.service_visit_component_changes || []).map((change: any) => ({ id: change.id, action: change.action, componentId: change.installation_component_id, componentType: "", summary: change.notes || change.action })), createdBy: value(row.createdBy)?.full_name || "System", updatedBy: value(row.updatedBy)?.full_name || "System", createdAt: row.created_at, updatedAt: row.updated_at };
}
async function mapInstallation(row: any, locationNames: Map<string, string>): Promise<Installation> {
  const location = { islandGroup: getIslandGroup(row.region_code) || "", region: locationNames.get(row.region_code) || "", regionCode: row.region_code, province: locationNames.get(row.province_code) || "", provinceCode: row.province_code || "", municipality: locationNames.get(row.municipality_code) || "", municipalityCode: row.municipality_code, barangay: locationNames.get(row.barangay_code) || "", barangayCode: row.barangay_code };
  const contacts = beneficiaryContacts(row);
  return { id: row.school_id, dbId: row.id, siteName: row.site_name || "", legacyKitNumber: row.kit_number || undefined, unitType: value(row.unitType)?.name || "", contractor: value(row.contractor)?.name || "", installerTeamLead: row.installer_team_lead || "", installDate: row.install_date, activationDate: row.activation_date || undefined, status: row.status, ...location, longitude: row.longitude == null ? "" : String(row.longitude), latitude: row.latitude == null ? "" : String(row.latitude), beneficiaryContacts: contacts, beneficiaryName: contacts[0]?.name || "", beneficiaryRole: contacts[0]?.role || "", beneficiaryPhone: contacts[0]?.phone || "", remarks: row.remarks || "", components: row.installation_components.map(mapComponent), customValues: Object.fromEntries(row.installation_custom_values.map((item: any) => [item.field_id, item.value])), photos: await signedPhotos("installation-photos", row.installation_photos), createdBy: value(row.createdBy)?.full_name || "System", createdAt: row.created_at, updatedBy: value(row.updatedBy)?.full_name || "System", updatedAt: row.updated_at, serviceVisits: await Promise.all((row.service_visits || []).map(mapVisit)), auditEvents: (row.audit_events || []).map(mapAudit) };
}
async function locationNamesFor(rows: any[]) {
  const codes = [...new Set(rows.flatMap((row) => [row.region_code, row.province_code, row.municipality_code, row.barangay_code]).filter(Boolean))];
  const { data, error } = codes.length ? await supabase().from("locations").select("psgc_code,name").in("psgc_code", codes) : { data: [], error: null };
  if (error) throw error;
  return new Map(data.map((row) => [row.psgc_code, row.name]));
}
function mapInstallationSummary(row: any, locationNames: Map<string, string>): Installation {
  const contacts = beneficiaryContacts(row);
  return {
    id: row.school_id, dbId: row.id, siteName: row.site_name || "", legacyKitNumber: row.kit_number || undefined,
    unitType: value(row.unitType)?.name || "", contractor: value(row.contractor)?.name || "", installerTeamLead: row.installer_team_lead || "", installDate: row.install_date, activationDate: row.activation_date || undefined, status: row.status,
    islandGroup: getIslandGroup(row.region_code) || "", region: locationNames.get(row.region_code) || "", regionCode: row.region_code,
    province: locationNames.get(row.province_code) || "", provinceCode: row.province_code || "", municipality: locationNames.get(row.municipality_code) || "",
    municipalityCode: row.municipality_code, barangay: locationNames.get(row.barangay_code) || "", barangayCode: row.barangay_code,
    longitude: row.longitude == null ? "" : String(row.longitude), latitude: row.latitude == null ? "" : String(row.latitude), beneficiaryContacts: contacts, beneficiaryName: contacts[0]?.name || "", beneficiaryRole: contacts[0]?.role || "", beneficiaryPhone: contacts[0]?.phone || "", remarks: row.remarks || "", components: row.installation_components ?? [],
    customValues: Object.fromEntries((row.installation_custom_values || []).map((item: any) => [item.field_id, item.value])),
    photos: [], createdBy: value(row.createdBy)?.full_name || "System", createdAt: row.created_at, updatedBy: value(row.updatedBy)?.full_name || "System",
    updatedAt: row.updated_at, serviceVisits: row.service_visits ?? [], auditEvents: [],
  };
}

export async function loadInstallationSummaries() {
  const { data, error } = await supabase().from("installations").select(`
    id,school_id,site_name,kit_number,installer_team_lead,install_date,activation_date,status,region_code,province_code,municipality_code,barangay_code,longitude,latitude,beneficiary_contacts,beneficiary_name,beneficiary_role,beneficiary_phone,remarks,created_at,updated_at,
    unitType:unit_types(name),contractor:contractors(name),createdBy:profiles!installations_created_by_fkey(full_name),updatedBy:profiles!installations_updated_by_fkey(full_name),
    installation_custom_values(field_id,value),installation_components(id)
  `).order("install_date", { ascending: false });
  if (error) throw error;
  const locationNames = await locationNamesFor(data);
  return data.map((row) => mapInstallationSummary(row, locationNames));
}

export async function loadServiceVisitSummaries() {
  const { data, error } = await supabase().from("installations").select(`
    id,school_id,site_name,kit_number,installer_team_lead,install_date,activation_date,status,region_code,province_code,municipality_code,barangay_code,longitude,latitude,beneficiary_contacts,beneficiary_name,beneficiary_role,beneficiary_phone,remarks,created_at,updated_at,
    unitType:unit_types(name),contractor:contractors(name),createdBy:profiles!installations_created_by_fkey(full_name),updatedBy:profiles!installations_updated_by_fkey(full_name),
    installation_components(id),
    service_visits(id,display_id,status,ticket_reference,scheduled_date,completed_date,notes,created_at,updated_at,type:service_visit_types(name),contractor:contractors(name),createdBy:profiles!service_visits_created_by_fkey(full_name),updatedBy:profiles!service_visits_updated_by_fkey(full_name))
  `).order("install_date", { ascending: false });
  if (error) throw error;
  const locationNames = await locationNamesFor(data);
  return Promise.all(data.map(async (row) => ({ ...mapInstallationSummary(row, locationNames), serviceVisits: await Promise.all((row.service_visits || []).map(mapVisit)) })));
}

const installationDetailSelect = `
  *, unitType:unit_types(name), contractor:contractors(name), createdBy:profiles!installations_created_by_fkey(full_name), updatedBy:profiles!installations_updated_by_fkey(full_name),
  installation_photos(storage_path,caption), installation_custom_values(field_id,value),
  installation_components(*,type:component_types(name),installation_component_values(field_definition_id,value,duplicate_mac_acknowledged))
`;
const serviceVisitDetailSelect = "*,type:service_visit_types(name),contractor:contractors(name),createdBy:profiles!service_visits_created_by_fkey(full_name),updatedBy:profiles!service_visits_updated_by_fkey(full_name),service_visit_photos(storage_path,caption),service_visit_component_changes(*)";

export async function loadInstallations() {
  const { data, error } = await supabase().from("installations").select(installationDetailSelect).order("install_date", { ascending: false });
  if (error) throw error;
  const locationNames = await locationNamesFor(data);
  return Promise.all(data.map((row) => mapInstallation(row, locationNames)));
}

export async function loadInstallationByDisplayId(displayId: string) {
  const { data, error } = await supabase().from("installations").select(installationDetailSelect).eq("school_id", displayId).maybeSingle();
  if (error) throw error;
  if (!data) throw new Error(`School ID ${displayId} was not found.`);
  return mapInstallation(data, await locationNamesFor([data]));
}

export async function loadInstallationDuplicateValidationRecords() {
  const { data, error } = await supabase().from("installations").select(`
    id,school_id,site_name,
    installation_components(id,notes,installed_at,removed_at,installed_via_visit_id,removed_via_visit_id,type:component_types(name),installation_component_values(field_definition_id,value,duplicate_mac_acknowledged))
  `);
  if (error) throw error;
  return data.map((row) => ({
    id: row.school_id, dbId: row.id, siteName: row.site_name || "", unitType: "", contractor: "", installerTeamLead: "", installDate: "", status: "scheduled" as const,
    islandGroup: "" as const, region: "", regionCode: "", province: "", provinceCode: "", municipality: "", municipalityCode: "", barangay: "", barangayCode: "",
    longitude: "", latitude: "", beneficiaryContacts: [], beneficiaryName: "", beneficiaryRole: "", beneficiaryPhone: "", remarks: "", components: row.installation_components.map(mapComponent), customValues: {}, photos: [], createdBy: "", createdAt: "", updatedBy: "",
    updatedAt: "", serviceVisits: [], auditEvents: [],
  }));
}

export async function loadInstallationAuditEvents(installationId: string) {
  const { data, error } = await supabase().from("audit_events").select("*,actor:profiles!audit_events_actor_id_fkey(full_name)").eq("installation_id", installationId).order("created_at", { ascending: false });
  if (error) throw error;
  return data.map(mapAudit);
}

export async function loadInstallationServiceVisits(installationId: string) {
  const { data, error } = await supabase().from("service_visits").select(serviceVisitDetailSelect).eq("installation_id", installationId).order("scheduled_date", { ascending: false });
  if (error) throw error;
  return Promise.all(data.map(mapVisit));
}

export async function loadInstallationForVisitDisplayId(displayId: string) {
  const { data: visit, error: visitError } = await supabase().from("service_visits").select(serviceVisitDetailSelect).eq("display_id", displayId).maybeSingle();
  if (visitError) throw visitError;
  if (!visit) throw new Error(`Service visit ${displayId} was not found.`);
  const { data, error } = await supabase().from("installations").select(installationDetailSelect).eq("id", visit.installation_id).single();
  if (error) throw error;
  return { ...await mapInstallation(data, await locationNamesFor([data])), serviceVisits: [await mapVisit(visit)] };
}

export async function loadInstallationValidationRecords() {
  const { data, error } = await supabase().from("installations").select(`
    id,school_id,site_name,kit_number,installer_team_lead,install_date,activation_date,status,region_code,province_code,municipality_code,barangay_code,longitude,latitude,beneficiary_contacts,beneficiary_name,beneficiary_role,beneficiary_phone,remarks,created_at,updated_at,
    unitType:unit_types(name),contractor:contractors(name),createdBy:profiles!installations_created_by_fkey(full_name),updatedBy:profiles!installations_updated_by_fkey(full_name),
    installation_custom_values(field_id,value),installation_components(*,type:component_types(name),installation_component_values(field_definition_id,value,duplicate_mac_acknowledged))
  `).order("install_date", { ascending: false });
  if (error) throw error;
  const locationNames = await locationNamesFor(data);
  return data.map((row) => ({ ...mapInstallationSummary(row, locationNames), components: row.installation_components.map(mapComponent) }));
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
export async function bulkUpdateInstallations(ids: string[], changes: { status?: Installation["status"]; contractor?: string }) {
  if (!ids.length || (!changes.status && !changes.contractor)) return;
  const client = supabase();
  const { data: { user } } = await client.auth.getUser();
  if (!user) throw new Error("Sign in before updating sites.");
  const payload: Record<string, string> = { updated_by: user.id, updated_at: new Date().toISOString() };
  if (changes.status) payload.status = changes.status;
  if (changes.contractor) {
    const { data, error } = await client.from("contractors").select("id").eq("name", changes.contractor).single();
    if (error) throw error;
    payload.contractor_id = data.id;
  }
  const { error } = await client.from("installations").update(payload).in("id", ids);
  if (error) throw error;
}
export async function deleteInstallation(displayId: string) {
  const { error } = await supabase().rpc("delete_installation_permanently", { target_school_id: displayId });
  if (error && String(error.message).includes("delete_installation_permanently")) throw new Error("Apply the latest Supabase migration before deleting site records.");
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
  if (changed("siteStatuses")) await save("installation_status_options", refs.siteStatuses.map(({ id, value, name, active, order }, index) => ({ id, value, name, active, display_order: order ?? index })));
  if (changed("contractors")) await save("contractors", refs.contractors.map(({ id, name, active, order }, index) => ({ id, name, active, display_order: order ?? index })));
  if (changed("unitTypes")) await save("unit_types", refs.unitTypes.map(({ id, name, active, order }, index) => ({ id, name, active, display_order: order ?? index })));
  if (changed("serviceVisitTypes")) await save("service_visit_types", refs.serviceVisitTypes.map(({ id, name, active, order }, index) => ({ id, name, active, display_order: order ?? index })));
  if (changed("componentTypes")) {
    const componentTypeRows = refs.componentTypes.map(({ id, name, active, order, defaultOnNewSite }, index) => ({ id, name, active, display_order: order ?? index, default_on_new_site: Boolean(defaultOnNewSite) }));
    try { await save("component_types", componentTypeRows); }
    catch (error) { if (missingDefaultComponentTypeColumn(error)) throw new Error("Apply the latest Supabase migration before saving pinned component defaults."); throw error; }
  }
  if (changed("equipmentFields")) await save("equipment_field_library", refs.equipmentFields.map(({ id, label, type, active }) => ({ id, label, field_type: type, active })));
  if (changed("componentTypes")) await save("component_field_definitions", refs.componentTypes.flatMap((type) => type.fields.map((field) => ({ id: field.id, component_type_id: type.id, library_field_id: field.libraryFieldId, required: field.required, active: field.active, display_order: field.order }))));
  if (changed("customFields")) {
    await save("custom_field_definitions", refs.customFields.map(({ id, label, type, required, active, order }) => ({ id, label, field_type: type, required, active, display_order: order })));
    await save("custom_field_options", refs.customFields.flatMap((field) => field.options.map((option) => ({ ...option, field_id: field.id }))));
  }
  invalidateReferencesCache();
}

export async function deleteReferencePermanently(kind: "siteStatus" | "contractor" | "unitType" | "customField" | "componentType" | "equipmentField" | "componentFieldAttachment", id: string) {
  const functions = { siteStatus: "delete_installation_status_permanently", contractor: "delete_contractor_permanently", unitType: "delete_unit_type_permanently", customField: "delete_custom_field_permanently", componentType: "delete_component_type_permanently", equipmentField: "delete_equipment_field_permanently", componentFieldAttachment: "delete_component_field_attachment" } as const;
  const args = { siteStatus: { target_status_id: id }, contractor: { target_contractor_id: id }, unitType: { target_unit_type_id: id }, customField: { target_field_id: id }, componentType: { target_component_type_id: id }, equipmentField: { target_library_field_id: id }, componentFieldAttachment: { target_field_definition_id: id } } as const;
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
  const data = await response.json(); if (!response.ok) throw new Error(data.error);
  if (cachedProfile) cachedProfile = { ...cachedProfile, fullName };
  return data as { fullName: string };
}
