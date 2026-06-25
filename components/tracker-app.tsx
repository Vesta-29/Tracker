"use client";

import { ChangeEvent, Dispatch, FormEvent, PointerEvent, SetStateAction, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  Activity, AlertTriangle, ArrowDownAZ, ArrowUpAZ, BarChart3, CalendarRange, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, CircleDot, ClipboardCopy, ClipboardList, ClipboardPaste,
  Download, FileSpreadsheet, GripVertical, History, ImagePlus, KeyRound, LogOut, MessageSquareText, MoreHorizontal, Package, Pencil, Pin, Plus, Power, RadioTower, Search, Wrench,
  Trash2, Users, X
} from "lucide-react";
import { islandGroups, getIslandGroup } from "@/lib/location-groups";
import { bulkUpdateInstallations, clearInvalidSession, consumeAuthCallback, createUser, deleteInstallation, deleteReferencePermanently, extractSiteReportWithGemini, findSchoolDirectoryEntry, generateUserTemporaryPassword, getCachedUsers, listLocationOptions, listUsers, loadInstallations, loadInstallationAuditEvents, loadInstallationByDisplayId, loadInstallationDuplicateValidationRecords, loadInstallationForVisitDisplayId, loadInstallationServiceVisits, loadInstallationSummaries, loadInstallationValidationRecords, loadReferences, loadSchoolDirectoryStatus, loadServiceVisitSummaries, loadProfile, persistReferences, prefetchUsers, replaceSchoolDirectory, requestPasswordReset, saveInstallation, saveInstallationBatch, saveVisit, searchSchoolDirectory, setPassword, signIn, updateUser } from "@/lib/supabase-repository";
import { supabaseConfigured } from "@/lib/supabase-browser";
import { useGuardedNavigation, useNavigationBlocker } from "@/lib/guarded-navigation";
import { plusCodeFromStrings } from "@/lib/plus-code";
import type { LocationOption } from "@/lib/supabase-repository";
import type { AuditEvent, BeneficiaryContact, Component, ComponentFieldAttachment, ComponentFieldType, ComponentTypeOption, CustomFieldDefinition, CustomFieldType, EquipmentFieldLibraryItem, Installation, Profile, ReferenceData, ReferenceOption, SchoolDirectoryEntry, SchoolDirectoryStatus, ServiceVisit, ServiceVisitStatus, Status, StatusReferenceOption } from "@/lib/types";
import { parseContractorAddress, parseSiteActivationReport, type SiteReportExtraction, type SiteReportValues } from "@/lib/site-report-parser";

type Page = "dashboard" | "installations" | "new" | "serviceVisits" | "import" | "settings";
type Filter = { search: string; status: string; contractor: string; updatedBy: string; islandGroup: string; regionCode: string; provinceCode: string; municipalityCode: string; barangayCode: string; from: string; to: string; attention: "" | "missingName" | "legacyKit" };
type ServiceVisitFilter = { search: string; status: string; type: string; contractor: string; from: string; to: string };
type ReferenceSaveState = "idle" | "saving" | "saved" | "failed";
type ImportRow = { row: number; kind: "Site" | "Equipment"; subject: string; details: string; reference: string; valid: boolean; issue: string };
const emptyFilter: Filter = { search: "", status: "", contractor: "", updatedBy: "", islandGroup: "", regionCode: "", provinceCode: "", municipalityCode: "", barangayCode: "", from: "", to: "", attention: "" };
const emptyReferences: ReferenceData = { schoolDirectory: [], siteStatuses: [], contractors: [], unitTypes: [], componentTypes: [], equipmentFields: [], customFields: [], serviceVisitTypes: [] };
const addContractorOption = "__add_contractor__";
type RouteWorkspace = { profile: Profile; refs: ReferenceData; records: Installation[]; loadedAt: number };
type SavedSiteFilter = { id: string; name: string; filters: Filter };
const routeWorkspaceCache = new Map<string, RouteWorkspace>();
const savedSiteFiltersKey = "fieldtrack:saved-site-filters";
function cachedRouteWorkspace(routeKey: string) { return routeWorkspaceCache.get(routeKey); }
function cacheRouteWorkspace(routeKey: string, profile: Profile, refs: ReferenceData, records: Installation[]) { routeWorkspaceCache.set(routeKey, { profile, refs, records, loadedAt: Date.now() }); }
export function invalidateRouteWorkspaceCache() { routeWorkspaceCache.clear(); }
const statusColors: Record<string, string> = {
  installed: "oklch(0.58 0.13 155)",
  scheduled: "oklch(0.58 0.14 245)",
  issue: "oklch(0.72 0.14 70)",
  cancelled: "oklch(0.62 0.11 28)",
};
const fallbackStatusColors = ["oklch(0.56 0.11 190)", "oklch(0.58 0.12 285)", "oklch(0.6 0.13 330)", "oklch(0.55 0.1 120)", "oklch(0.62 0.11 45)"];
const defaultSiteStatuses: StatusReferenceOption[] = [
  { id: "scheduled", value: "scheduled", name: "Scheduled", active: true, order: 0 },
  { id: "installed", value: "installed", name: "Installed", active: true, order: 1 },
  { id: "issue", value: "issue", name: "Issue", active: true, order: 2 },
  { id: "cancelled", value: "cancelled", name: "Cancelled", active: true, order: 3 },
];
function orderedByDisplay<T extends { order?: number }>(items: T[]) { return [...items].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)); }
function siteStatusOptions(refs?: ReferenceData, selected?: Status) { const options = refs?.siteStatuses?.length ? refs.siteStatuses : defaultSiteStatuses; return orderedByDisplay(options).filter((option) => option.active || option.value === selected); }
function siteStatusLabel(status: Status, refs?: ReferenceData) { return (refs?.siteStatuses?.length ? refs.siteStatuses : defaultSiteStatuses).find((option) => option.value === status)?.name ?? status; }
function siteStatusColor(status: Status) {
  if (statusColors[status]) return statusColors[status];
  const hash = [...status].reduce((total, char) => total + char.charCodeAt(0), 0);
  return fallbackStatusColors[hash % fallbackStatusColors.length];
}
function statusSlug(name: string, existing: StatusReferenceOption[]) {
  const base = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "status";
  const values = new Set(existing.map((item) => item.value));
  let candidate = base;
  let suffix = 2;
  while (values.has(candidate)) candidate = `${base}_${suffix++}`;
  return candidate;
}
function uid(prefix: string) { return `${prefix}-${Date.now().toString(36).toUpperCase()}`; }
function uuid() { return crypto.randomUUID(); }
function today() { return new Date().toISOString().slice(0, 10); }
function componentDraft(typeName: string, order = 0): Component { return { id: `${uid("CMP")}-${order + 1}`, type: typeName, values: {}, notes: "", installedAt: new Date().toISOString() }; }
function defaultNewSiteComponents(refs: ReferenceData) { return orderedByDisplay(refs.componentTypes).filter((type) => type.active && type.defaultOnNewSite).map((type, index) => componentDraft(type.name, index)); }
type ExtractionEquipmentSlot = "starlink" | "indoor1" | "indoor2" | "outdoor" | "router";
type AutoEquipmentValue = { componentId: string; fieldId: string; value: string; generated: boolean };
type ExtractionSummary = { filled: number; missing: number; warnings: string[]; diagnostics: string[]; source: "local" | "gemini" };
const equipmentSlotValues: Record<ExtractionEquipmentSlot, keyof SiteReportValues> = { starlink: "starlinkKitNumber", indoor1: "ap1IndoorSerial", indoor2: "ap2IndoorSerial", outdoor: "ap3OutdoorSerial", router: "ruijieRouterSerial" };
function extractionTypeMatch(slot: ExtractionEquipmentSlot, name: string) {
  const value = name.toLowerCase();
  if (slot === "starlink") return value.includes("starlink");
  if (slot === "router") return /\brouter\b/.test(value);
  const accessPoint = /\bap\b|access\s*point/.test(value);
  return accessPoint && value.includes(slot === "outdoor" ? "outdoor" : "indoor");
}
async function createWorkbook() { const { default: ExcelJS } = await import("exceljs"); return new ExcelJS.Workbook(); }
function downloadBlob(blob: Blob, filename: string) {
  const href = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = href; link.download = filename; link.click();
  window.setTimeout(() => URL.revokeObjectURL(href), 0);
}
function useBlobUrlCleanup(photos: { url: string }[]) {
  const photosRef = useRef(photos);
  useEffect(() => { photosRef.current = photos; }, [photos]);
  useEffect(() => () => photosRef.current.forEach((photo) => { if (photo.url.startsWith("blob:")) URL.revokeObjectURL(photo.url); }), []);
}
function handleTabKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
  if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
  const tabs = [...event.currentTarget.querySelectorAll<HTMLButtonElement>("[role='tab']")];
  const index = tabs.indexOf(document.activeElement as HTMLButtonElement);
  if (index < 0) return;
  event.preventDefault();
  const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : event.key === "ArrowRight" ? (index + 1) % tabs.length : (index - 1 + tabs.length) % tabs.length;
  tabs[next]?.focus();
  tabs[next]?.click();
}
function isInteractiveTarget(target: EventTarget | null) {
  return target instanceof HTMLElement && Boolean(target.closest("a,button,input,select,textarea,summary,[role='button'],[role='menuitem']"));
}
function handleRowKeyboard(event: React.KeyboardEvent, action: () => void) {
  if (isInteractiveTarget(event.target)) return;
  if (event.key !== "Enter" && event.key !== " ") return;
  event.preventDefault();
  action();
}
function pageFromPathname(pathname: string): Page {
  if (pathname === "/dashboard") return "dashboard";
  if (pathname === "/sites") return "installations";
  if (pathname.startsWith("/sites/")) return "new";
  if (pathname.startsWith("/service-visits")) return "serviceVisits";
  if (pathname === "/import") return "import";
  if (pathname.startsWith("/admin/")) return "settings";
  return "dashboard";
}
function pathForPage(page: Page) {
  return ({ dashboard: "/dashboard", installations: "/sites", new: "/sites/new", serviceVisits: "/service-visits", import: "/import", settings: "/admin/contractors" } as const)[page];
}
function safeReturnTo(value: string | null) { return value?.startsWith("/") && !value.startsWith("//") ? value : "/service-visits"; }
function siteFilterFromSearchParams(params: URLSearchParams): Filter {
  const attention = params.get("attention");
  return {
    search: params.get("search") ?? "",
    status: params.get("status") ?? "",
    contractor: params.get("contractor") ?? "",
    updatedBy: params.get("updatedBy") ?? "",
    islandGroup: params.get("islandGroup") ?? "",
    regionCode: params.get("regionCode") ?? "",
    provinceCode: params.get("provinceCode") ?? "",
    municipalityCode: params.get("municipalityCode") ?? "",
    barangayCode: params.get("barangayCode") ?? "",
    from: params.get("from") ?? "",
    to: params.get("to") ?? "",
    attention: attention === "missingName" || attention === "legacyKit" ? attention : "",
  };
}
function siteFilterQuery(filters: Filter) {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => { if (value) params.set(key, value); });
  return params.toString();
}
function sanitizeSiteFilter(filters: Filter, records: Installation[], refs: ReferenceData): Filter {
  const next = { ...emptyFilter, ...filters };
  if (next.status && !siteStatusOptions(refs).some((option) => option.value === next.status)) next.status = "";
  if (next.contractor && !refs.contractors.some((item) => item.name === next.contractor)) next.contractor = "";
  if (next.updatedBy && !records.some((record) => record.updatedBy === next.updatedBy)) next.updatedBy = "";
  if (next.islandGroup && !records.some((record) => record.islandGroup === next.islandGroup)) next.islandGroup = "";
  if (next.regionCode && !records.some((record) => (!next.islandGroup || record.islandGroup === next.islandGroup) && record.regionCode === next.regionCode)) next.regionCode = "";
  if (!next.regionCode) { next.provinceCode = ""; next.municipalityCode = ""; next.barangayCode = ""; return next; }
  if (next.provinceCode && !records.some((record) => record.regionCode === next.regionCode && record.provinceCode === next.provinceCode)) next.provinceCode = "";
  if (!next.provinceCode) { next.municipalityCode = ""; next.barangayCode = ""; return next; }
  if (next.municipalityCode && !records.some((record) => record.provinceCode === next.provinceCode && record.municipalityCode === next.municipalityCode)) next.municipalityCode = "";
  if (!next.municipalityCode) { next.barangayCode = ""; return next; }
  if (next.barangayCode && !records.some((record) => record.municipalityCode === next.municipalityCode && record.barangayCode === next.barangayCode)) next.barangayCode = "";
  return next;
}
function serviceVisitFilterFromSearchParams(params: URLSearchParams, minDate: string, maxDate: string): ServiceVisitFilter {
  return { search: params.get("search") ?? "", status: params.get("status") ?? "", type: params.get("type") ?? "", contractor: params.get("contractor") ?? "", from: params.get("from") ?? minDate, to: params.get("to") ?? maxDate };
}
function serviceVisitFilterQuery(filters: ServiceVisitFilter, minDate: string, maxDate: string) {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => { if (value && !((key === "from" && value === minDate) || (key === "to" && value === maxDate))) params.set(key, value); });
  return params.toString();
}
function referenceNamesChanged(current: ReferenceData, previous: ReferenceData) {
  const names = (items: { id: string; name: string }[]) => items.map(({ id, name }) => ({ id, name }));
  return JSON.stringify(names(current.contractors)) !== JSON.stringify(names(previous.contractors))
    || JSON.stringify(names(current.unitTypes)) !== JSON.stringify(names(previous.unitTypes))
    || JSON.stringify(names(current.componentTypes)) !== JSON.stringify(names(previous.componentTypes))
    || JSON.stringify(names(current.serviceVisitTypes)) !== JSON.stringify(names(previous.serviceVisitTypes))
    || JSON.stringify(current.siteStatuses.map(({ value, name }) => ({ value, name }))) !== JSON.stringify(previous.siteStatuses.map(({ value, name }) => ({ value, name })));
}
function niceDate(value: string) { return new Intl.DateTimeFormat("en-PH", { month: "short", day: "numeric", year: "numeric" }).format(new Date(value)); }
function niceDateTime(value: string) { return new Intl.DateTimeFormat("en-PH", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(value)); }
function useEscape(onEscape: () => void, active = true) {
  useEffect(() => {
    if (!active) return;
    function keydown(event: KeyboardEvent) { if (event.key === "Escape") onEscape(); }
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [active, onEscape]);
}
function activeOptions(options: ReferenceOption[], selected?: string) { return options.filter((option) => option.active || option.name === selected); }
function normalizeMac(value: string) { const compact = value.replace(/[:-]/g, "").trim().toUpperCase(); return /^[0-9A-F]{12}$/.test(compact) ? compact.match(/.{2}/g)!.join(":") : ""; }
function validInteger(value: string) { return /^-?\d+$/.test(value.trim()); }
function equipmentFieldTypeLabel(type: ComponentFieldType) { return ({ text: "Text", mac: "MAC address", integer: "Whole number", boolean: "Yes or No" } as const)[type]; }
function componentType(refs: ReferenceData, type: string) { return refs.componentTypes.find((option) => option.name === type); }
function libraryField(refs: ReferenceData, attachment: ComponentFieldAttachment) { return (refs.equipmentFields ?? []).find((field) => field.id === attachment.libraryFieldId); }
function locationLabel(record: Pick<Installation, "barangay" | "municipality">) { return [record.barangay, record.municipality].filter(Boolean).join(", ") || "Location pending"; }
function contactDraft(): BeneficiaryContact { return { id: crypto.randomUUID(), name: "", role: "", phone: "" }; }
function contactHasValue(contact: BeneficiaryContact) { return Boolean(contact.name.trim() || contact.phone.trim()); }
function beneficiaryContactList(record: Pick<Installation, "beneficiaryContacts" | "beneficiaryName" | "beneficiaryRole" | "beneficiaryPhone">) {
  return record.beneficiaryContacts?.length ? record.beneficiaryContacts : [{ id: crypto.randomUUID(), name: record.beneficiaryName || "", role: record.beneficiaryRole || "", phone: record.beneficiaryPhone || "" }];
}
function parseAdditionalBeneficiaryContacts(value: unknown) {
  if (!value) return [];
  try {
    const contacts = JSON.parse(String(value));
    return Array.isArray(contacts) ? contacts.map((contact) => ({ id: String(contact.id || crypto.randomUUID()), name: String(contact.name || ""), role: String(contact.role || ""), phone: String(contact.phone || "") })).filter(contactHasValue) : [];
  } catch {
    return [];
  }
}
function additionalBeneficiaryContacts(record: Pick<Installation, "beneficiaryContacts" | "beneficiaryName" | "beneficiaryRole" | "beneficiaryPhone">) {
  return beneficiaryContactList(record).filter(contactHasValue).slice(1);
}
function additionalBeneficiaryContactsValue(record: Pick<Installation, "beneficiaryContacts" | "beneficiaryName" | "beneficiaryRole" | "beneficiaryPhone">) {
  const contacts = additionalBeneficiaryContacts(record);
  return contacts.length ? JSON.stringify(contacts.map(({ name, phone }) => ({ name, phone }))) : "";
}
function syncedBeneficiaryFields(record: Installation): Installation {
  const contacts = beneficiaryContactList(record).map((contact) => ({ ...contact, name: contact.name.trim(), role: "", phone: contact.phone.trim() })).filter(contactHasValue);
  const first = contacts[0];
  return { ...record, beneficiaryContacts: contacts, beneficiaryName: first?.name || "", beneficiaryRole: "", beneficiaryPhone: first?.phone || "" };
}
function visibleComponentFields(refs: ReferenceData, component: Component) { return (componentType(refs, component.type)?.fields ?? []).filter((field) => field.active || Boolean((component.values ?? {})[field.id])).sort((a, b) => a.order - b.order); }
function componentMacValues(refs: ReferenceData, component: Component) { return visibleComponentFields(refs, component).filter((field) => libraryField(refs, field)?.type === "mac").map((field) => normalizeMac((component.values ?? {})[field.id] ?? "")).filter(Boolean); }
function EquipmentValueInput({ type, label, value, required = false, disabled = false, id, invalid = false, describedBy, onChange, onBlur }: { type: ComponentFieldType; label: string; value: string; required?: boolean; disabled?: boolean; id?: string; invalid?: boolean; describedBy?: string; onChange: (value: string) => void; onBlur?: () => void }) {
  const a11y = { id, "aria-invalid": invalid || undefined, "aria-describedby": describedBy };
  if (type === "boolean") return <select {...a11y} className="select" value={value} required={required} disabled={disabled} onChange={(event) => onChange(event.target.value)}><option value="">Choose a value</option><option value="true">Yes</option><option value="false">No</option></select>;
  return <input {...a11y} className="field" type={type === "integer" ? "number" : "text"} inputMode={type === "integer" ? "numeric" : undefined} step={type === "integer" ? "1" : undefined} value={value} required={required} disabled={disabled} onChange={(event) => onChange(event.target.value)} onBlur={onBlur} placeholder={type === "mac" ? "AA:BB:CC:DD:EE:FF" : label} />;
}
function StatusPill({ status, refs }: { status: Status; refs?: ReferenceData }) { return <span className="pill"><span className="status-dot" aria-hidden="true" style={{ background: siteStatusColor(status) }} />{siteStatusLabel(status, refs)}</span>; }
const serviceStatusLabels: Record<ServiceVisitStatus, string> = { scheduled: "Scheduled", in_progress: "In progress", completed: "Completed", cancelled: "Cancelled" };
const auditFieldLabels: Record<string, string> = { siteName: "site name", site_name: "site name", school_id: "school ID", unitType: "solution", unit_type_id: "solution", contractor: "contractor", contractor_id: "contractor", installerTeamLead: "installer/team lead", installer_team_lead: "installer/team lead", installDate: "installation date", install_date: "installation date", activationDate: "activation date", activation_date: "activation date", status: "status", islandGroup: "island group", region: "region", region_code: "region", province: "province", province_code: "province", municipality: "locality", municipality_code: "locality", barangay: "barangay", barangay_code: "barangay", contractorAddress: "contractor-provided address", contractor_address: "contractor-provided address", longitude: "longitude", latitude: "latitude", beneficiaryName: "beneficiary name", beneficiary_name: "beneficiary name", beneficiaryRole: "beneficiary role", beneficiary_role: "beneficiary role", beneficiaryPhone: "beneficiary phone", beneficiary_phone: "beneficiary phone", remarks: "remarks", notes: "notes", value: "value", removed_at: "removed date", installed_at: "installed date", completed_date: "completed date", scheduled_date: "scheduled date", ticket_reference: "ticket reference" };
const hiddenAuditFields = new Set(["id", "created_at", "updated_at", "created_by", "updated_by", "installation_id", "installation_component_id", "field_definition_id", "component_type_id", "visit_type_id", "actor_id", "import_batch_id"]);
function auditTitle(value: string) { return value.replaceAll("_", " ").replace(/\b[a-z]/g, (letter) => letter.toUpperCase()); }
function auditLabel(field: string) { return auditTitle(auditFieldLabels[field] ?? field); }
function auditValue(value: unknown) { if (value === null || value === undefined || value === "") return "None"; if (typeof value === "boolean") return value ? "Yes" : "No"; if (typeof value === "object") return JSON.stringify(value); const text = String(value); return /^[a-z][a-z _-]*$/i.test(text) ? auditTitle(text) : text; }
function errorMessage(error: unknown, fallback: string) { return error instanceof Error ? error.message : typeof error === "object" && error !== null && "message" in error ? String(error.message) : fallback; }

export default function TrackerApp() {
  const router = useRouter();
  const navigate = useGuardedNavigation();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const page = pageFromPathname(pathname);
  const siteDetailMatch = pathname.match(/^\/sites\/([^/]+)$/);
  const siteDetailId = siteDetailMatch && siteDetailMatch[1] !== "new" ? decodeURIComponent(siteDetailMatch[1]) : "";
  const serviceVisitDetailMatch = pathname.match(/^\/service-visits\/([^/]+)$/);
  const serviceVisitDetailId = serviceVisitDetailMatch && serviceVisitDetailMatch[1] !== "new" ? decodeURIComponent(serviceVisitDetailMatch[1]) : "";
  const newVisitSiteId = pathname === "/service-visits/new" ? searchParams.get("site") ?? "" : "";
  const isAdminSettingsRoute = pathname.startsWith("/admin/");
  const routeKey = isAdminSettingsRoute ? "/admin/settings" : `${pathname}?${newVisitSiteId}`;
  const [initialWorkspace] = useState(() => cachedRouteWorkspace(routeKey));
  const [loggedIn, setLoggedIn] = useState(Boolean(initialWorkspace));
  const [loading, setLoading] = useState(supabaseConfigured && !initialWorkspace);
  const [refreshing, setRefreshing] = useState(false);
  const [passwordSetup, setPasswordSetup] = useState(false);
  const [profile, setProfile] = useState<Profile | undefined>(initialWorkspace?.profile);
  const [loadError, setLoadError] = useState("");
  const [records, setRecords] = useState<Installation[]>(initialWorkspace?.records ?? []);
  const [refs, setRefs] = useState<ReferenceData>(initialWorkspace?.refs ?? emptyReferences);
  const [savedRefs, setSavedRefs] = useState<ReferenceData>(initialWorkspace?.refs ?? emptyReferences);
  const [editing, setEditing] = useState<Installation | undefined>();
  const [loadedRouteKey, setLoadedRouteKey] = useState(initialWorkspace ? routeKey : "");
  const [toast, setToast] = useState("");
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [navAttempt, setNavAttempt] = useState<Page | null>(null);
  const [referenceSaveState, setReferenceSaveState] = useState<ReferenceSaveState>("saved");
  const [referenceSaveError, setReferenceSaveError] = useState("");
  const [routeNavAttempt, setRouteNavAttempt] = useState("");
  const siteFilterParams = searchParams.toString();
  const siteRoute = page === "dashboard" || page === "installations";
  const filters = useMemo(() => sanitizeSiteFilter(siteFilterFromSearchParams(new URLSearchParams(siteFilterParams)), records, refs), [records, refs, siteFilterParams]);
  const pendingFiltersRef = useRef<Filter | undefined>(undefined);
  const siteRecord = editing ?? (loadedRouteKey === routeKey ? records.find((record) => record.id === siteDetailId) : undefined);
  const setPage = useCallback((next: Page) => {
    const query = next === "dashboard" || next === "installations" ? siteFilterQuery(pendingFiltersRef.current ?? filters) : "";
    pendingFiltersRef.current = undefined;
    navigate(`${pathForPage(next)}${query ? `?${query}` : ""}`);
  }, [filters, navigate]);
  const setFilters = useCallback((next: Filter) => {
    pendingFiltersRef.current = next;
    if (!siteRoute) return;
    const query = siteFilterQuery(next);
    router.replace(`${pathname}${query ? `?${query}` : ""}`, { scroll: false });
  }, [pathname, router, siteRoute]);
  const notify = useCallback((message: string) => { setToast(message); setTimeout(() => setToast(""), 3000); }, []);
  const refresh = useCallback(async ({ invalidate = false }: { invalidate?: boolean } = {}) => {
    if (invalidate) invalidateRouteWorkspaceCache();
    const cached = cachedRouteWorkspace(routeKey);
    if (!invalidate && isAdminSettingsRoute && cached && loadedRouteKey === routeKey) {
      setLoading(false); setRefreshing(false); setLoadError("");
      return;
    }
    setLoading(!cached && loadedRouteKey !== routeKey); setRefreshing(Boolean(cached || loadedRouteKey === routeKey)); setLoadError("");
    try {
      const loadRouteRecords = page === "dashboard" || page === "installations" ? loadInstallationSummaries
        : siteDetailId ? async () => { const [context, detail] = await Promise.all([loadInstallationDuplicateValidationRecords(), loadInstallationByDisplayId(siteDetailId)]); return [detail, ...context.filter((record) => record.id !== detail.id)]; }
        : pathname === "/sites/new" ? loadInstallationDuplicateValidationRecords
        : pathname === "/service-visits" ? loadServiceVisitSummaries
        : serviceVisitDetailId ? async () => [await loadInstallationForVisitDisplayId(serviceVisitDetailId)]
        : pathname === "/service-visits/new" && newVisitSiteId ? async () => [await loadInstallationByDisplayId(newVisitSiteId)]
        : pathname === "/service-visits/new" ? loadInstallationSummaries
        : pathname === "/import" ? loadInstallationValidationRecords
        : isAdminSettingsRoute ? loadInstallationValidationRecords
        : loadInstallationValidationRecords;
      const [nextProfile, nextRefs, nextRecords] = await Promise.all([loadProfile({ force: invalidate }), loadReferences({ force: true }), loadRouteRecords()]);
      cacheRouteWorkspace(routeKey, nextProfile, nextRefs, nextRecords);
      setProfile(nextProfile); setRecords(nextRecords); setRefs(nextRefs); setSavedRefs(nextRefs); setLoadedRouteKey(routeKey); setLoggedIn(true); if (pathname === "/") router.replace("/dashboard");
    }
    catch (error) { const expired = await clearInvalidSession(error); if (expired) invalidateRouteWorkspaceCache(); setLoggedIn(false); setLoadError(expired ? "Your session expired. Sign in again." : error instanceof Error ? error.message : "Unable to load FieldTrack."); }
    finally { setLoading(false); setRefreshing(false); }
  }, [isAdminSettingsRoute, loadedRouteKey, newVisitSiteId, page, pathname, routeKey, router, serviceVisitDetailId, siteDetailId]);
  useEffect(() => {
    if (!supabaseConfigured) return;
    void consumeAuthCallback()
      .then((requiresPassword) => { if (requiresPassword) { setPasswordSetup(true); setLoading(false); } else void refresh(); })
      .catch((error) => { setLoadError(error instanceof Error ? error.message : "Unable to accept invitation."); setLoading(false); });
  }, [refresh]);
  const saveReferences = useCallback(async () => {
    setReferenceSaveState("saving"); setReferenceSaveError("");
    try {
      const reloadRecords = referenceNamesChanged(refs, savedRefs);
      await persistReferences(refs, savedRefs);
      const [latestRefs, latestRecords] = await Promise.all([loadReferences({ force: true }), reloadRecords ? loadInstallations() : Promise.resolve(undefined)]);
      invalidateRouteWorkspaceCache(); setRefs(latestRefs); setSavedRefs(latestRefs); if (latestRecords) setRecords(latestRecords);
      setReferenceSaveState("saved"); notify("Settings saved."); return true;
    }
    catch (error) { setReferenceSaveState("failed"); setReferenceSaveError(error instanceof Error ? error.message : "Unable to save reference settings."); return false; }
  }, [refs, savedRefs, notify]);
  const addContractorFromRecord = useCallback(async (rawName: string) => {
    const name = rawName.trim();
    if (!name) throw new Error("Enter a contractor name.");
    const existing = refs.contractors.find((contractor) => contractor.name.toLowerCase() === name.toLowerCase());
    const nextRefs = existing
      ? { ...refs, contractors: refs.contractors.map((contractor) => contractor.id === existing.id ? { ...contractor, active: true } : contractor) }
      : { ...refs, contractors: [...refs.contractors, { id: uuid(), name, active: true, order: refs.contractors.length }] };
    await persistReferences(nextRefs, savedRefs);
    const latestRefs = await loadReferences({ force: true });
    invalidateRouteWorkspaceCache();
    setRefs(latestRefs);
    setSavedRefs(latestRefs);
    notify(existing ? `${existing.name} is now available.` : `${name} was added.`);
    return existing?.name ?? name;
  }, [refs, savedRefs, notify]);
  const hasUnsavedReferences = useMemo(() => JSON.stringify(refs) !== JSON.stringify(savedRefs), [refs, savedRefs]);
  useEffect(() => {
    if (!hasUnsavedReferences && !hasUnsavedChanges) return;
    function beforeUnload(event: BeforeUnloadEvent) { event.preventDefault(); event.returnValue = ""; }
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [hasUnsavedChanges, hasUnsavedReferences]);
  const blockNavigation = useCallback((href: string) => setRouteNavAttempt(href), []);
  useNavigationBlocker((page === "new" && hasUnsavedChanges) || (page === "settings" && hasUnsavedReferences), blockNavigation);
  const canEdit = Boolean(profile && profile.role !== "guest");
  useEffect(() => {
    function handleShortcuts(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const isTyping = target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable);
      const key = event.key.toLowerCase();
      if ((event.ctrlKey || event.metaKey) && key === "k") {
        event.preventDefault();
        document.querySelector<HTMLInputElement>("[data-site-search='true']")?.focus();
        return;
      }
      if ((event.ctrlKey || event.metaKey) && key === "s") {
        if (page === "settings" && hasUnsavedReferences) {
          event.preventDefault();
          void saveReferences();
          return;
        }
        const form = document.querySelector<HTMLFormElement>("[data-save-shortcut='site-form']");
        if (form) {
          event.preventDefault();
          form.requestSubmit();
        }
        return;
      }
      if (!isTyping && event.altKey && key === "n" && canEdit) {
        event.preventDefault();
        setPage("new");
      }
    }
    window.addEventListener("keydown", handleShortcuts);
    return () => window.removeEventListener("keydown", handleShortcuts);
  }, [canEdit, hasUnsavedReferences, page, saveReferences, setPage]);

  const filtered = useMemo(() => records.filter((r) =>
    (!filters.search || `${r.id} ${r.siteName} ${r.legacyKitNumber ?? ""} ${r.barangay} ${r.municipality}`.toLowerCase().includes(filters.search.toLowerCase())) &&
    (!filters.status || r.status === filters.status) &&
    (!filters.contractor || r.contractor === filters.contractor) &&
    (!filters.updatedBy || r.updatedBy === filters.updatedBy) &&
    (!filters.islandGroup || r.islandGroup === filters.islandGroup) &&
    (!filters.regionCode || r.regionCode === filters.regionCode) &&
    (!filters.provinceCode || r.provinceCode === filters.provinceCode) &&
    (!filters.municipalityCode || r.municipalityCode === filters.municipalityCode) &&
    (!filters.barangayCode || r.barangayCode === filters.barangayCode) &&
    (!filters.from || r.installDate >= filters.from) &&
    (!filters.to || r.installDate <= filters.to) &&
    (!filters.attention || (filters.attention === "missingName" ? !r.siteName : Boolean(r.legacyKitNumber)))
  ), [records, filters]);

  async function save(record: Installation, dest: Page = "installations", href = "") {
    try {
      await saveInstallation(record);
      invalidateRouteWorkspaceCache();
      setEditing(undefined);
      setRouteNavAttempt("");
      setHasUnsavedChanges(false);
      setNavAttempt(null);
      navigate(href || pathForPage(dest), { bypassGuard: true });
      notify("Site record saved.");
    }
    catch (error) { notify(error instanceof Error ? error.message : "Unable to save site record."); }
  }
  async function deleteSite(record: Installation) {
    try {
      await deleteInstallation(record.id);
      await refresh({ invalidate: true });
      setEditing(undefined);
      setRouteNavAttempt("");
      setHasUnsavedChanges(false);
      setNavAttempt(null);
      navigate("/sites", { bypassGuard: true });
      notify("Site record deleted.");
    } catch (error) {
      notify(errorMessage(error, "Unable to delete site record."));
      throw error;
    }
  }
  async function saveServiceVisit(installationId: string, visit: ServiceVisit, components: Component[]) {
    const installation = records.find((record) => record.id === installationId); if (!installation) return;
    try { await saveVisit(installation, visit, components); await refresh({ invalidate: true }); notify("Service visit saved."); return true; }
    catch (error) { notify(error instanceof Error ? error.message : "Unable to save service visit."); return false; }
  }
  function startEdit(record: Installation) { navigate(`/sites/${encodeURIComponent(record.id)}`); }
  if (!supabaseConfigured) return <SetupRequired />;
  if (loading) return pathname === "/" ? <div className="login"><div className="login-card"><strong>Loading FieldTrack...</strong></div></div> : <RouteLoading pathname={pathname} />;
  if (passwordSetup) return <PasswordSetup onSave={async (password) => { await setPassword(password); setPasswordSetup(false); await refresh(); }} />;
  if (!loggedIn) return pathname === "/" ? <Login error={loadError} onLogin={async (email, password) => { await signIn(email, password); await refresh({ invalidate: true }); }} onReset={requestPasswordReset} /> : <div className="notice validation-notice"><strong>Unable to load this page.</strong> {loadError}<div className="toolbar" style={{ marginTop: 10 }}><button type="button" className="button" onClick={() => void refresh({ invalidate: true })}>Try again</button></div></div>;
  return (
    <>
          {refreshing && <div className="route-refresh-overlay" role="status" aria-live="polite" aria-atomic="true"><div className="route-refresh-card"><span className="route-refresh-dot" /><div><strong>Updating page data</strong><small>Keeping the latest changes in sync.</small></div></div></div>}
          {page === "dashboard" && <Dashboard records={filtered} allRecords={records} refs={refs} filters={filters} setFilters={setFilters} setPage={setPage} canEdit={canEdit} />}
          {page === "installations" && <Installations records={filtered} allRecords={records} refs={refs} filters={filters} setFilters={setFilters} startEdit={startEdit} setPage={setPage} canEdit={canEdit} onBulkUpdate={async (ids, changes) => { try { await bulkUpdateInstallations(ids, changes); await refresh({ invalidate: true }); notify("Selected sites updated."); } catch (error) { notify(error instanceof Error ? error.message : "Unable to update selected sites."); throw error; } }} />}
          {page === "serviceVisits" && <ServiceVisitsPage records={records} refs={refs} actorName={profile?.fullName || profile?.email || "Current user"} onSave={saveServiceVisit} canEdit={canEdit} routeReady={loadedRouteKey === routeKey} />}
          {page === "new" && siteDetailId && !siteRecord && <div className="panel section muted">Loading site record...</div>}
          {page === "new" && (!siteDetailId || siteRecord) && (
            <InstallationForm
              refs={refs}
              records={records}
              actorName={profile?.fullName || profile?.email || "Current user"}
              initial={siteRecord}
              fetchAuditEvents={loadInstallationAuditEvents}
              fetchServiceVisits={loadInstallationServiceVisits}
              onAddContractor={addContractorFromRecord}
              onSave={(rec) => {
                const stayOnSite = siteRecord && !navAttempt && !routeNavAttempt;
                return save(rec, navAttempt ?? "installations", stayOnSite ? `/sites/${encodeURIComponent(rec.id)}` : routeNavAttempt);
              }}
              onCancel={() => {
                setEditing(undefined);
                if (routeNavAttempt) navigate(routeNavAttempt, { bypassGuard: true }); else setPage(navAttempt ?? "installations");
                setRouteNavAttempt("");
                setHasUnsavedChanges(false);
                setNavAttempt(null);
              }}
              onDelete={deleteSite}
              setHasUnsavedChanges={setHasUnsavedChanges}
              navAttempt={navAttempt}
              clearNavAttempt={() => { setNavAttempt(null); setRouteNavAttempt(""); }}
              routeNavAttempt={routeNavAttempt}
              readOnly={!canEdit}
            />
          )}
          {page === "import" && <ImportRecords refs={refs} records={records} notify={notify} onSaved={() => refresh({ invalidate: true })} />}
          {page === "settings" && profile?.role === "admin" && <SettingsPage refs={refs} setRefs={setRefs} records={records} profile={profile} referenceSaveState={referenceSaveState} referenceSaveError={referenceSaveError} hasUnsavedReferences={hasUnsavedReferences} saveReferences={saveReferences} discardReferences={() => setRefs(savedRefs)} refreshWorkspace={() => refresh({ invalidate: true })} deleteComponentType={async (type) => { if (hasUnsavedReferences) { notify("Save or discard your pending settings changes before deleting an equipment type."); return; } try { await deleteReferencePermanently("componentType", type.id); await refresh({ invalidate: true }); notify(`${type.name} and its saved equipment entries were deleted.`); } catch (error) { notify(error instanceof Error ? error.message : "Unable to delete component type."); } }} deleteEquipmentField={async (field, label, typeName) => { if (hasUnsavedReferences) { notify("Save or discard your pending settings changes before removing an equipment field."); return false; } try { await deleteReferencePermanently("componentFieldAttachment", field.id); await refresh({ invalidate: true }); notify(`${label} was removed from ${typeName}.`); return true; } catch (error) { notify(error instanceof Error ? error.message : "Unable to remove equipment field."); return false; } }} notify={notify} />}
      {toast && <div className="toast" role="status" aria-live="polite" aria-atomic="true">{toast}</div>}
      {routeNavAttempt && page === "settings" && <div className="modal-backdrop" role="presentation"><div className="modal-panel" role="alertdialog" aria-modal="true" aria-labelledby="leave-settings"><div className="modal-icon"><AlertTriangle size={20} /></div><h2 id="leave-settings">Leave settings without saving?</h2><p className="muted">Your unsaved reference-setting updates will be discarded before you leave Admin Settings.</p><div className="modal-actions"><button type="button" className="button" onClick={() => setRouteNavAttempt("")}>Keep editing</button><button type="button" className="button danger-solid" onClick={() => { setRefs(savedRefs); navigate(routeNavAttempt, { bypassGuard: true }); setRouteNavAttempt(""); }}>Discard changes</button><button type="button" className="button primary" onClick={async () => { if (await saveReferences()) { navigate(routeNavAttempt, { bypassGuard: true }); setRouteNavAttempt(""); } }}>Save and leave</button></div></div></div>}
    </>
  );
}

function RouteLoading({ pathname }: { pathname: string }) {
  const family = pathname === "/dashboard" ? "dashboard" : pathname === "/sites" || pathname === "/service-visits" ? "table" : pathname.startsWith("/admin/") ? "settings" : "form";
  return <div className={`route-loading route-loading-${family}`} aria-label="Loading page content" aria-live="polite" aria-busy="true"><div className="route-loading-head" /><div className="route-loading-copy" /><div className="route-loading-body"><span /><span /><span /><span /></div></div>;
}
function SetupRequired() { return <div className="login"><div className="login-card"><div className="brand-mark login-mark"><RadioTower size={22} /></div><h1>Supabase setup required</h1><p className="muted" style={{ marginTop: 9 }}>Add the hosted project values from <code>.env.example</code> to <code>.env.local</code>, apply the migrations, then restart FieldTrack.</p></div></div>; }
function PasswordSetup({ onSave }: { onSave: (password: string) => Promise<void> }) {
  const [password, setPasswordValue] = useState(""); const [confirm, setConfirm] = useState(""); const [submitting, setSubmitting] = useState(false); const [message, setMessage] = useState("");
  return <div className="login"><form className="login-card" onSubmit={async (e) => { e.preventDefault(); setMessage(""); if (password.length < 8) { setMessage("Use at least 8 characters."); return; } if (password !== confirm) { setMessage("Passwords do not match."); return; } setSubmitting(true); try { await onSave(password); } catch (cause) { setMessage(cause instanceof Error ? cause.message : "Unable to set password."); } finally { setSubmitting(false); } }}>
    <div className="brand-mark login-mark"><RadioTower size={22} /></div>
    <p className="eyebrow">Invitation accepted</p><h1>Set your FieldTrack password</h1>
    <p className="muted" style={{ margin: "8px 0 20px" }}>Choose a password to finish activating your account.</p>
    <div className="stack"><label>New password<input required minLength={8} className="field" type="password" value={password} onChange={(e) => setPasswordValue(e.target.value)} /></label><label>Confirm password<input required minLength={8} className="field" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} /></label>{message && <div className="notice validation-notice inline" role="alert">{message}</div>}<button className="button primary" type="submit" disabled={submitting}>{submitting ? "Saving password..." : "Set password"}</button></div>
  </form></div>;
}
export function ChangeDisplayNameModal({ currentName, onClose, onSave }: { currentName: string; onClose: () => void; onSave: (fullName: string) => Promise<void> }) {
  const [fullName, setFullName] = useState(currentName); const [confirming, setConfirming] = useState(false); const [submitting, setSubmitting] = useState(false); const [message, setMessage] = useState("");
  const trimmedName = fullName.trim();
  async function save() { setSubmitting(true); setMessage(""); try { await onSave(trimmedName); } catch (cause) { setMessage(cause instanceof Error ? cause.message : "Unable to update your name."); setConfirming(false); } finally { setSubmitting(false); } }
  return <div className="modal-backdrop" role="presentation"><form className="modal-panel" role="dialog" aria-modal="true" aria-labelledby="change-display-name-title" onSubmit={(e) => { e.preventDefault(); setMessage(""); if (!trimmedName) { setMessage("Enter your display name."); return; } if (trimmedName === currentName) { onClose(); return; } if (confirming) void save(); else setConfirming(true); }}>
    <div className="modal-header"><div><h2 id="change-display-name-title">{confirming ? "Confirm display name change?" : "Change display name"}</h2><p className="muted">{confirming ? <>Your name will appear as <strong>{trimmedName}</strong> in FieldTrack and future activity.</> : "Use the name your team should see on records and activity."}</p></div><button type="button" className="button icon-button ghost" aria-label="Close display name form" onClick={onClose}><X size={17} /></button></div>
    {!confirming && <label>Display name<input autoFocus required className="field" value={fullName} onChange={(e) => setFullName(e.target.value)} /></label>}
    {message && <div className="notice validation-notice inline" role="alert">{message}</div>}
    <div className="modal-actions"><button type="button" className="button" onClick={() => confirming ? setConfirming(false) : onClose()}>{confirming ? "Back" : "Cancel"}</button><button className="button primary" disabled={submitting}>{submitting ? "Saving name..." : confirming ? "Confirm name change" : "Continue"}</button></div>
  </form></div>;
}
export function ChangePasswordModal({ onClose, onSave }: { onClose: () => void; onSave: (currentPassword: string, password: string) => Promise<void> }) {
  const [currentPassword, setCurrentPassword] = useState(""); const [password, setPassword] = useState(""); const [confirm, setConfirm] = useState(""); const [confirming, setConfirming] = useState(false); const [submitting, setSubmitting] = useState(false); const [message, setMessage] = useState("");
  async function save() { setSubmitting(true); setMessage(""); try { await onSave(currentPassword, password); } catch (cause) { setMessage(cause instanceof Error ? cause.message : "Unable to change your password."); setConfirming(false); } finally { setSubmitting(false); } }
  return <div className="modal-backdrop" role="presentation"><form className="modal-panel" role="dialog" aria-modal="true" aria-labelledby="change-password-title" onSubmit={(e) => { e.preventDefault(); setMessage(""); if (password.length < 8) { setMessage("Use at least 8 characters."); return; } if (password !== confirm) { setMessage("Passwords do not match."); return; } if (confirming) void save(); else setConfirming(true); }}>
    <div className="modal-header"><div><h2 id="change-password-title">{confirming ? "Confirm password change?" : "Change password"}</h2><p className="muted">{confirming ? "Your current password will stop working immediately after this change." : "Enter your current password, then choose a new one."}</p></div><button type="button" className="button icon-button ghost" aria-label="Close password form" onClick={onClose}><X size={17} /></button></div>
    {!confirming && <div className="stack"><label>Current password<input autoFocus required className="field" type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} /></label><label>New password<input required minLength={8} className="field" type="password" value={password} onChange={(e) => setPassword(e.target.value)} /></label><label>Confirm new password<input required minLength={8} className="field" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} /></label></div>}
    {message && <div className="notice validation-notice inline" role="alert">{message}</div>}
    <div className="modal-actions"><button type="button" className="button" onClick={() => confirming ? setConfirming(false) : onClose()}>{confirming ? "Back" : "Cancel"}</button><button className="button primary" disabled={submitting}>{submitting ? "Changing password..." : confirming ? "Confirm password change" : "Continue"}</button></div>
  </form></div>;
}
export function ConfirmLogoutModal({ hasUnsavedChanges, onClose, onConfirm }: { hasUnsavedChanges?: boolean; onClose: () => void; onConfirm: () => Promise<void> }) {
  const [submitting, setSubmitting] = useState(false); const [message, setMessage] = useState("");
  return <div className="modal-backdrop" role="presentation"><div className="modal-panel" role="dialog" aria-modal="true" aria-labelledby="log-out-title"><div className="modal-icon"><LogOut size={18} /></div><h2 id="log-out-title">Log out of FieldTrack?</h2><p className="muted">{hasUnsavedChanges ? "Your unsaved reference-setting updates will be discarded when you log out." : "You will need to enter your email address and password to sign in again."}</p>{message && <div className="notice validation-notice inline" role="alert">{message}</div>}<div className="modal-actions"><button type="button" className="button" onClick={onClose}>Stay signed in</button><button type="button" className="button danger-solid" disabled={submitting} onClick={async () => { setSubmitting(true); setMessage(""); try { await onConfirm(); } catch (cause) { setMessage(cause instanceof Error ? cause.message : "Unable to log out."); setSubmitting(false); } }}>{submitting ? "Logging out..." : "Log out"}</button></div></div></div>;
}
function Login({ onLogin, onReset, error }: { onLogin: (email: string, password: string) => Promise<void>; onReset: (email: string) => Promise<void>; error?: string }) {
  const [email, setEmail] = useState(""); const [password, setPassword] = useState(""); const [submitting, setSubmitting] = useState(false); const [message, setMessage] = useState(error || "");
  return <div className="login"><form className="login-card" onSubmit={async (e) => { e.preventDefault(); setSubmitting(true); setMessage(""); try { await onLogin(email, password); } catch (cause) { setMessage(cause instanceof Error ? cause.message : "Unable to sign in."); } finally { setSubmitting(false); } }}>
    <div className="brand-mark login-mark"><RadioTower size={22} /></div>
    <p className="eyebrow">Workplace operations</p><h1>Sign in to FieldTrack</h1>
    <p className="muted" style={{ margin: "8px 0 20px" }}>Manage sites, deployed equipment, and contractor visits.</p>
    <div className="stack"><label>Email address<input required className="field" type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></label><label>Password<input required className="field" type="password" value={password} onChange={(e) => setPassword(e.target.value)} /></label>{message && <div className="notice validation-notice inline" role="alert">{message}</div>}<button className="button primary" type="submit" disabled={submitting}>{submitting ? "Signing in..." : "Sign in"}</button><button className="button ghost" type="button" disabled={submitting || !email.trim()} onClick={async () => { setSubmitting(true); setMessage(""); try { await onReset(email.trim()); setMessage("Password setup email sent. Open the link to choose your password."); } catch (cause) { setMessage(cause instanceof Error ? cause.message : "Unable to send password setup email."); } finally { setSubmitting(false); } }}>Set or reset password</button></div>
  </form></div>;
}

function DateRangeFilter({ from, to, minDate, maxDate, onChange, ariaLabel }: { from: string; to: string; minDate: string; maxDate: string; onChange: (range: { from: string; to: string }) => void; ariaLabel: string }) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const pickerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  useEscape(() => setOpen(false), open);

  const minTs = minDate ? new Date(minDate).getTime() : 0;
  const maxTs = maxDate ? new Date(maxDate).getTime() : minTs;
  const tsRange = maxTs - minTs || 1;
  const fromTs = from ? new Date(from).getTime() : minTs;
  const toTs = to ? new Date(to).getTime() : maxTs;
  const fromPct = Math.round(((fromTs - minTs) / tsRange) * 100);
  const toPct = Math.round(((toTs - minTs) / tsRange) * 100);
  function tsToDate(ts: number) { return new Date(ts).toISOString().split("T")[0]; }

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) { if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) setOpen(false); }
    function closePicker() { setOpen(false); }
    document.addEventListener("mousedown", onDown);
    window.addEventListener("resize", closePicker);
    window.addEventListener("scroll", closePicker, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("resize", closePicker);
      window.removeEventListener("scroll", closePicker, true);
    };
  }, [open]);

  function togglePicker() {
    if (!open && triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      setPosition({ top: rect.bottom + 6, left: Math.max(12, Math.min(rect.left, window.innerWidth - 312)) });
    }
    setOpen(!open);
  }

  return <div className="drp-wrap" ref={pickerRef}>
    <button type="button" className="drp-trigger" ref={triggerRef} aria-expanded={open} aria-label={ariaLabel} onClick={togglePicker}>
      <CalendarRange size={15} />
      <span>{from || minDate || "Start"}</span>
      <span className="drp-sep">-</span>
      <span>{to || maxDate || "End"}</span>
    </button>
    {open && <div className="drp-panel" role="dialog" aria-label="Date range picker" style={position}>
      <div className="drp-heading">Time Range</div>
      <div className="drp-field">
        <div className="drp-label-row"><span className="drp-label from">From</span><input type="date" className="drp-date-input" aria-label="From date" value={from} min={minDate} max={to || maxDate} disabled={!minDate || !maxDate} onChange={(e) => onChange({ from: e.target.value, to })} /></div>
        <input type="range" className="drp-slider drp-slider-from" aria-label="From date slider" min={0} max={100} value={fromPct} disabled={!minDate || !maxDate} style={{ "--drp-pct": `${fromPct}%` } as React.CSSProperties} onChange={(e) => { const date = tsToDate(minTs + (Number(e.target.value) / 100) * tsRange); if (!to || date <= to) onChange({ from: date, to }); }} />
      </div>
      <div className="drp-field">
        <div className="drp-label-row"><span className="drp-label to">To</span><input type="date" className="drp-date-input" aria-label="To date" value={to} min={from || minDate} max={maxDate} disabled={!minDate || !maxDate} onChange={(e) => onChange({ from, to: e.target.value })} /></div>
        <input type="range" className="drp-slider drp-slider-to" aria-label="To date slider" min={0} max={100} value={toPct} disabled={!minDate || !maxDate} style={{ "--drp-pct": `${toPct}%` } as React.CSSProperties} onChange={(e) => { const date = tsToDate(minTs + (Number(e.target.value) / 100) * tsRange); if (!from || date >= from) onChange({ from, to: date }); }} />
      </div>
    </div>}
  </div>;
}

function FilterBar({ records, refs, filters, setFilters, compact = false }: { records: Installation[]; refs: ReferenceData; filters: Filter; setFilters: (f: Filter) => void; compact?: boolean }) {
  const [advanced, setAdvanced] = useState(false);
  const [savedViews, setSavedViews] = useState<SavedSiteFilter[]>(() => {
    if (typeof window === "undefined") return [];
    try { return JSON.parse(localStorage.getItem(savedSiteFiltersKey) || "[]") as SavedSiteFilter[]; } catch { return []; }
  });
  const [savingView, setSavingView] = useState(false);
  const [viewName, setViewName] = useState("");
  const installDates = records.map((record) => record.installDate).filter(Boolean);
  const minDate = installDates.length ? installDates.reduce((a, b) => (a < b ? a : b)) : "";
  const maxDate = installDates.length ? installDates.reduce((a, b) => (a > b ? a : b)) : "";
  const uniqueLocations = <T extends { code: string }>(items: T[]) => Array.from(new Map(items.map((item) => [item.code, item])).values());
  const availableIslandGroups = Array.from(new Set(records.map((record) => record.islandGroup).filter(Boolean)));
  const updatedByOptions = Array.from(new Set(records.map((record) => record.updatedBy).filter(Boolean))).sort((a, b) => a.localeCompare(b));
  const regions = uniqueLocations(records.filter((record) => !filters.islandGroup || record.islandGroup === filters.islandGroup).map((record) => ({ code: record.regionCode, name: record.region })));
  const provinces = uniqueLocations(records.filter((record) => (!filters.islandGroup || record.islandGroup === filters.islandGroup) && (!filters.regionCode || record.regionCode === filters.regionCode)).map((record) => ({ code: record.provinceCode, name: record.province })));
  const municipalities = uniqueLocations(records.filter((record) => (!filters.islandGroup || record.islandGroup === filters.islandGroup) && (!filters.regionCode || record.regionCode === filters.regionCode) && (!filters.provinceCode || record.provinceCode === filters.provinceCode)).map((record) => ({ code: record.municipalityCode, name: record.municipality })));
  const barangays = uniqueLocations(records.filter((record) => record.barangayCode && (!filters.islandGroup || record.islandGroup === filters.islandGroup) && (!filters.regionCode || record.regionCode === filters.regionCode) && (!filters.provinceCode || record.provinceCode === filters.provinceCode) && (!filters.municipalityCode || record.municipalityCode === filters.municipalityCode)).map((record) => ({ code: record.barangayCode, name: record.barangay })));
  const activeLocationCount = [filters.islandGroup, filters.regionCode, filters.provinceCode, filters.municipalityCode, filters.barangayCode].filter(Boolean).length;
  const active = filters.search || filters.status || filters.contractor || filters.updatedBy || activeLocationCount || filters.from || filters.to || filters.attention;
  function persistSavedViews(next: SavedSiteFilter[]) {
    setSavedViews(next);
    localStorage.setItem(savedSiteFiltersKey, JSON.stringify(next));
  }
  function saveCurrentView(event: FormEvent) {
    event.preventDefault();
    const name = viewName.trim();
    if (!name || !active) return;
    persistSavedViews([...savedViews.filter((view) => view.name.localeCompare(name, undefined, { sensitivity: "base" }) !== 0), { id: uuid(), name, filters }]);
    setViewName("");
    setSavingView(false);
  }
  const locationFilters = <>
    <select className="select" aria-label="Filter sites by island group" value={filters.islandGroup} onChange={(e) => setFilters({ ...filters, islandGroup: e.target.value, regionCode: "", provinceCode: "", municipalityCode: "", barangayCode: "" })}><option value="">All island groups</option>{availableIslandGroups.map((group) => <option key={group}>{group}</option>)}</select>
    <select className="select" aria-label="Filter sites by region" value={filters.regionCode} onChange={(e) => setFilters({ ...filters, regionCode: e.target.value, provinceCode: "", municipalityCode: "", barangayCode: "" })}><option value="">All regions</option>{regions.map((region) => <option value={region.code} key={region.code}>{region.name}</option>)}</select>
    <select className="select" aria-label="Filter sites by province" value={filters.provinceCode} onChange={(e) => setFilters({ ...filters, provinceCode: e.target.value, municipalityCode: "", barangayCode: "" })} disabled={!filters.regionCode}><option value="">All provinces</option>{provinces.map((province) => <option value={province.code} key={province.code}>{province.name}</option>)}</select>
    <select className="select" aria-label="Filter sites by locality" value={filters.municipalityCode} onChange={(e) => setFilters({ ...filters, municipalityCode: e.target.value, barangayCode: "" })} disabled={!filters.provinceCode}><option value="">All localities</option>{municipalities.map((municipality) => <option value={municipality.code} key={municipality.code}>{municipality.name}</option>)}</select>
    <select className="select" aria-label="Filter sites by barangay" value={filters.barangayCode} onChange={(e) => setFilters({ ...filters, barangayCode: e.target.value })} disabled={!filters.municipalityCode}><option value="">All barangays</option>{barangays.map((barangay) => <option value={barangay.code} key={barangay.code}>{barangay.name}</option>)}</select>
  </>;
  return <div className="filter-stack">
    <div className="toolbar filter-row">
      <div className="input-wrap"><Search className="input-icon" size={17} /><input className="field search" data-site-search="true" aria-label="Search sites" value={filters.search} onChange={(e) => setFilters({ ...filters, search: e.target.value })} placeholder="Search site, school ID, or location" /></div>
      <select className="select" aria-label="Filter sites by contractor" value={filters.contractor} onChange={(e) => setFilters({ ...filters, contractor: e.target.value })}><option value="">All contractors</option>{refs.contractors.map((c) => <option key={c.id}>{c.name}</option>)}</select>
      <select className="select updated-by-filter" aria-label="Filter sites by updated by" value={filters.updatedBy} onChange={(e) => setFilters({ ...filters, updatedBy: e.target.value })}><option value="">Updated by</option>{updatedByOptions.map((name) => <option key={name}>{name}</option>)}</select>
      {savedViews.length > 0 && <select className="select saved-view-select" aria-label="Apply saved site filter" value="" onChange={(event) => { const view = savedViews.find((item) => item.id === event.target.value); if (view) setFilters(sanitizeSiteFilter(view.filters, records, refs)); }}><option value="">Saved views</option>{savedViews.map((view) => <option value={view.id} key={view.id}>{view.name}</option>)}</select>}
      {compact ? <button type="button" className={`button advanced-filter-trigger ${advanced || activeLocationCount ? "active" : ""}`} aria-expanded={advanced} onClick={() => setAdvanced((open) => !open)}>Advanced filters{activeLocationCount > 0 && <span>{activeLocationCount}</span>}<ChevronDown size={14} /></button> : locationFilters}
      {active && <div className="filter-actions"><button type="button" className="button ghost filter-action-button" onClick={() => setSavingView((open) => !open)}>Save view</button><button type="button" className="button ghost filter-action-button filter-clear-button" onClick={() => setFilters(emptyFilter)}><X size={15} />Clear</button></div>}
    </div>
    {savingView && <form className="toolbar saved-filter-row" onSubmit={saveCurrentView}><input className="field" value={viewName} onChange={(event) => setViewName(event.target.value)} placeholder="Name this filter view" autoFocus /><button className="button primary">Save view</button><button type="button" className="button ghost" onClick={() => { setSavingView(false); setViewName(""); }}>Cancel</button></form>}
    {compact && advanced && <div className="toolbar filter-row advanced-filter-row">{locationFilters}</div>}
    {filters.attention && <div className="active-queue-filter"><strong>{filters.attention === "missingName" ? "Queue: imported sites missing names" : "Queue: old kit numbers awaiting assignment"}</strong><button type="button" className="button ghost" onClick={() => setFilters({ ...filters, attention: "" })}><X size={14} />Clear queue</button></div>}
    <div className="status-filter-row" role="group" aria-label="Filter sites by status">
      <div className="status-filter-pills">
        <button type="button" className={`button status-filter-pill ${!filters.status ? "active" : ""}`} aria-pressed={!filters.status} onClick={() => setFilters({ ...filters, status: "" })}>All sites</button>
        {siteStatusOptions(refs, filters.status as Status).map((status) => <button type="button" className={`button status-filter-pill ${filters.status === status.value ? "active" : ""}`} aria-pressed={filters.status === status.value} key={status.value} onClick={() => setFilters({ ...filters, status: status.value })}><span className="status-dot" aria-hidden="true" style={{ background: siteStatusColor(status.value) }} />{status.name}</button>)}
      </div>
      <DateRangeFilter from={filters.from} to={filters.to} minDate={minDate} maxDate={maxDate} onChange={(range) => setFilters({ ...filters, ...range })} ariaLabel="Filter sites by installation date" />
    </div>
  </div>;
}

function Dashboard({ records, allRecords, refs, filters, setFilters, setPage, canEdit }: { records: Installation[]; allRecords: Installation[]; refs: ReferenceData; filters: Filter; setFilters: (f: Filter) => void; setPage: (p: Page) => void; canEdit: boolean }) {
  const [showAllContractors, setShowAllContractors] = useState(false);
  const counts = siteStatusOptions(refs, filters.status as Status).map((status) => ({ status: status.value, label: status.name, count: records.filter((r) => r.status === status.value).length }));
  const contractors = refs.contractors.map(({ name }) => ({ name, count: records.filter((r) => r.contractor === name).length })).filter(({ count }) => count > 0).sort((a,b) => b.count-a.count || a.name.localeCompare(b.name));
  const visibleContractors = showAllContractors ? contractors : contractors.slice(0, 5);
  const max = Math.max(...contractors.map((c) => c.count), 1);
  return <>
    <div className="page-head"><div><p className="eyebrow">Overview</p><h1>Site dashboard</h1><p className="muted">Track site activity and review records that need follow-up.</p></div>{canEdit && <button className="button primary" onClick={() => setPage("new")}><Plus size={16} />Add site</button>}</div>
    <div className="stats status-stats" style={{ "--status-count": String(Math.max(counts.length, 1)) } as React.CSSProperties}>{counts.map(({ status, label, count }) => <button type="button" className="stat stat-button" key={status} onClick={() => { setFilters({ ...filters, status }); setPage("installations"); }}><span className="small muted">{label}</span><span className="stat-value">{count}<span className="status-dot" aria-hidden="true" style={{ background: siteStatusColor(status) }} /></span></button>)}</div>
    <div style={{ marginBottom: 16 }}><FilterBar records={allRecords} refs={refs} filters={filters} setFilters={setFilters} compact /></div>
    <div className="two-pane">
      <div className="panel"><div className="panel-head"><div><h2>Latest installations</h2><div className="small muted">{records.length} matching records</div></div><button className="button ghost" onClick={() => setPage("installations")}>View all sites</button></div><RecordsTable records={records.slice(0, 6)} /></div>
      <div className="panel"><div className="panel-head"><div><h2>By contractor</h2><div className="small muted">Current filtered distribution</div></div><BarChart3 size={18} className="muted" /></div>{contractors.length ? <div className="section contractor-distribution">{visibleContractors.map((c) => <div className="bar-row" key={c.name}><span className="small contractor-name" title={c.name}>{c.name}</span><span className="bar"><span style={{ width: `${(c.count/max)*100}%` }} /></span><strong>{c.count}</strong></div>)}{contractors.length > 5 && <button type="button" className="button ghost contractor-expand" onClick={() => setShowAllContractors((show) => !show)}>{showAllContractors ? "Show top contractors" : `Show all ${contractors.length} contractors`}</button>}</div> : <div className="empty contractor-empty"><BarChart3 size={22} /><p><strong>No contractor activity matches these filters.</strong></p><span>Adjust the filters to view the distribution.</span></div>}</div>
    </div>
    <div className="attention-list">
      {allRecords.some((r) => r.status === "issue") && <div className="notice attention-row"><div><strong>{allRecords.filter((r) => r.status === "issue").length} {allRecords.filter((r) => r.status === "issue").length === 1 ? "site needs" : "sites need"} attention.</strong><div className="small">Review the next action for each issue record.</div></div><button type="button" className="button" onClick={() => { setFilters({ ...emptyFilter, status: "issue" }); setPage("installations"); }}>Review issue sites</button></div>}
      {allRecords.some((r) => !r.siteName) && <div className="notice attention-row"><div><strong>{allRecords.filter((r) => !r.siteName).length} imported sites still need names.</strong><div className="small">Assign a unique site name to complete each record.</div></div><button type="button" className="button" onClick={() => { setFilters({ ...emptyFilter, attention: "missingName" }); setPage("installations"); }}>{canEdit ? "Name imported sites" : "Review imported sites"}</button></div>}
      {allRecords.some((r) => r.legacyKitNumber) && <div className="notice attention-row"><div><strong>{allRecords.filter((r) => r.legacyKitNumber).length} old kit numbers need equipment assignments.</strong><div className="small">Assign each saved kit number to the correct equipment.</div></div><button type="button" className="button" onClick={() => { setFilters({ ...emptyFilter, attention: "legacyKit" }); setPage("installations"); }}>{canEdit ? "Assign kit numbers" : "Review kit assignments"}</button></div>}
    </div>
  </>;
}

function Installations({ records, allRecords, refs, filters, setFilters, startEdit, setPage, canEdit, onBulkUpdate }: { records: Installation[]; allRecords: Installation[]; refs: ReferenceData; filters: Filter; setFilters: (f: Filter) => void; startEdit: (r: Installation) => void; setPage: (p: Page) => void; canEdit: boolean; onBulkUpdate: (ids: string[], changes: { status?: Status; contractor?: string }) => Promise<void> }) {
  return <>
    <div className="page-head"><div><p className="eyebrow">Registry</p><h1>Sites</h1><p className="muted">Find a site record and review its deployed equipment.</p></div><div className="toolbar"><button className="button" onClick={() => downloadCsv(records, refs)}><Download size={16} />Export CSV</button><button className="button" onClick={async () => downloadXlsx(await loadInstallationValidationRecords(), refs)}><FileSpreadsheet size={16} />Export XLSX</button>{canEdit && <button className="button primary" onClick={() => setPage("new")}><Plus size={16} />Add site</button>}</div></div>
    <div className="shortcut-hint small muted">Shortcuts: Ctrl+K search, Alt+N new site, Ctrl+S save changes.</div>
    <div style={{ marginBottom: 16 }}><FilterBar records={allRecords} refs={refs} filters={filters} setFilters={setFilters} compact /></div>
    <div className="panel"><div className="panel-head"><strong>{records.length} records</strong></div><RecordsTable key={JSON.stringify(filters)} records={records} refs={refs} onSelect={startEdit} detailed canEdit={canEdit} onBulkUpdate={onBulkUpdate} /></div>
  </>;
}

type SiteSortKey = "siteName" | "id" | "islandGroup" | "location" | "unitType" | "contractor" | "installDate" | "status" | "equipment" | "updatedBy";
function SiteSortHeader({ label, column, sortable, sort, onSort }: { label: string; column: SiteSortKey; sortable: boolean; sort?: { key: SiteSortKey; direction: "asc" | "desc" }; onSort: (key: SiteSortKey) => void }) {
  if (!sortable) return <th>{label}</th>;
  const active = sort?.key === column;
  return <th aria-sort={active ? sort.direction === "asc" ? "ascending" : "descending" : "none"}><button type="button" className={`table-sort ${active ? "active" : ""}`} onClick={() => onSort(column)}>{label}{active && sort.direction === "desc" ? <ArrowDownAZ size={14} /> : <ArrowUpAZ size={14} />}</button></th>;
}
function RecordsTable({ records, refs, onSelect, detailed = false, canEdit = true, onBulkUpdate }: { records: Installation[]; refs?: ReferenceData; onSelect?: (r: Installation) => void; detailed?: boolean; canEdit?: boolean; onBulkUpdate?: (ids: string[], changes: { status?: Status; contractor?: string }) => Promise<void> }) {
  const [sort, setSort] = useState<{ key: SiteSortKey; direction: "asc" | "desc" }>();
  const [page, setPage] = useState(1);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [bulkStatus, setBulkStatus] = useState("");
  const [bulkContractor, setBulkContractor] = useState("");
  const [bulkSaving, setBulkSaving] = useState(false);
  const sortable = detailed;
  const pageSize = 20;
  const sortedRecords = useMemo(() => {
    if (!sort) return records;
    const read = (record: Installation) => sort.key === "location" ? `${record.barangay} ${record.municipality}` : sort.key === "equipment" ? record.components.length : record[sort.key];
    return records.map((record, index) => ({ record, index })).sort((a, b) => {
      const left = read(a.record); const right = read(b.record);
      const compared = typeof left === "number" && typeof right === "number" ? left - right : String(left ?? "").localeCompare(String(right ?? ""), undefined, { numeric: true, sensitivity: "base" });
      return (sort.direction === "asc" ? compared : -compared) || a.index - b.index;
    }).map(({ record }) => record);
  }, [records, sort]);
  const pageCount = Math.max(1, Math.ceil(sortedRecords.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const visibleRecords = detailed ? sortedRecords.slice((currentPage - 1) * pageSize, currentPage * pageSize) : sortedRecords;
  const firstVisible = sortedRecords.length ? (currentPage - 1) * pageSize + 1 : 0;
  const lastVisible = Math.min(currentPage * pageSize, sortedRecords.length);
  const selectable = detailed && canEdit && Boolean(onBulkUpdate);
  const validSelectedIds = selectedIds.filter((id) => records.some((record) => record.id === id));
  const visibleIds = visibleRecords.map((record) => record.id);
  const selectedRecords = sortedRecords.filter((record) => validSelectedIds.includes(record.id));
  const visibleSelected = visibleIds.length > 0 && visibleIds.every((id) => validSelectedIds.includes(id));
  function toggleSort(key: SiteSortKey) { if (!sortable) return; setPage(1); setSort((current) => current?.key === key ? { key, direction: current.direction === "asc" ? "desc" : "asc" } : { key, direction: "asc" }); }
  function toggleVisibleRows(checked: boolean) { setSelectedIds((current) => checked ? Array.from(new Set([...current, ...visibleIds])) : current.filter((id) => !visibleIds.includes(id))); }
  async function applyBulkUpdate() {
    if (!onBulkUpdate || !selectedRecords.length || (!bulkStatus && !bulkContractor)) return;
    setBulkSaving(true);
    try {
      await onBulkUpdate(selectedRecords.map((record) => record.dbId).filter(Boolean) as string[], { status: bulkStatus as Status || undefined, contractor: bulkContractor || undefined });
      setSelectedIds([]); setBulkStatus(""); setBulkContractor("");
    } catch { } finally { setBulkSaving(false); }
  }
  if (!records.length) return <div className="empty"><ClipboardList size={25} /><p><strong>No sites match these filters.</strong></p><span>{canEdit ? "Clear a filter or add a site record." : "Clear a filter or ask a staff user to add a site record."}</span></div>;
  const sortHeader = (label: string, column: SiteSortKey) => <SiteSortHeader label={label} column={column} sortable={sortable} sort={sort} onSort={toggleSort} />;
  return <>{selectable && selectedRecords.length > 0 && <div className="bulk-action-bar" role="region" aria-label="Bulk site actions"><strong>{selectedRecords.length} selected</strong><select className="select" aria-label="Bulk update status" value={bulkStatus} onChange={(event) => setBulkStatus(event.target.value)}><option value="">Keep status</option>{siteStatusOptions(refs).map((status) => <option value={status.value} key={status.value}>{status.name}</option>)}</select><select className="select" aria-label="Bulk update contractor" value={bulkContractor} onChange={(event) => setBulkContractor(event.target.value)}><option value="">Keep contractor</option>{(refs?.contractors ?? []).filter((contractor) => contractor.active || selectedRecords.some((record) => record.contractor === contractor.name)).map((contractor) => <option key={contractor.id}>{contractor.name}</option>)}</select><button type="button" className="button primary" disabled={bulkSaving || (!bulkStatus && !bulkContractor)} onClick={() => void applyBulkUpdate()}>{bulkSaving ? "Updating..." : "Apply changes"}</button><button type="button" className="button ghost" disabled={bulkSaving} onClick={() => setSelectedIds([])}>Clear selection</button></div>}<div className={`table-wrap ${detailed ? "sites-table-wrap" : ""}`}><table className={detailed ? "sites-table" : undefined}><thead><tr>{selectable && <th><input type="checkbox" aria-label="Select visible site rows" checked={visibleSelected} onChange={(event) => toggleVisibleRows(event.target.checked)} /></th>}{sortHeader("Site name", "siteName")}{sortHeader("School ID", "id")}{detailed && sortHeader("Island group", "islandGroup")}{sortHeader("Location", "location")}{detailed && sortHeader("Solution", "unitType")}{sortHeader("Contractor", "contractor")}{sortHeader("Installation date", "installDate")}{sortHeader("Status", "status")}{sortHeader("Equipment", "equipment")}{detailed && sortHeader("Updated by", "updatedBy")}{onSelect && <th><span className="sr-only">Actions</span></th>}</tr></thead><tbody>{visibleRecords.map((r) => <tr key={r.id} role={onSelect ? "button" : undefined} tabIndex={onSelect ? 0 : undefined} aria-label={onSelect ? `Open site ${r.siteName || r.id}` : undefined} onClick={() => onSelect?.(r)} onKeyDown={(event) => onSelect && handleRowKeyboard(event, () => onSelect(r))} style={{ cursor: onSelect ? "pointer" : "default" }}>{selectable && <td onClick={(event) => event.stopPropagation()}><input type="checkbox" aria-label={`Select ${r.siteName || r.id}`} checked={validSelectedIds.includes(r.id)} onChange={(event) => setSelectedIds((current) => event.target.checked ? [...current, r.id] : current.filter((id) => id !== r.id))} /></td>}<td>{r.siteName || <span className="pill issue">Site name required</span>}</td><td><strong>{r.id}</strong></td>{detailed && <td>{r.islandGroup || "None"}</td>}<td>{locationLabel(r)}</td>{detailed && <td>{r.unitType}</td>}<td>{r.contractor}</td><td>{niceDate(r.installDate)}</td><td><StatusPill status={r.status} refs={refs} /></td><td>{r.components.length}</td>{detailed && <td>{r.updatedBy}</td>}{onSelect && <td><button type="button" className="button icon-button ghost" aria-label={`View ${r.siteName || r.id}`} onClick={(event) => { event.stopPropagation(); onSelect(r); }}><ChevronRight size={16} /></button></td>}</tr>)}</tbody></table></div>{detailed && <div className="pagination"><span className="small muted">Showing {firstVisible}-{lastVisible} of {sortedRecords.length} records | {pageSize} rows per page</span><div className="toolbar"><button type="button" className="button icon-button" aria-label="Previous page" disabled={currentPage === 1} onClick={() => setPage((current) => Math.max(1, current - 1))}><ChevronLeft size={16} /></button><span className="pagination-page small">Page {currentPage} of {pageCount}</span><button type="button" className="button icon-button" aria-label="Next page" disabled={currentPage === pageCount} onClick={() => setPage((current) => Math.min(pageCount, current + 1))}><ChevronRight size={16} /></button></div></div>}</>;
}

function ServiceVisitsPage({ records, refs, actorName, onSave, canEdit, routeReady }: { records: Installation[]; refs: ReferenceData; actorName: string; onSave: (installationId: string, visit: ServiceVisit, components: Component[]) => Promise<boolean | undefined>; canEdit: boolean; routeReady: boolean }) {
  const router = useRouter();
  const navigate = useGuardedNavigation();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const allDates = records.flatMap((r) => r.serviceVisits.map((v) => v.scheduledDate)).filter(Boolean);
  const minDate = allDates.length ? allDates.reduce((a, b) => (a < b ? a : b)) : "";
  const maxDate = allDates.length ? allDates.reduce((a, b) => (a > b ? a : b)) : "";
  const serviceFilterParams = searchParams.toString();
  const filters = useMemo(() => {
    const next = serviceVisitFilterFromSearchParams(new URLSearchParams(serviceFilterParams), minDate, maxDate);
    if (next.status && !Object.hasOwn(serviceStatusLabels, next.status)) next.status = "";
    if (next.type && !refs.serviceVisitTypes.some((item) => item.name === next.type)) next.type = "";
    if (next.contractor && !refs.contractors.some((item) => item.name === next.contractor)) next.contractor = "";
    return next;
  }, [maxDate, minDate, refs.contractors, refs.serviceVisitTypes, serviceFilterParams]);
  const setFilters = useCallback((next: ServiceVisitFilter) => {
    if (pathname !== "/service-visits") return;
    const query = serviceVisitFilterQuery(next, minDate, maxDate);
    router.replace(`/service-visits${query ? `?${query}` : ""}`, { scroll: false });
  }, [maxDate, minDate, pathname, router]);
  const [newInstallationId, setNewInstallationId] = useState(records[0]?.id ?? "");
  const [siteSearch, setSiteSearch] = useState("");
  const [chooseSite, setChooseSite] = useState(pathname === "/service-visits/new" && !searchParams.get("site"));
  const [advanced, setAdvanced] = useState(false);
  useEscape(() => { setChooseSite(false); setSiteSearch(""); }, chooseSite);
  const visitDetailMatch = pathname.match(/^\/service-visits\/([^/]+)$/);
  const visitDetailId = visitDetailMatch && visitDetailMatch[1] !== "new" ? decodeURIComponent(visitDetailMatch[1]) : "";
  const routeVisit = visitDetailId ? records.flatMap((installation) => installation.serviceVisits.map((visit) => ({ installation, visit }))).find(({ visit }) => visit.id === visitDetailId) : undefined;
  const routeInstallation = pathname === "/service-visits/new" ? records.find((record) => record.id === searchParams.get("site")) : undefined;
  const activeEditing = routeReady ? routeVisit ?? (routeInstallation ? { installation: routeInstallation } : undefined) : undefined;
  const returnTo = safeReturnTo(searchParams.get("returnTo"));

  const matchingVisits = records.flatMap((installation) => installation.serviceVisits.map((visit) => ({ installation, visit }))).filter(({ installation, visit }) =>
    (!filters.search || `${installation.siteName} ${installation.id} ${visit.ticketReference}`.toLowerCase().includes(filters.search.toLowerCase())) &&
    (!filters.type || visit.type === filters.type) && (!filters.contractor || visit.contractor === filters.contractor) &&
    (!filters.from || visit.scheduledDate >= filters.from) && (!filters.to || visit.scheduledDate <= filters.to)
  );
  const visits = matchingVisits.filter(({ visit }) => !filters.status || visit.status === filters.status).sort((a, b) => b.visit.scheduledDate.localeCompare(a.visit.scheduledDate));
  const matchingSites = records.filter((record) => !siteSearch || `${record.siteName} ${record.id} ${record.barangay} ${record.municipality} ${record.province} ${record.contractor}`.toLowerCase().includes(siteSearch.toLowerCase()));
  const counts = (Object.keys(serviceStatusLabels) as ServiceVisitStatus[]).map((status) => ({ status, count: matchingVisits.filter(({ visit }) => visit.status === status).length }));
  const active = filters.search || filters.status || filters.type || filters.contractor || filters.from !== minDate || filters.to !== maxDate;
  function clearFilters() { setFilters({ search: "", status: "", type: "", contractor: "", from: minDate, to: maxDate }); }
  if (activeEditing) return <ServiceVisitModal fullPage readOnly={!canEdit} refs={refs} installation={activeEditing.installation} visit={"visit" in activeEditing ? activeEditing.visit : undefined} actorName={actorName} onClose={(bypassGuard) => navigate(returnTo, { bypassGuard })} onSave={(visit, components) => onSave(activeEditing.installation.id, visit, components)} />;
  if (pathname !== "/service-visits" && !routeReady) return <div className="panel section muted">Loading service visit...</div>;
  return <>
    <div className="page-head"><div><p className="eyebrow">Field support</p><h1>Service visits</h1><p className="muted">Track contractor maintenance, inspections, repairs, and equipment replacements.</p></div>{canEdit && <button className="button primary" onClick={() => navigate("/service-visits/new")}><Plus size={16} />New service visit</button>}</div>
    <div className="stats">{counts.map(({ status, count }) => <button type="button" className={`stat stat-button ${filters.status === status ? "active" : ""}`} aria-pressed={filters.status === status} key={status} onClick={() => setFilters({ ...filters, status: filters.status === status ? "" : status })}><span className="small muted">{serviceStatusLabels[status]}</span><span className="stat-value">{count}<span className="status-dot" aria-hidden="true" style={{ background: status === "completed" ? siteStatusColor("installed") : status === "cancelled" ? siteStatusColor("cancelled") : status === "in_progress" ? siteStatusColor("issue") : siteStatusColor("scheduled") }} /></span></button>)}</div>
    <div className="panel"><div className="section filter-stack"><div className="toolbar filter-row">
      <div className="input-wrap"><Search className="input-icon" size={17} /><input className="field search" aria-label="Search service visits" placeholder="Search site or ticket" value={filters.search} onChange={(e) => setFilters({ ...filters, search: e.target.value })} /></div>
      <select className="select" aria-label="Filter service visits by contractor" value={filters.contractor} onChange={(e) => setFilters({ ...filters, contractor: e.target.value })}><option value="">All contractors</option>{refs.contractors.map((contractor) => <option key={contractor.id}>{contractor.name}</option>)}</select>
      <button type="button" className={`button advanced-filter-trigger ${advanced || filters.type ? "active" : ""}`} aria-expanded={advanced} onClick={() => setAdvanced((open) => !open)}>Advanced filters{filters.type && <span>1</span>}<ChevronDown size={14} /></button>
      {active && <button type="button" className="button ghost" onClick={clearFilters}><X size={16} />Clear</button>}
    </div>
    {advanced && <div className="toolbar filter-row advanced-filter-row"><select className="select" aria-label="Filter service visits by type" value={filters.type} onChange={(e) => setFilters({ ...filters, type: e.target.value })}><option value="">All visit types</option>{refs.serviceVisitTypes.map((type) => <option key={type.id}>{type.name}</option>)}</select></div>}
    <div className="status-filter-row" role="group" aria-label="Filter service visits by status"><div className="status-filter-pills"><button type="button" className={`button status-filter-pill ${!filters.status ? "active" : ""}`} aria-pressed={!filters.status} onClick={() => setFilters({ ...filters, status: "" })}>All visits</button>{(Object.keys(serviceStatusLabels) as ServiceVisitStatus[]).map((status) => <button type="button" className={`button status-filter-pill ${filters.status === status ? "active" : ""}`} aria-pressed={filters.status === status} key={status} onClick={() => setFilters({ ...filters, status })}><span className="status-dot" aria-hidden="true" style={{ background: status === "completed" ? siteStatusColor("installed") : status === "cancelled" ? siteStatusColor("cancelled") : status === "in_progress" ? siteStatusColor("issue") : siteStatusColor("scheduled") }} />{serviceStatusLabels[status]}</button>)}</div><DateRangeFilter from={filters.from} to={filters.to} minDate={minDate} maxDate={maxDate} onChange={(range) => setFilters({ ...filters, ...range })} ariaLabel="Filter service visits by scheduled date" /></div></div>
      <ServiceVisitTable key={JSON.stringify(filters)} visits={visits} onSelect={(_, visit) => navigate(`/service-visits/${encodeURIComponent(visit.id)}`)} />
    </div>
    {chooseSite && <div className="modal-backdrop" role="presentation"><div className="modal-panel" role="dialog" aria-modal="true" aria-labelledby="choose-visit-site"><div className="modal-header"><div><h2 id="choose-visit-site">Choose a site</h2><p className="muted">Search for the site receiving contractor support.</p></div><button type="button" className="button icon-button ghost" aria-label="Close site chooser" onClick={() => { setChooseSite(false); setSiteSearch(""); navigate("/service-visits"); }}><X size={17} /></button></div><label>Search sites<div className="input-wrap"><Search className="input-icon" size={16} /><input autoFocus className="field search" value={siteSearch} onChange={(e) => setSiteSearch(e.target.value)} placeholder="Site name, ID, location, or contractor" /></div></label><div className="site-search-results" style={{ display: "grid", gap: 4, maxHeight: 244, marginTop: 10, padding: 4, overflowY: "auto", border: "1px solid var(--line)", borderRadius: 8, background: "var(--surface-muted)" }} role="listbox" aria-label="Matching sites">{matchingSites.length ? matchingSites.map((record) => { const selected = record.id === newInstallationId; return <div className={`site-search-result ${selected ? "selected" : ""}`} style={{ display: "grid", justifyContent: "stretch", gap: 3, width: "100%", minHeight: 0, padding: "9px 10px", borderColor: selected ? "oklch(0.76 0.06 164)" : "transparent", background: selected ? "var(--accent-soft)" : "transparent", textAlign: "left" }} role="option" aria-selected={selected} tabIndex={0} key={record.id} onClick={() => setNewInstallationId(record.id)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setNewInstallationId(record.id); } }}><strong>{record.siteName || "Site name required"}</strong><span>{record.id} | {locationLabel(record)}</span></div>; }) : <div className="site-search-empty">No sites match your search.</div>}</div><div className="modal-actions"><button type="button" className="button" onClick={() => { setChooseSite(false); setSiteSearch(""); navigate("/service-visits"); }}>Cancel</button><button type="button" className="button primary" disabled={!matchingSites.some((record) => record.id === newInstallationId)} onClick={() => { const installation = records.find((record) => record.id === newInstallationId); if (installation) { setChooseSite(false); setSiteSearch(""); router.replace(`/service-visits/new?site=${encodeURIComponent(installation.id)}`); } }}><Plus size={15} />Continue</button></div></div></div>}
  </>;
}

function ServiceVisitTable({ visits, onSelect }: { visits: { installation: Installation; visit: ServiceVisit }[]; onSelect?: (installation: Installation, visit: ServiceVisit) => void }) {
  const [page, setPage] = useState(1);
  const pageSize = 20;
  const pageCount = Math.max(1, Math.ceil(visits.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const visibleVisits = visits.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const firstVisible = visits.length ? (currentPage - 1) * pageSize + 1 : 0;
  const lastVisible = Math.min(currentPage * pageSize, visits.length);
  if (!visits.length) return <div className="empty"><Wrench size={24} /><p><strong>No service visits match these filters.</strong></p></div>;
  return <><div className="table-wrap service-visits-table-wrap"><table className="service-visits-table"><thead><tr><th>Visit</th><th>Site</th><th>Type</th><th>Ticket</th><th>Contractor</th><th>Scheduled</th><th>Status</th>{onSelect && <th><span className="sr-only">Actions</span></th>}</tr></thead><tbody>{visibleVisits.map(({ installation, visit }) => <tr key={visit.id} role={onSelect ? "button" : undefined} tabIndex={onSelect ? 0 : undefined} aria-label={onSelect ? `Open service visit ${visit.id}` : undefined} onClick={() => onSelect?.(installation, visit)} onKeyDown={(event) => onSelect && handleRowKeyboard(event, () => onSelect(installation, visit))} style={{ cursor: onSelect ? "pointer" : "default" }}><td><strong>{visit.id}</strong></td><td>{installation.siteName || installation.id}</td><td>{visit.type}</td><td>{visit.ticketReference || "None"}</td><td>{visit.contractor}</td><td>{niceDate(visit.scheduledDate)}</td><td><span className={`pill ${visit.status === "completed" ? "installed" : visit.status === "cancelled" ? "cancelled" : visit.status === "in_progress" ? "issue" : "scheduled"}`}>{serviceStatusLabels[visit.status]}</span></td>{onSelect && <td><button type="button" className="button icon-button ghost" aria-label={`View service visit ${visit.id}`} onClick={(event) => { event.stopPropagation(); onSelect(installation, visit); }}><ChevronRight size={16} /></button></td>}</tr>)}</tbody></table></div><div className="pagination"><span className="small muted">Showing {firstVisible}-{lastVisible} of {visits.length} visits | {pageSize} rows per page</span><div className="toolbar"><button type="button" className="button icon-button" aria-label="Previous page" disabled={currentPage === 1} onClick={() => setPage((current) => Math.max(1, current - 1))}><ChevronLeft size={16} /></button><span className="pagination-page small">Page {currentPage} of {pageCount}</span><button type="button" className="button icon-button" aria-label="Next page" disabled={currentPage === pageCount} onClick={() => setPage((current) => Math.min(pageCount, current + 1))}><ChevronRight size={16} /></button></div></div></>;
}

function AuditTimeline({ events }: { events: AuditEvent[] }) {
  if (!events.length) return <div className="empty"><History size={24} /><p><strong>No changes recorded yet.</strong></p></div>;
  return <div className="timeline">{[...events].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((event) => {
    const fields = (event.changedFields ?? []).filter((field) => !hiddenAuditFields.has(field));
    const changes = fields.filter((field) => event.beforeData?.[field] !== event.afterData?.[field]);
    return <div className="timeline-item" key={event.id}><span className="timeline-dot" /><div><strong>{event.summary}</strong><div className="small muted">{niceDateTime(event.createdAt)} by {event.actor}</div>{event.action === "update" && fields.length > 0 && <div className="small muted">Updated: {fields.map(auditLabel).join(", ")}</div>}{event.action === "update" && changes.length > 0 && <details className="audit-details"><summary>View previous values</summary><div className="audit-change-list">{changes.map((field) => <div className="audit-change" key={field} style={{ display: "grid", gap: 7, maxWidth: 620, padding: "8px 10px", borderRadius: 7, background: "var(--surface-muted)" }}><strong>{auditLabel(field)}</strong><div className="audit-value-grid" style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: 8 }}><span className="audit-value" style={{ display: "grid", gap: 3, minWidth: 0 }}><span className="audit-value-label">Previous</span><span>{auditValue(event.beforeData?.[field])}</span></span><span className="audit-value" style={{ display: "grid", gap: 3, minWidth: 0 }}><span className="audit-value-label">New</span><span>{auditValue(event.afterData?.[field])}</span></span></div></div>)}</div></details>}</div></div>;
  })}</div>;
}

function ServiceVisitModal({ refs, installation, visit, actorName, onClose, onSave, fullPage = false, readOnly = false }: { refs: ReferenceData; installation: Installation; visit?: ServiceVisit; actorName: string; onClose: (bypassGuard?: boolean) => void; onSave: (visit: ServiceVisit, components: Component[]) => Promise<boolean | undefined>; fullPage?: boolean; readOnly?: boolean }) {
  const navigate = useGuardedNavigation();
  const now = new Date().toISOString(); const id = visit?.id ?? uid("VISIT");
  const [initialDraft] = useState<ServiceVisit>(() => visit ?? { id, type: refs.serviceVisitTypes.find((item) => item.active)?.name ?? "", status: "scheduled", ticketReference: "", contractor: installation.contractor, scheduledDate: today(), notes: "", photos: [], componentChanges: [], createdBy: actorName, updatedBy: actorName, createdAt: now, updatedAt: now });
  const [draft, setDraft] = useState<ServiceVisit>(initialDraft);
  const [removedIds, setRemovedIds] = useState<string[]>([]);
  const [newComponents, setNewComponents] = useState<Component[]>([]);
  const [showEquipment, setShowEquipment] = useState(false);
  const [showPhotos, setShowPhotos] = useState(false);
  const [showDiscard, setShowDiscard] = useState(false);
  const [pendingHref, setPendingHref] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [saveError, setSaveError] = useState("");
  const dirty = JSON.stringify(draft) !== JSON.stringify(initialDraft) || removedIds.length > 0 || newComponents.length > 0;
  function requestClose() { if (dirty) setShowDiscard(true); else onClose(); }
  useEscape(requestClose);
  useNavigationBlocker(fullPage && dirty && !submitting, (href) => { setPendingHref(href); setShowDiscard(true); });
  useBlobUrlCleanup(draft.photos);
  useEffect(() => {
    if (!dirty) return;
    function beforeUnload(event: BeforeUnloadEvent) { event.preventDefault(); event.returnValue = ""; }
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [dirty]);
  const activeComponents = installation.components.filter((component) => !component.removedAt);
  const incompleteNewComponent = newComponents.some((component) => visibleComponentFields(refs, component).some((field) => field.active && field.required && !component.values[field.id]?.trim()));
  const invalidNewMac = newComponents.some((component) => visibleComponentFields(refs, component).some((field) => libraryField(refs, field)?.type === "mac" && component.values[field.id] && !normalizeMac(component.values[field.id])));
  const invalidNewInteger = newComponents.some((component) => visibleComponentFields(refs, component).some((field) => libraryField(refs, field)?.type === "integer" && component.values[field.id] && !validInteger(component.values[field.id])));
  async function saveVisit() {
    const updatedAt = new Date().toISOString(); const changes = [...draft.componentChanges];
    const components = installation.components.map((component) => removedIds.includes(component.id) && !component.removedAt ? { ...component, removedAt: updatedAt, removedViaVisitId: draft.id } : component);
    removedIds.forEach((componentId) => { const component = installation.components.find((item) => item.id === componentId); if (component && !component.removedAt) changes.push({ id: uid("VISITCHANGE"), action: "removed", componentId, componentType: component.type, summary: `Removed ${component.type}` }); });
    newComponents.forEach((item) => { const component: Component = { ...item, values: Object.fromEntries(Object.entries(item.values).map(([key, value]) => { const field = visibleComponentFields(refs, item).find((candidate) => candidate.id === key); return [key, field && libraryField(refs, field)?.type === "mac" ? normalizeMac(value) : value]; })), installedAt: updatedAt, installedViaVisitId: draft.id }; components.push(component); changes.push({ id: uid("VISITCHANGE"), action: "installed", componentId: component.id, componentType: component.type, summary: `Installed ${component.type}` }); });
    setSubmitting(true); setSaveError("");
    const saved = await onSave({ ...draft, updatedBy: actorName, updatedAt, completedDate: draft.status === "completed" ? draft.completedDate || today() : draft.completedDate, componentChanges: changes }, components);
    setSubmitting(false);
    if (!saved) { setSaveError("The service visit could not be saved. Review the page message and try again."); return; }
    if (pendingHref) navigate(pendingHref, { bypassGuard: true }); else onClose(true);
  }
  function photos(e: ChangeEvent<HTMLInputElement>) { const files = Array.from(e.target.files ?? []).slice(0, 4); setDraft({ ...draft, photos: [...draft.photos, ...files.map((file) => ({ name: file.name, url: URL.createObjectURL(file) }))] }); }
  return <div className={fullPage ? "panel service-visit-page" : "modal-backdrop"} role="presentation"><div className={fullPage ? "section" : "modal-panel modal-wide"} role={fullPage ? "region" : "dialog"} aria-modal={fullPage ? undefined : true} aria-labelledby={`visit-${draft.id}`}>
    <div className="modal-header"><div><p className="eyebrow">Contractor revisit</p><h2 id={`visit-${draft.id}`}>{visit ? draft.id : "New service visit"}</h2></div><button type="button" className="button icon-button ghost" aria-label="Close service visit" onClick={requestClose}><X size={17} /></button></div>
    <fieldset className="service-visit-fields" disabled={readOnly}>
    <div className="grid-3"><label>Visit type<select className="select" value={draft.type} onChange={(e) => setDraft({ ...draft, type: e.target.value })}>{activeOptions(refs.serviceVisitTypes, draft.type).map((item) => <option key={item.id}>{item.name}</option>)}</select></label><label>Status<select className="select" value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value as ServiceVisitStatus })}>{Object.entries(serviceStatusLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label><label>Ticket reference<input className="field" value={draft.ticketReference} onChange={(e) => setDraft({ ...draft, ticketReference: e.target.value })} placeholder="Optional ticket number" /></label><label>Contractor<select className="select" value={draft.contractor} onChange={(e) => setDraft({ ...draft, contractor: e.target.value })}>{activeOptions(refs.contractors, draft.contractor).map((item) => <option key={item.id}>{item.name}</option>)}</select></label><label>Scheduled date<input className="field" type="date" value={draft.scheduledDate} onChange={(e) => setDraft({ ...draft, scheduledDate: e.target.value })} /></label>{draft.status === "completed" && <label>Completed date<input className="field" type="date" value={draft.completedDate ?? ""} onChange={(e) => setDraft({ ...draft, completedDate: e.target.value })} /><span className="field-help">Leave blank to use today.</span></label>}</div>
    <label className="field-block">Visit notes<textarea className="textarea" rows={3} value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} placeholder="Work performed, findings, and follow-up actions" /></label>
    <div className="visit-section"><button type="button" className="button disclosure-button" aria-expanded={showEquipment} onClick={() => setShowEquipment(!showEquipment)}>{showEquipment ? "Hide equipment changes" : "Add equipment changes"}{removedIds.length + newComponents.length > 0 && <span className="pill scheduled">{removedIds.length + newComponents.length}</span>}</button>{showEquipment && <div className="visit-equipment"><h3>Equipment changes</h3><div className="small muted">Select equipment removed during this visit and add installed equipment with its required identifiers.</div>{activeComponents.map((component) => <label className="check-row" key={component.id}><input type="checkbox" checked={removedIds.includes(component.id)} onChange={(e) => setRemovedIds(e.target.checked ? [...removedIds, component.id] : removedIds.filter((id) => id !== component.id))} />Remove {component.type} {Object.values(component.values)[0] ? `(${Object.values(component.values)[0]})` : ""}</label>)}{newComponents.map((component) => <div className="component-template-row" key={component.id}><div className="component-row"><strong>Install {component.type}</strong>{visibleComponentFields(refs, component).map((field) => { const reusable = libraryField(refs, field); return reusable ? <label key={field.id}>{reusable.label}{field.required ? " *" : ""}<EquipmentValueInput type={reusable.type} label={reusable.label} value={component.values[field.id] ?? ""} required={field.required} onChange={(value) => setNewComponents(newComponents.map((item) => item.id === component.id ? { ...item, values: { ...item.values, [field.id]: value } } : item))} /></label> : null; })}<button type="button" className="button icon-button danger" aria-label={`Remove new ${component.type}`} onClick={() => setNewComponents(newComponents.filter((item) => item.id !== component.id))}><Trash2 size={14} /></button></div></div>)}{incompleteNewComponent && <div className="notice validation-notice" role="alert"><strong>Complete the required replacement equipment fields.</strong></div>}{invalidNewMac && <div className="notice validation-notice" role="alert"><strong>Check the replacement MAC address format.</strong></div>}{invalidNewInteger && <div className="notice validation-notice" role="alert"><strong>Enter whole numbers for integer equipment fields.</strong></div>}<div className="toolbar"><select className="select" aria-label="Choose installed component type" id={`new-component-${draft.id}`} defaultValue=""><option value="">Choose installed component</option>{refs.componentTypes.filter((item) => item.active).map((item) => <option key={item.id}>{item.name}</option>)}</select><button type="button" className="button" onClick={() => { const select = document.getElementById(`new-component-${draft.id}`) as HTMLSelectElement; if (select.value) { setNewComponents([...newComponents, { id: uuid(), type: select.value, values: {}, notes: "" }]); select.value = ""; } }}><Plus size={14} />Add installed equipment</button></div></div>}</div>
    <div className="visit-section"><button type="button" className="button disclosure-button" aria-expanded={showPhotos} onClick={() => setShowPhotos(!showPhotos)}>{showPhotos ? "Hide visit photos" : "Add visit photos"}{draft.photos.length > 0 && <span className="pill scheduled">{draft.photos.length}</span>}</button>{showPhotos && <><label className="dropzone compact"><ImagePlus size={18} style={{ margin: "auto" }} /><span>Choose optional visit photos</span><input type="file" accept="image/*" multiple hidden onChange={photos} /></label>{draft.photos.length > 0 && <p className="small muted">{draft.photos.map((photo) => photo.name).join(", ")}</p>}</>}</div>
    </fieldset>
    {saveError && <div className="notice validation-notice inline" role="alert">{saveError}</div>}
    <div className="modal-actions"><button type="button" className="button" disabled={submitting} onClick={requestClose}>{readOnly ? "Back to service visits" : "Cancel"}</button>{!readOnly && <button type="button" className="button primary" disabled={submitting || incompleteNewComponent || invalidNewMac || invalidNewInteger} onClick={() => void saveVisit()}>{submitting ? "Saving service visit..." : "Save service visit"}</button>}</div>
    {showDiscard && <div className="nested-modal-backdrop" role="presentation"><div className="modal-panel discard-modal" role="alertdialog" aria-modal="true" aria-labelledby={`discard-${draft.id}`}><div className="modal-icon"><AlertTriangle size={20} /></div><h2 id={`discard-${draft.id}`}>Leave without saving changes?</h2><p className="muted">Your notes, equipment updates, and photo selections will not be saved.</p><div className="modal-actions"><button type="button" className="button" onClick={() => { setPendingHref(""); setShowDiscard(false); }}>Keep editing</button><button type="button" className="button danger-solid" onClick={() => pendingHref ? navigate(pendingHref, { bypassGuard: true }) : onClose(true)}>Discard changes</button><button type="button" className="button primary" disabled={submitting || incompleteNewComponent || invalidNewMac || invalidNewInteger} onClick={() => void saveVisit()}>{submitting ? "Saving..." : "Save and leave"}</button></div></div></div>}
  </div></div>;
}

function InstallationForm({
  refs,
  records,
  actorName,
  initial,
  fetchAuditEvents,
  fetchServiceVisits,
  onAddContractor,
  onSave,
  onCancel,
  onDelete,
  setHasUnsavedChanges,
  navAttempt,
  clearNavAttempt,
  routeNavAttempt,
  readOnly = false
}: {
  refs: ReferenceData;
  records: Installation[];
  actorName: string;
  initial?: Installation;
  fetchAuditEvents?: (installationId: string) => Promise<AuditEvent[]>;
  fetchServiceVisits?: (installationId: string) => Promise<ServiceVisit[]>;
  onAddContractor: (name: string) => Promise<string>;
  onSave: (r: Installation) => Promise<void>;
  onCancel: () => void;
  onDelete?: (r: Installation) => Promise<void>;
  setHasUnsavedChanges: (dirty: boolean) => void;
  navAttempt: Page | null;
  clearNavAttempt: () => void;
  routeNavAttempt?: string;
  readOnly?: boolean;
}) {
  const navigate = useGuardedNavigation();
  const createdAt = new Date().toISOString();
  const [record, setRecord] = useState<Installation>(initial ?? { id: "", siteName: "", unitType: refs.unitTypes.find((x) => x.active)?.name ?? "", contractor: refs.contractors.find((x) => x.active)?.name ?? "", installerTeamLead: "", installDate: today(), activationDate: today(), status: siteStatusOptions(refs)[0]?.value ?? "scheduled", islandGroup: "", region: "", regionCode: "", province: "", provinceCode: "", municipality: "", municipalityCode: "", barangay: "", barangayCode: "", contractorAddress: "", longitude: "", latitude: "", beneficiaryContacts: [contactDraft()], beneficiaryName: "", beneficiaryRole: "", beneficiaryPhone: "", remarks: "", components: defaultNewSiteComponents(refs), customValues: {}, photos: [], createdBy: actorName, createdAt, updatedBy: actorName, updatedAt: createdAt, serviceVisits: [], auditEvents: [] });
  const [tab, setTab] = useState<"overview" | "visits" | "audit">("overview");
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>(initial?.auditEvents ?? []);
  const [auditLoaded, setAuditLoaded] = useState(!initial?.dbId || Boolean(initial.auditEvents.length));
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditError, setAuditError] = useState("");
  const [serviceVisits, setServiceVisits] = useState<ServiceVisit[]>(initial?.serviceVisits ?? []);
  const [visitsLoaded, setVisitsLoaded] = useState(!initial?.dbId || Boolean(initial.serviceVisits.length));
  const [visitsLoading, setVisitsLoading] = useState(false);
  const [visitsError, setVisitsError] = useState("");
  const [showOptionalFields, setShowOptionalFields] = useState(() => Boolean(Object.values(initial?.customValues ?? {}).some(Boolean)));
  const [showNotesPhotos, setShowNotesPhotos] = useState(() => Boolean(initial?.remarks || initial?.photos.length));
  const [noteComponentId, setNoteComponentId] = useState<string>();
  const [deleteComponentId, setDeleteComponentId] = useState<string>();
  const [addingContractor, setAddingContractor] = useState(false);
  const [newContractorName, setNewContractorName] = useState("");
  const [contractorSaving, setContractorSaving] = useState(false);
  const [contractorError, setContractorError] = useState("");
  const [schoolMatches, setSchoolMatches] = useState<SchoolDirectoryEntry[]>([]);
  const [schoolLookupOpen, setSchoolLookupOpen] = useState(false);
  const [schoolLookupIndex, setSchoolLookupIndex] = useState(0);
  const [schoolLookupNotice, setSchoolLookupNotice] = useState("");
  const [pasteReport, setPasteReport] = useState("");
  const [pastePanelOpen, setPastePanelOpen] = useState(false);
  const [extractingReport, setExtractingReport] = useState<"local" | "gemini" | "">("");
  const [extractionError, setExtractionError] = useState("");
  const [extractionSummary, setExtractionSummary] = useState<ExtractionSummary>();
  const autoScalarValues = useRef<Record<string, string>>({});
  const autoEquipmentValues = useRef<Partial<Record<ExtractionEquipmentSlot, AutoEquipmentValue>>>({});
  const autoContactValue = useRef<{ id: string; name: string; role: string; phone: string; generated: boolean } | undefined>(undefined);
  const [showExitModal, setShowExitModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [triedSubmit, setTriedSubmit] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const [excelCopyState, setExcelCopyState] = useState<"idle" | "first" | "last" | "error">("idle");
  const [latLongCopyState, setLatLongCopyState] = useState<"idle" | "copied" | "error">("idle");
  const [plusCodeCopyState, setPlusCodeCopyState] = useState<"idle" | "copied" | "error">("idle");
  const [siteDetailsCopyState, setSiteDetailsCopyState] = useState<"idle" | "copied" | "error">("idle");
  const [routerContactCopyState, setRouterContactCopyState] = useState<"idle" | "copied" | "error">("idle");
  const validationSummaryRef = useRef<HTMLDivElement>(null);
  useBlobUrlCleanup(record.photos);

  const [original, setOriginal] = useState<Installation>(() => JSON.parse(JSON.stringify(record)));
  const isDirty = useMemo(() => {
    return JSON.stringify(record) !== JSON.stringify(original);
  }, [record, original]);
  const patch = (data: Partial<Installation>) => setRecord((r) => ({ ...r, ...data }));

  useEffect(() => {
    if (!schoolLookupOpen || record.siteName.trim().length < 2) return;
    let active = true;
    const timer = window.setTimeout(() => {
      void searchSchoolDirectory(record.siteName).then((matches) => { if (active) { setSchoolMatches(matches); setSchoolLookupIndex(0); } }).catch(() => { if (active) setSchoolMatches([]); });
    }, 250);
    return () => { active = false; window.clearTimeout(timer); };
  }, [record.siteName, schoolLookupOpen]);

  async function selectDirectorySchool(entry: SchoolDirectoryEntry) {
    let selected = entry;
    let resolutionIssue = entry.warning;
    if (!entry.regionCode || !entry.provinceCode || !entry.municipalityCode) {
      const { resolveLocation } = await import("@/lib/locations");
      const resolution = resolveLocation({ islandGroup: entry.islandGroup, region: entry.region, province: entry.province, municipality: entry.municipality, barangay: entry.barangay });
      if (resolution.location) { selected = { ...entry, ...resolution.location, warning: "" }; resolutionIssue = ""; }
      else resolutionIssue = resolution.issue || entry.warning;
    }
    const next: Partial<Installation> = {};
    if (!initial?.siteName && !original.siteName) next.siteName = selected.schoolName;
    if (!record.id.trim() && selected.schoolId) next.id = selected.schoolId;
    const resolved = Boolean(selected.regionCode && selected.provinceCode && selected.municipalityCode);
    const compatible = resolved && [[record.regionCode, selected.regionCode], [record.provinceCode, selected.provinceCode], [record.municipalityCode, selected.municipalityCode], [record.barangayCode, selected.barangayCode]].every(([current, incoming]) => !current || !incoming || current === incoming);
    if (compatible) {
      const locationFields = ["islandGroup", "region", "regionCode", "province", "provinceCode", "municipality", "municipalityCode", "barangay", "barangayCode"] as const;
      for (const field of locationFields) if (!record[field] && selected[field]) (next as Record<string, unknown>)[field] = selected[field];
      setSchoolLookupNotice("School directory data filled available blank fields.");
    } else if (!resolved) setSchoolLookupNotice(`School selected, but its spreadsheet location could not be matched to PSGC data.${resolutionIssue ? ` ${resolutionIssue}` : ""}`);
    else setSchoolLookupNotice("School selected. Existing location values were preserved because they differ from the directory.");
    patch(next);
    setSchoolLookupOpen(false);
    setSchoolMatches([]);
  }

  async function applyReportExtraction(extraction: SiteReportExtraction, source: "local" | "gemini") {
    const values = extraction.values;
    const warnings: string[] = [];
    let filled = 0;
    let directory: SchoolDirectoryEntry | null = null;
    try { directory = await findSchoolDirectoryEntry({ schoolId: values.schoolId, schoolName: values.siteName }); }
    catch { warnings.push("The school directory could not be checked. Parsed school values were still applied."); }

    let resolvedLocation: Partial<Installation> | undefined;
    const { resolveLocation } = await import("@/lib/locations");
    if (directory) {
      if (directory.regionCode && directory.provinceCode && directory.municipalityCode) resolvedLocation = directory;
      else {
        const resolution = resolveLocation({ islandGroup: directory.islandGroup, region: directory.region, province: directory.province, municipality: directory.municipality, barangay: directory.barangay });
        resolvedLocation = resolution.location;
        if (!resolvedLocation) warnings.push(`The directory school was found, but its location was unresolved. ${resolution.issue ?? ""}`.trim());
      }
    } else if (values.schoolId || values.siteName) warnings.push("No unique school-directory match was found.");

    const contractor = refs.contractors.find((item) => item.active && item.name.localeCompare(values.contractor, undefined, { sensitivity: "accent" }) === 0);
    if (values.contractor && !contractor) {
      setNewContractorName(values.contractor);
      setAddingContractor(true);
      setContractorError("");
      warnings.push(`Contractor “${values.contractor}” is not in Settings. Review the prefilled Add contractor form.`);
    }
    const hasSatelliteEquipment = Boolean(values.starlinkKitNumber || values.ap1IndoorSerial || values.ap2IndoorSerial || values.ap3OutdoorSerial);
    const solution = hasSatelliteEquipment ? refs.unitTypes.find((item) => item.active && /starlink|satellite/i.test(item.name)) : undefined;
    if (hasSatelliteEquipment && !solution) warnings.push("No active Starlink or Satellite solution was found; the current Solution was preserved.");

    setRecord((current) => {
      const next: Installation = { ...current, components: current.components.map((component) => ({ ...component, values: { ...(component.values ?? {}) } })), beneficiaryContacts: beneficiaryContactList(current).map((contact) => ({ ...contact })) };
      const applyScalar = (field: keyof Installation, incoming: unknown) => {
        const value = typeof incoming === "string" ? incoming.trim() : incoming;
        if (!value) return;
        const currentValue = current[field];
        const originalValue = original[field];
        const previousAuto = autoScalarValues.current[String(field)];
        if (currentValue !== "" && currentValue !== undefined && currentValue !== originalValue && String(currentValue) !== previousAuto) return;
        if (currentValue !== value) filled += 1;
        (next as unknown as Record<string, unknown>)[field] = value;
        autoScalarValues.current[String(field)] = String(value);
      };

      applyScalar("id", directory?.schoolId || values.schoolId);
      applyScalar("siteName", directory?.schoolName || values.siteName);
      applyScalar("installerTeamLead", values.installerTeamLead);
      applyScalar("installDate", values.installDate);
      applyScalar("activationDate", values.activationDate || values.installDate);
      applyScalar("contractorAddress", values.address);
      applyScalar("longitude", values.longitude);
      applyScalar("latitude", values.latitude);
      applyScalar("remarks", values.remarks);
      if (contractor) applyScalar("contractor", contractor.name);
      if (solution) applyScalar("unitType", solution.name);
      if (resolvedLocation) for (const field of ["islandGroup", "region", "regionCode", "province", "provinceCode", "municipality", "municipalityCode", "barangay", "barangayCode"] as const) applyScalar(field, resolvedLocation[field]);

      const usedComponents = new Set<string>();
      for (const slot of Object.keys(equipmentSlotValues) as ExtractionEquipmentSlot[]) {
        const incoming = values[equipmentSlotValues[slot]];
        const previous = autoEquipmentValues.current[slot];
        if (!incoming) {
          if (previous) {
            const component = next.components.find((item) => item.id === previous.componentId);
            const unchanged = component?.values[previous.fieldId] === previous.value;
            if (previous.generated && unchanged) next.components = next.components.filter((item) => item.id !== previous.componentId);
            else if (!previous.generated && unchanged && component) component.values[previous.fieldId] = "";
            delete autoEquipmentValues.current[slot];
          }
          continue;
        }
        const type = orderedByDisplay(refs.componentTypes).find((item) => item.active && extractionTypeMatch(slot, item.name));
        if (!type) { warnings.push(`No active ${slot === "router" ? "Ruijie Router" : slot === "starlink" ? "Starlink" : slot === "outdoor" ? "Outdoor AP" : "Indoor AP"} component type is configured.`); continue; }
        const field = orderedByDisplay(type.fields).find((attachment) => attachment.active && {
          starlink: /kit/i,
          indoor1: /serial/i,
          indoor2: /serial/i,
          outdoor: /serial/i,
          router: /serial/i,
        }[slot].test(libraryField(refs, attachment)?.label ?? ""));
        if (!field) { warnings.push(`${type.name} has no active ${slot === "starlink" ? "Kit" : "Serial"} field.`); continue; }

        let component = previous ? next.components.find((item) => item.id === previous.componentId && item.values[previous.fieldId] === previous.value) : undefined;
        let generated = previous?.generated ?? false;
        if (!component) {
          component = next.components.find((item) => !item.removedAt && item.type === type.name && !usedComponents.has(item.id) && !(item.values?.[field.id] ?? "").trim());
          generated = false;
        }
        if (!component) {
          component = componentDraft(type.name, next.components.length);
          next.components.push(component);
          generated = true;
        }
        component.type = type.name;
        component.values[field.id] = incoming;
        usedComponents.add(component.id);
        autoEquipmentValues.current[slot] = { componentId: component.id, fieldId: field.id, value: incoming, generated };
        filled += 1;
      }

      const contactIncoming = { name: values.beneficiaryName, role: "", phone: values.beneficiaryPhone };
      const hasContact = Object.values(contactIncoming).some(Boolean);
      const previousContact = autoContactValue.current;
      if (!hasContact && previousContact) {
        const contact = next.beneficiaryContacts.find((item) => item.id === previousContact.id);
        const unchanged = contact && contact.name === previousContact.name && contact.role === previousContact.role && contact.phone === previousContact.phone;
        if (previousContact.generated && unchanged) next.beneficiaryContacts = next.beneficiaryContacts.filter((item) => item.id !== previousContact.id);
        else if (!previousContact.generated && unchanged && contact) Object.assign(contact, { name: "", role: "", phone: "" });
        autoContactValue.current = undefined;
      } else if (hasContact) {
        let contact = previousContact ? next.beneficiaryContacts.find((item) => item.id === previousContact.id && item.name === previousContact.name && item.role === previousContact.role && item.phone === previousContact.phone) : undefined;
        let generated = previousContact?.generated ?? false;
        if (!contact) { contact = next.beneficiaryContacts.find((item) => !item.name && !item.role && !item.phone); generated = false; }
        if (!contact) { contact = contactDraft(); next.beneficiaryContacts.push(contact); generated = true; }
        Object.assign(contact, contactIncoming);
        autoContactValue.current = { id: contact.id, ...contactIncoming, generated };
        filled += Object.values(contactIncoming).filter(Boolean).length;
      }
      return next;
    });
    window.setTimeout(() => setExtractionSummary({ filled, missing: extraction.missing.length, warnings: [...new Set(warnings)], diagnostics: extraction.diagnostics, source }), 0);
    setPastePanelOpen(false);
    setSchoolLookupNotice(directory ? "Matched the school directory and applied its canonical school and PSGC location data." : "Report values were extracted. Review the highlighted summary before saving.");
  }

  async function extractReport(source: "local" | "gemini") {
    const report = pasteReport.trim();
    if (!report) { setExtractionError("Paste an activation report first."); return; }
    if (report.length > 50_000) { setExtractionError("The report must be 50,000 characters or fewer."); return; }
    setExtractingReport(source); setExtractionError("");
    try {
      const extraction = source === "gemini" ? await extractSiteReportWithGemini(report) as SiteReportExtraction : parseSiteActivationReport(report);
      await applyReportExtraction(extraction, source);
    } catch (error) { setExtractionError(errorMessage(error, source === "gemini" ? "Gemini could not check this report. Local extraction is still available." : "Unable to extract this report.")); }
    finally { setExtractingReport(""); }
  }

  function schoolLookupKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (!schoolLookupOpen || !schoolMatches.length) return;
    if (event.key === "ArrowDown") { event.preventDefault(); setSchoolLookupIndex((index) => (index + 1) % schoolMatches.length); }
    else if (event.key === "ArrowUp") { event.preventDefault(); setSchoolLookupIndex((index) => (index - 1 + schoolMatches.length) % schoolMatches.length); }
    else if (event.key === "Enter") { event.preventDefault(); void selectDirectorySchool(schoolMatches[schoolLookupIndex]); }
    else if (event.key === "Escape") setSchoolLookupOpen(false);
  }

  useEffect(() => {
    setHasUnsavedChanges(isDirty);
    return () => setHasUnsavedChanges(false);
  }, [isDirty, setHasUnsavedChanges]);
  const shouldShowExitModal = showExitModal || Boolean(navAttempt) || Boolean(routeNavAttempt);

  const duplicate = record.siteName && records.some((r) => r.siteName.toLowerCase() === record.siteName.toLowerCase() && r.dbId !== record.dbId);
  const schoolId = record.id.trim();
  const duplicateSchoolId = schoolId && records.some((r) => r.id.toLowerCase() === schoolId.toLowerCase() && r.dbId !== record.dbId);
  const regionChoices = useLocationChoices("region");
  const provinceChoices = useLocationChoices("province", record.regionCode);
  const municipalityChoices = useLocationChoices("municipality", record.provinceCode);
  const barangayChoices = useLocationChoices("barangay", record.municipalityCode);
  const regions = useMemo(() => regionChoices.options.filter((item) => getIslandGroup(item.code) === record.islandGroup), [record.islandGroup, regionChoices.options]);
  const locationError = regionChoices.error || provinceChoices.error || municipalityChoices.error || barangayChoices.error;
  const missingSiteName = !record.siteName.trim();
  const missingLocation = !record.islandGroup || !record.regionCode || !record.provinceCode || !record.municipalityCode;
  const activeFields = (refs.customFields ?? []).filter((field) => field.active || Boolean((record.customValues ?? {})[field.id])).sort((a, b) => a.order - b.order);
  const requiredCustomFields = activeFields.filter((field) => field.required);
  const optionalCustomFields = activeFields.filter((field) => !field.required);
  const activeComponents = record.components.filter((component) => !component.removedAt);
  const invalidMac = activeComponents.some((component) => visibleComponentFields(refs, component).some((field) => libraryField(refs, field)?.type === "mac" && (component.values ?? {})[field.id] && !normalizeMac((component.values ?? {})[field.id])));
  const invalidInteger = activeComponents.some((component) => visibleComponentFields(refs, component).some((field) => libraryField(refs, field)?.type === "integer" && (component.values ?? {})[field.id] && !validInteger((component.values ?? {})[field.id])));
  const allMacs = activeComponents.flatMap((component) => componentMacValues(refs, component));
  const duplicateMac = activeComponents.find((component) => componentMacValues(refs, component).some((mac) => allMacs.filter((value) => value === mac).length > 1 || records.some((installation) => installation.id !== record.id && installation.components.some((existing) => !existing.removedAt && componentMacValues(refs, existing).includes(mac)))));
  const duplicateMacInstallation = duplicateMac && records.find((installation) => installation.id !== record.id && installation.components.some((existing) => !existing.removedAt && componentMacValues(refs, existing).some((mac) => componentMacValues(refs, duplicateMac).includes(mac))));
  const missingComponentValue = activeComponents.some((component) => visibleComponentFields(refs, component).some((field) => field.active && field.required && !(component.values ?? {})[field.id]?.trim()));
  const missingUnitType = !record.unitType.trim();
  const missingContractor = !record.contractor.trim();
  const missingInstallDate = !record.installDate.trim();
  const requiredCustomComplete = requiredCustomFields.every((field) => (record.customValues ?? {})[field.id]?.trim());
  const missingRequiredCustomField = requiredCustomFields.find((field) => !(record.customValues ?? {})[field.id]?.trim());
  const invalidMacComponent = activeComponents.find((component) => visibleComponentFields(refs, component).some((field) => libraryField(refs, field)?.type === "mac" && (component.values ?? {})[field.id] && !normalizeMac((component.values ?? {})[field.id])));
  const invalidMacField = invalidMacComponent && visibleComponentFields(refs, invalidMacComponent).find((field) => libraryField(refs, field)?.type === "mac" && (invalidMacComponent.values ?? {})[field.id] && !normalizeMac((invalidMacComponent.values ?? {})[field.id]));
  const invalidIntegerComponent = activeComponents.find((component) => visibleComponentFields(refs, component).some((field) => libraryField(refs, field)?.type === "integer" && (component.values ?? {})[field.id] && !validInteger((component.values ?? {})[field.id])));
  const invalidIntegerField = invalidIntegerComponent && visibleComponentFields(refs, invalidIntegerComponent).find((field) => libraryField(refs, field)?.type === "integer" && (invalidIntegerComponent.values ?? {})[field.id] && !validInteger((invalidIntegerComponent.values ?? {})[field.id]));
  const missingComponent = activeComponents.find((component) => visibleComponentFields(refs, component).some((field) => field.active && field.required && !(component.values ?? {})[field.id]?.trim()));
  const missingComponentField = missingComponent && visibleComponentFields(refs, missingComponent).find((field) => field.active && field.required && !(missingComponent.values ?? {})[field.id]?.trim());
  const componentFieldInputId = (componentId: string, fieldId: string) => `equipment-${componentId}-${fieldId}`;
  const hasValidationError = Boolean(missingSiteName || !schoolId || duplicateSchoolId || duplicate || missingUnitType || missingContractor || missingInstallDate || missingLocation || missingRequiredCustomField || invalidMac || invalidInteger || missingComponentValue || (duplicateMac && !duplicateMac.duplicateMacAcknowledged));
  const validationItems = [
    missingSiteName && { id: "site-name-error", target: "site-name-input", text: "Enter a site name." },
    !schoolId && { id: "school-id-required-error", target: "school-id-input", text: "Enter the official School ID." },
    duplicateSchoolId && { id: "school-id-duplicate-error", target: "school-id-input", text: "Use a unique School ID." },
    duplicate && { id: "site-name-duplicate-error", target: "site-name-input", text: "Use a unique site name." },
    missingUnitType && { id: "solution-required-error", target: "solution-input", text: "Choose a solution." },
    missingContractor && { id: "contractor-required-error", target: "contractor-input", text: "Choose a contractor." },
    missingInstallDate && { id: "install-date-required-error", target: "install-date-input", text: "Enter the installation date." },
    missingLocation && { id: "location-required-error", target: !record.islandGroup ? "island-group-input" : !record.regionCode ? "region-input" : !record.provinceCode ? "province-input" : "locality-input", text: "Complete island group, region, province, and locality." },
    missingRequiredCustomField && { id: "required-custom-error", target: `custom-field-${missingRequiredCustomField.id}`, text: `Complete ${missingRequiredCustomField.label}.` },
    invalidMacField && invalidMacComponent && { id: "equipment-mac-error", target: componentFieldInputId(invalidMacComponent.id, invalidMacField.id), text: "Fix the MAC address format." },
    invalidIntegerField && invalidIntegerComponent && { id: "equipment-integer-error", target: componentFieldInputId(invalidIntegerComponent.id, invalidIntegerField.id), text: "Enter whole numbers for integer equipment fields." },
    missingComponentField && missingComponent && { id: "equipment-required-error", target: componentFieldInputId(missingComponent.id, missingComponentField.id), text: "Complete required equipment fields." },
    duplicateMac && !duplicateMac.duplicateMacAcknowledged && { id: "equipment-duplicate-mac-error", target: "duplicate-mac-acknowledgement", text: "Review and acknowledge the duplicate MAC address." },
  ].filter(Boolean) as { id: string; target: string; text: string }[];
  const siteNameDescriptions = [duplicate ? "site-name-duplicate-error" : "", triedSubmit && missingSiteName ? "site-name-error" : ""].filter(Boolean).join(" ") || undefined;
  const schoolIdDescriptions = [duplicateSchoolId ? "school-id-duplicate-error" : "", triedSubmit && !schoolId ? "school-id-required-error" : ""].filter(Boolean).join(" ") || undefined;
  const locationDescription = triedSubmit && missingLocation ? "location-required-error" : undefined;
  const requiredProgress = [
    { label: "Site details", complete: Boolean(record.siteName && schoolId && record.unitType && record.contractor && record.installDate && !duplicate && !duplicateSchoolId) },
    { label: "Location", complete: !missingLocation && !locationError },
    { label: "Equipment", complete: !missingComponentValue && !invalidMac && !invalidInteger && !(duplicateMac && !duplicateMac.duplicateMacAcknowledged) },
    ...(requiredCustomFields.length ? [{ label: "Required extras", complete: requiredCustomComplete }] : []),
  ];
  const requiredCompleteCount = requiredProgress.filter((item) => item.complete).length;
  const optionalFieldCount = optionalCustomFields.length;
  const optionalValueCount = optionalCustomFields.filter((field) => (record.customValues ?? {})[field.id]?.trim()).length;
  const beneficiaryContacts = beneficiaryContactList(record);
  const sectionLinks = [
    { id: "site-details-section", label: "Details", complete: requiredProgress.find((item) => item.label === "Site details")?.complete },
    { id: "site-location-section", label: "Location", complete: requiredProgress.find((item) => item.label === "Location")?.complete },
    ...(requiredCustomFields.length ? [{ id: "required-additional-section", label: "Required extras", complete: requiredCustomComplete }] : []),
    ...(optionalCustomFields.length ? [{ id: "optional-additional-section", label: "Optional extras", complete: optionalValueCount === optionalFieldCount }] : []),
    { id: "equipment-section", label: "Equipment", complete: requiredProgress.find((item) => item.label === "Equipment")?.complete },
    { id: "beneficiary-contact-section", label: "Contacts", complete: beneficiaryContacts.some(contactHasValue) },
    { id: "remarks-photos-section", label: "Remarks", complete: Boolean(record.remarks || record.photos.length) },
  ];

  function showValidationErrors() { setTriedSubmit(true); requestAnimationFrame(() => validationSummaryRef.current?.focus()); }
  function scrollToSection(id: string) {
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    document.getElementById(id)?.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
  }
  function focusValidationTarget(id: string) {
    const target = document.getElementById(id);
    target?.scrollIntoView({ behavior: "smooth", block: "center" });
    if (target instanceof HTMLElement) target.focus({ preventScroll: true });
  }
  function savedRecord() { return syncedBeneficiaryFields({ ...record, components: record.components.map((component) => ({ ...component, values: Object.fromEntries(Object.entries(component.values ?? {}).map(([id, value]) => { const attachment = visibleComponentFields(refs, component).find((field) => field.id === id); return [id, attachment && libraryField(refs, attachment)?.type === "mac" && value ? normalizeMac(value) : value]; })) })), updatedBy: actorName, updatedAt: new Date().toISOString() }); }
  async function persistRecord() {
    setSaving(true);
    const next = savedRecord();
    try {
      await onSave(next);
      setRecord(next);
      setOriginal(JSON.parse(JSON.stringify(next)));
    } finally {
      setSaving(false);
    }
  }
  async function submit(e: FormEvent) { e.preventDefault(); if (saving || !isDirty) return; if (hasValidationError) { showValidationErrors(); return; } await persistRecord(); }
  function addComponent() { patch({ components: [...record.components, componentDraft(refs.componentTypes.find((x) => x.active)?.name ?? "", record.components.length)] }); }
  function componentPatch(id: string, data: Partial<Component>) { patch({ components: record.components.map((c) => c.id === id ? { ...c, ...data } : c) }); }
  function deleteComponent(id: string) { patch({ components: record.components.filter((component) => component.id !== id) }); setDeleteComponentId(undefined); }
  function addBeneficiaryContact() { patch({ beneficiaryContacts: [...beneficiaryContacts, contactDraft()] }); }
  function beneficiaryContactPatch(id: string, data: Partial<BeneficiaryContact>) { patch({ beneficiaryContacts: beneficiaryContacts.map((contact) => contact.id === id ? { ...contact, ...data } : contact) }); }
  function removeBeneficiaryContact(id: string) { patch({ beneficiaryContacts: beneficiaryContacts.filter((contact) => contact.id !== id) }); }
  async function submitNewContractor() {
    if (contractorSaving) return;
    setContractorSaving(true); setContractorError("");
    try {
      const name = await onAddContractor(newContractorName);
      patch({ contractor: name });
      setNewContractorName("");
      setAddingContractor(false);
    } catch (error) {
      setContractorError(errorMessage(error, "Unable to add contractor."));
    } finally {
      setContractorSaving(false);
    }
  }
  function photos(e: ChangeEvent<HTMLInputElement>) { const files = Array.from(e.target.files ?? []).slice(0, 4); patch({ photos: [...record.photos, ...files.map((file) => ({ name: file.name, url: URL.createObjectURL(file) }))] }); }
  async function copyForExcel(part: "first" | "last") {
    try {
      await navigator.clipboard.writeText(installationExcelClipboardRow(record, refs, part));
      setExcelCopyState(part);
      window.setTimeout(() => setExcelCopyState("idle"), 2400);
    } catch {
      setExcelCopyState("error");
    }
  }
  async function copyLatLong() {
    try {
      await navigator.clipboard.writeText([record.latitude, record.longitude].map((value) => value.trim()).filter(Boolean).join(", "));
      setLatLongCopyState("copied");
      window.setTimeout(() => setLatLongCopyState("idle"), 2400);
    } catch {
      setLatLongCopyState("error");
    }
  }
  async function copyPlusCode() {
    try {
      const plusCode = plusCodeFromStrings(record.latitude, record.longitude);
      if (!plusCode) throw new Error("Invalid coordinates");
      await navigator.clipboard.writeText(plusCode);
      setPlusCodeCopyState("copied");
      window.setTimeout(() => setPlusCodeCopyState("idle"), 2400);
    } catch {
      setPlusCodeCopyState("error");
    }
  }
  async function copySiteDetailsLabel() {
    try {
      await navigator.clipboard.writeText(["ELRN", record.id.trim(), record.siteName.trim()].join("-"));
      setSiteDetailsCopyState("copied");
      window.setTimeout(() => setSiteDetailsCopyState("idle"), 2400);
    } catch {
      setSiteDetailsCopyState("error");
    }
  }
  async function copyRouterContactRow() {
    try {
      await navigator.clipboard.writeText(installationRouterContactClipboardRow(record, refs));
      setRouterContactCopyState("copied");
      window.setTimeout(() => setRouterContactCopyState("idle"), 2400);
    } catch {
      setRouterContactCopyState("error");
    }
  }
  async function openAudit() {
    setTab("audit");
    if (auditLoaded || auditLoading || !record.dbId || !fetchAuditEvents) return;
    setAuditLoading(true); setAuditError("");
    try { setAuditEvents(await fetchAuditEvents(record.dbId)); setAuditLoaded(true); }
    catch (error) { setAuditError(error instanceof Error ? error.message : "Unable to load the change log."); }
    finally { setAuditLoading(false); }
  }
  async function openVisits() {
    setTab("visits");
    if (visitsLoaded || visitsLoading || !record.dbId || !fetchServiceVisits) return;
    setVisitsLoading(true); setVisitsError("");
    try { setServiceVisits(await fetchServiceVisits(record.dbId)); setVisitsLoaded(true); }
    catch (error) { setVisitsError(error instanceof Error ? error.message : "Unable to load service visits."); }
    finally { setVisitsLoading(false); }
  }

  function handleDiscard() {
    setShowExitModal(false);
    clearNavAttempt();
    onCancel();
  }

  function handleKeepEditing() {
    setShowExitModal(false);
    // Keep navAttempt intact because the user chose to stay; navAttempt will re-trigger if they navigate again.
    clearNavAttempt();
  }

  async function handleSaveAndExit() {
    if (saving) return;
    if (hasValidationError) { setShowExitModal(false); showValidationErrors(); return; }
    setShowExitModal(false);
    await persistRecord();
  }

  async function handleDelete() {
    if (!initial || !onDelete || deleting) return;
    setDeleting(true);
    setDeleteError("");
    try {
      await onDelete(initial);
    } catch (error) {
      setDeleteError(errorMessage(error, "Unable to delete site record."));
      setDeleting(false);
    }
  }

  return <form onSubmit={submit} data-save-shortcut="site-form" noValidate>
    <div className="page-head site-record-head"><div><p className="eyebrow">{initial ? "Site record" : "New site"}</p><div className="site-record-heading-row"><h1>{initial ? initial.siteName || "Site name required" : "Add a site record"}</h1>{initial && <StatusPill status={record.status} refs={refs} />}</div>{initial && <div className="small muted record-id">School ID: {initial.id}</div>}<p className="muted site-record-description">{initial ? readOnly ? "Review site details, contractor visits, and change history." : "Update site details and deployed equipment." : "Review site details, contractor visits, and change history."}</p></div><div className="site-record-actions"><div className="site-record-main-actions"><button type="button" className="button" disabled={saving || deleting} onClick={() => { if (isDirty) { setShowExitModal(true); } else { onCancel(); } }}>Back to sites</button>{initial && !readOnly && onDelete && <button type="button" className="button danger" disabled={saving || deleting} onClick={() => setShowDeleteModal(true)}><Trash2 size={15} />Delete site</button>}{!readOnly && <button className="button primary" disabled={!isDirty || saving || deleting}>{saving ? "Saving..." : initial ? "Save changes" : "Save site"}</button>}</div><div className="site-record-copy-actions" aria-label="Copy Excel values"><button type="button" className="button ghost site-record-copy-button" disabled={saving || deleting} onClick={() => void copyForExcel("first")} title="Copy Island Group, Site Code, Site Name, and Site Complete Address"><ClipboardCopy size={14} />{excelCopyState === "first" ? "Copied school columns" : excelCopyState === "error" ? "Copy failed" : "Copy school columns"}</button><button type="button" className="button ghost site-record-copy-button" disabled={saving || deleting} onClick={() => void copyForExcel("last")} title="Copy Starlink kit, coordinates, activation, endorser, contractor, and region"><ClipboardCopy size={14} />{excelCopyState === "last" ? "Copied activation columns" : "Copy activation columns"}</button></div></div></div>
    <div className="tabs" role="tablist" aria-label="Site record sections" onKeyDown={handleTabKeyDown}><button type="button" id="site-tab-overview" role="tab" aria-controls="site-panel-overview" aria-selected={tab === "overview"} tabIndex={tab === "overview" ? 0 : -1} className={tab === "overview" ? "active" : ""} onClick={() => setTab("overview")}>Overview</button><button type="button" id="site-tab-visits" role="tab" aria-controls="site-panel-visits" aria-selected={tab === "visits"} tabIndex={tab === "visits" ? 0 : -1} className={tab === "visits" ? "active" : ""} onClick={() => void openVisits()}>Service visits {visitsLoaded && <span>{serviceVisits.length}</span>}</button><button type="button" id="site-tab-audit" role="tab" aria-controls="site-panel-audit" aria-selected={tab === "audit"} tabIndex={tab === "audit" ? 0 : -1} className={tab === "audit" ? "active" : ""} onClick={() => void openAudit()}>Change log {auditLoaded && <span>{auditEvents.length}</span>}</button></div>
    {triedSubmit && hasValidationError && <div className="notice validation-notice validation-summary inline" role="alert" tabIndex={-1} ref={validationSummaryRef}><strong>Check the highlighted site details before saving.</strong><ul>{validationItems.map((item) => <li key={item.id}><a href={`#${item.target}`} onClick={(event) => { event.preventDefault(); focusValidationTarget(item.target); }}>{item.text}</a></li>)}</ul></div>}
    {tab === "overview" && <div className="site-workflow-bar" aria-label="Overview workflow">
      <div className="site-workflow-summary"><strong>{requiredCompleteCount} of {requiredProgress.length} required ready</strong><span className="small muted">{readOnly ? "Review mode" : isDirty ? "Unsaved changes" : "Saved"}</span></div>
      <nav className="site-section-nav" aria-label="Overview sections">{sectionLinks.map((link) => <button type="button" className={`site-section-nav-button ${link.complete ? "complete" : ""}`} key={link.id} onClick={() => scrollToSection(link.id)}>{link.complete ? <CheckCircle2 size={13} /> : <CircleDot size={13} />}{link.label}</button>)}</nav>
      {!readOnly && <button className="button primary site-workflow-save" disabled={!isDirty || saving || deleting}>{saving ? "Saving..." : initial ? "Save changes" : "Save site"}</button>}
    </div>}
    {tab === "overview" && <fieldset id="site-panel-overview" aria-labelledby="site-tab-overview" className="panel site-fields editing" role="tabpanel" disabled={readOnly}>
      {!initial && !readOnly && <section className="section paste-report-panel" aria-labelledby="paste-report-title">
        <button type="button" className="paste-report-disclosure" aria-expanded={pastePanelOpen} onClick={() => setPastePanelOpen((open) => !open)}>
          <span className="paste-report-icon"><ClipboardPaste size={18} /></span><span><strong id="paste-report-title">Paste activation report</strong><small>{extractionSummary ? `${extractionSummary.filled} values filled · ${extractionSummary.missing} missing · ${extractionSummary.warnings.length} warnings` : "Extract school, location, equipment, and contact details"}</small></span><ChevronDown size={17} className={pastePanelOpen ? "open" : ""} />
        </button>
        {pastePanelOpen && <div className="paste-report-body"><label>Activation report<textarea className="textarea paste-report-textarea" rows={10} maxLength={50000} value={pasteReport} onChange={(event) => setPasteReport(event.target.value)} placeholder="Paste the contractor activation message here" /></label><div className="paste-report-actions"><span className="small muted">{pasteReport.length.toLocaleString()} / 50,000 characters</span><div className="toolbar"><button type="button" className="button" disabled={Boolean(extractingReport) || !pasteReport.trim()} onClick={() => void extractReport("gemini")}>{extractingReport === "gemini" ? "Checking..." : "Check with Gemini"}</button><button type="button" className="button primary" disabled={Boolean(extractingReport) || !pasteReport.trim()} onClick={() => void extractReport("local")}><ClipboardPaste size={15} />{extractingReport === "local" ? "Extracting..." : "Extract and fill"}</button></div></div>{extractionError && <div className="notice validation-notice inline" role="alert">{extractionError}</div>}</div>}
        {!pastePanelOpen && extractionSummary && <div className="paste-report-summary" role="status"><div><strong>{extractionSummary.source === "gemini" ? "Gemini check applied" : "Report extracted"}</strong><span className="small muted">{extractionSummary.filled} values filled, {extractionSummary.missing} expected values missing.</span></div><button type="button" className="button" onClick={() => setPastePanelOpen(true)}>Reopen</button>{extractionSummary.warnings.length > 0 && <ul>{extractionSummary.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>}{extractionSummary.diagnostics.length > 0 && <div className="small muted paste-report-diagnostics">{extractionSummary.diagnostics.join(" ")}</div>}</div>}
      </section>}
      {initial && <section className="section ownership-grid" aria-label="Saved record metadata"><div><span className="small muted">Created by</span><strong>{record.createdBy}</strong></div><div><span className="small muted">Created</span><strong>{niceDateTime(record.createdAt)}</strong></div><div><span className="small muted">Updated by</span><strong>{record.updatedBy}</strong></div><div><span className="small muted">Last saved</span><strong>{niceDateTime(record.updatedAt)}</strong></div></section>}
      <section id="site-details-section" className="section site-details-polish site-details-guided"><div className="section-title"><div><h2>Site details</h2><span className="small muted">Identity, ownership, and current installation state</span></div><div className="toolbar"><button type="button" className="button" disabled={saving || deleting || !record.id.trim() || !record.siteName.trim()} onClick={() => void copySiteDetailsLabel()} title="Copy ELRN school label"><ClipboardCopy size={15} />{siteDetailsCopyState === "copied" ? "Copied Site Label" : siteDetailsCopyState === "error" ? "Copy failed" : "Copy Site Label"}</button><button type="button" className="button" disabled={saving || deleting || !record.id.trim()} onClick={() => void copyRouterContactRow()} title="Copy School ID, site name, Ruijie serial, contact person, and contact number"><ClipboardCopy size={15} />{routerContactCopyState === "copied" ? "Copied Details" : routerContactCopyState === "error" ? "Copy failed" : "Copy Details"}</button></div></div><div className="grid-3">
        <label className="school-lookup">Site name<input id="site-name-input" required className="field" role="combobox" aria-autocomplete="list" aria-expanded={schoolLookupOpen && schoolMatches.length > 0} aria-controls="school-directory-results" aria-invalid={Boolean((triedSubmit && missingSiteName) || duplicate) || undefined} aria-describedby={siteNameDescriptions} value={record.siteName} onFocus={() => setSchoolLookupOpen(true)} onBlur={() => window.setTimeout(() => setSchoolLookupOpen(false), 120)} onKeyDown={schoolLookupKeyDown} onChange={(e) => { patch({ siteName: e.target.value }); setSchoolLookupOpen(true); setSchoolLookupNotice(""); }} placeholder="Search or enter a school name" />{schoolLookupOpen && record.siteName.trim().length >= 2 && schoolMatches.length > 0 && <div className="school-lookup-results" id="school-directory-results" role="listbox">{schoolMatches.map((entry, index) => <button type="button" className={`school-lookup-option ${index === schoolLookupIndex ? "active" : ""}`} role="option" aria-selected={index === schoolLookupIndex} key={entry.id} onMouseDown={(event) => event.preventDefault()} onClick={() => selectDirectorySchool(entry)}><span className="school-lookup-name">{entry.schoolName}</span><span className="school-lookup-province">{entry.province || "Province unavailable"}</span></button>)}</div>}</label>
        <label>School ID<input id="school-id-input" required className="field" aria-invalid={Boolean((triedSubmit && !schoolId) || duplicateSchoolId) || undefined} aria-describedby={schoolIdDescriptions} value={record.id} onChange={(e) => patch({ id: e.target.value })} placeholder="School ID" /></label>
        <label>Solution<select id="solution-input" className="select" aria-invalid={Boolean(triedSubmit && missingUnitType) || undefined} aria-describedby={triedSubmit && missingUnitType ? "solution-required-error" : undefined} value={record.unitType} onChange={(e) => patch({ unitType: e.target.value })}>{activeOptions(refs.unitTypes, record.unitType).map((x) => <option key={x.id}>{x.name}</option>)}</select></label>
        <div><label>Contractor<select id="contractor-input" className="select" aria-invalid={Boolean(triedSubmit && missingContractor) || undefined} aria-describedby={triedSubmit && missingContractor ? "contractor-required-error" : undefined} value={record.contractor} onChange={(e) => { if (e.target.value === addContractorOption) { setAddingContractor(true); setContractorError(""); return; } patch({ contractor: e.target.value }); }}>{activeOptions(refs.contractors, record.contractor).map((x) => <option key={x.id}>{x.name}</option>)}<option value={addContractorOption}>+ Add contractor</option></select></label>{addingContractor && <div style={{ display: "grid", gap: 8, marginTop: 8 }}><input className="field" value={newContractorName} onChange={(e) => setNewContractorName(e.target.value)} placeholder="New contractor name" disabled={contractorSaving} /><div className="toolbar"><button type="button" className="button" disabled={contractorSaving} onClick={() => { setAddingContractor(false); setNewContractorName(""); setContractorError(""); }}>Cancel</button><button type="button" className="button primary" disabled={contractorSaving || !newContractorName.trim()} onClick={() => void submitNewContractor()}>{contractorSaving ? "Adding..." : "Add and select"}</button></div>{contractorError && <div className="small validation-copy">{contractorError}</div>}</div>}</div>
        <label>Installer / Team lead<input className="field" value={record.installerTeamLead} onChange={(e) => patch({ installerTeamLead: e.target.value })} placeholder="Installer or team lead name" /></label>
        <label>Installation date<input id="install-date-input" required className="field" type="date" aria-invalid={Boolean(triedSubmit && missingInstallDate) || undefined} aria-describedby={triedSubmit && missingInstallDate ? "install-date-required-error" : undefined} value={record.installDate} onChange={(e) => patch({ installDate: e.target.value })} /></label>
        <label>Activation date<input className="field" type="date" value={record.activationDate ?? ""} placeholder={today()} onChange={(e) => patch({ activationDate: e.target.value || undefined })} /></label>
        <label>Status<select className="select" value={record.status} onChange={(e) => patch({ status: e.target.value as Status })}>{siteStatusOptions(refs, record.status).map((status) => <option value={status.value} key={status.value}>{status.name}</option>)}</select></label>
      </div>{schoolLookupNotice && <div className="small muted school-lookup-notice" role="status">{schoolLookupNotice}</div>}{triedSubmit && missingSiteName && <div id="site-name-error" className="notice validation-notice inline" role="alert"><strong>Site name is required.</strong> Enter or choose the school name before saving.</div>}{triedSubmit && !schoolId && <div id="school-id-required-error" className="notice validation-notice inline" role="alert"><strong>School ID is required.</strong> Enter the official school identifier before saving.</div>}{duplicateSchoolId && <div id="school-id-duplicate-error" className="notice validation-notice inline" role="alert"><strong>This School ID already exists.</strong> Enter a unique School ID before saving.</div>}{duplicate && <div id="site-name-duplicate-error" className="notice validation-notice inline" role="alert"><strong>This site name already exists.</strong> Enter a unique site name before saving.</div>}{triedSubmit && missingUnitType && <div id="solution-required-error" className="notice validation-notice inline" role="alert"><strong>Solution is required.</strong> Choose the installation solution before saving.</div>}{triedSubmit && missingContractor && <div id="contractor-required-error" className="notice validation-notice inline" role="alert"><strong>Contractor is required.</strong> Choose or add the contractor before saving.</div>}{triedSubmit && missingInstallDate && <div id="install-date-required-error" className="notice validation-notice inline" role="alert"><strong>Installation date is required.</strong> Enter the installation date before saving.</div>}{record.legacyKitNumber && <div className="notice inline legacy-kit-prompt"><span className="small migration-label">Migration follow-up</span><strong>Assign old kit number: {record.legacyKitNumber}</strong><div className="small">Add the correct equipment, enter this value in its kit-number field, then mark this follow-up as assigned.</div><button type="button" className="button" onClick={() => patch({ legacyKitNumber: undefined })}>Mark kit number assigned</button></div>}</section>
      <section id="site-location-section" className="section"><div className="section-title"><div><h2>Site location</h2><span className="small muted">PSGC-aligned fields use the selected school directory match</span></div><div className="toolbar"><button type="button" className="button" disabled={saving || deleting || (!record.latitude.trim() && !record.longitude.trim())} onClick={() => void copyLatLong()} title="Copy latitude and longitude"><ClipboardCopy size={15} />{latLongCopyState === "copied" ? "Copied Coordinates" : latLongCopyState === "error" ? "Copy failed" : "Copy Coordinates"}</button><button type="button" className="button" disabled={saving || deleting || !record.latitude.trim() || !record.longitude.trim()} onClick={() => void copyPlusCode()} title="Copy Google Maps Plus Code from latitude and longitude"><ClipboardCopy size={15} />{plusCodeCopyState === "copied" ? "Copied Plus Code" : plusCodeCopyState === "error" ? "Copy failed" : "Copy Plus Code"}</button></div></div><div className="grid-4">
        <LocationCombobox inputId="island-group-input" label="Island group" placeholder="Search island group" value={record.islandGroup} options={islandGroups.map((group) => ({ code: group, name: group }))} invalid={triedSubmit && !record.islandGroup} describedBy={locationDescription} onSelect={(selected) => patch({ islandGroup: selected.code as Installation["islandGroup"], region: "", regionCode: "", province: "", provinceCode: "", municipality: "", municipalityCode: "", barangay: "", barangayCode: "" })} />
        <LocationCombobox inputId="region-input" label="Region" placeholder="Search region" value={record.regionCode} options={regions} loading={regionChoices.loading} disabled={!record.islandGroup} invalid={triedSubmit && !record.regionCode} describedBy={locationDescription} onSelect={(selected) => patch({ region: selected.name, regionCode: selected.code, province: "", provinceCode: "", municipality: "", municipalityCode: "", barangay: "", barangayCode: "" })} />
        <LocationCombobox inputId="province-input" label="Province" placeholder="Search province" value={record.provinceCode} options={provinceChoices.options} loading={provinceChoices.loading} disabled={!record.regionCode} invalid={triedSubmit && !record.provinceCode} describedBy={locationDescription} onSelect={(selected) => patch({ province: selected.name, provinceCode: selected.code, municipality: "", municipalityCode: "", barangay: "", barangayCode: "" })} />
        <LocationCombobox inputId="locality-input" label="Locality" placeholder="Search locality" value={record.municipalityCode} options={municipalityChoices.options} loading={municipalityChoices.loading} disabled={!record.provinceCode} invalid={triedSubmit && !record.municipalityCode} describedBy={locationDescription} onSelect={(selected) => patch({ municipality: selected.name, municipalityCode: selected.code, barangay: "", barangayCode: "" })} />
        <LocationCombobox label="Barangay" placeholder="Search barangay" value={record.barangayCode} options={barangayChoices.options} loading={barangayChoices.loading} disabled={!record.municipalityCode} clearLabel="No barangay" onClear={() => patch({ barangay: "", barangayCode: "" })} onSelect={(selected) => patch({ barangay: selected.name, barangayCode: selected.code })} />
        <label>Latitude<input className="field" value={record.latitude} onChange={(e) => patch({ latitude: e.target.value })} placeholder="14.0000" /></label>
        <label>Longitude<input className="field" value={record.longitude} onChange={(e) => patch({ longitude: e.target.value })} placeholder="121.0000" /></label>
      </div><label className="field-block">Contractor-provided address<textarea className="textarea" rows={2} value={record.contractorAddress} onChange={(event) => patch({ contractorAddress: parseContractorAddress(event.target.value) })} placeholder="Paste Complete School Address or the contractor address text" /></label>{locationError && <div className="notice validation-notice inline" role="alert"><strong>Unable to load location options.</strong> {locationError}</div>}{triedSubmit && missingLocation && <div id="location-required-error" className="notice validation-notice inline" role="alert"><strong>Complete the site location.</strong> Select an island group, region, province, and locality.</div>}</section>
      {requiredCustomFields.length > 0 && <section id="required-additional-section" className="section"><div className="section-title"><div><h2>Required additional information</h2><span className="small muted">Configured by your workplace administrator.</span></div></div><div className="grid-3">{requiredCustomFields.map((field) => <CustomFieldInput inputId={`custom-field-${field.id}`} field={field} value={(record.customValues ?? {})[field.id] ?? ""} invalid={triedSubmit && !(record.customValues ?? {})[field.id]?.trim()} describedBy={triedSubmit && !(record.customValues ?? {})[field.id]?.trim() ? "required-custom-error" : undefined} onChange={(value) => patch({ customValues: { ...(record.customValues ?? {}), [field.id]: value } })} key={field.id} />)}</div>{triedSubmit && missingRequiredCustomField && <div id="required-custom-error" className="notice validation-notice inline" role="alert"><strong>Complete required additional information.</strong> Fill in {missingRequiredCustomField.label} before saving.</div>}</section>}
      {optionalCustomFields.length > 0 && <section id="optional-additional-section" className="section collapsible-section"><button type="button" className="button disclosure-button" aria-expanded={showOptionalFields} onClick={() => setShowOptionalFields((show) => !show)}><span><strong>Optional additional information</strong><small>{optionalValueCount ? `${optionalValueCount} of ${optionalFieldCount} filled` : `${optionalFieldCount} optional ${optionalFieldCount === 1 ? "field" : "fields"}`}</small></span><ChevronDown size={15} /></button>{showOptionalFields && <div className="grid-3 collapsible-section-body">{optionalCustomFields.map((field) => <CustomFieldInput field={field} value={(record.customValues ?? {})[field.id] ?? ""} onChange={(value) => patch({ customValues: { ...(record.customValues ?? {}), [field.id]: value } })} key={field.id} />)}</div>}</section>}
      <section id="equipment-section" className="section equipment-section"><div className="section-title equipment-section-title"><div><h2>Equipment</h2><span className="small muted">Record the identifiers shown for each equipment type.</span></div><div className="toolbar"><button type="button" className="button" onClick={addComponent}><Plus size={15} />Add equipment</button></div></div>
        {!record.components.filter((component) => !component.removedAt).length && <div className="dropzone muted">No active equipment recorded yet. Add each device or kit deployed at this site.</div>}
        <div className="equipment-list">{record.components.filter((component) => !component.removedAt).map((c) => <div className="component-template-row" key={c.id}><div className="component-row"><label>Component type<select className="select" value={c.type} onChange={(e) => componentPatch(c.id, { type: e.target.value, values: {}, duplicateMacAcknowledged: false })}>{activeOptions(refs.componentTypes, c.type).map((x) => <option key={x.id}>{x.name}</option>)}</select></label>{visibleComponentFields(refs, c).map((field) => { const reusable = libraryField(refs, field); if (!reusable) return null; const value = (c.values ?? {})[field.id] ?? ""; const isMissing = triedSubmit && field.active && field.required && !value.trim(); const isInvalidMac = reusable.type === "mac" && Boolean(value) && !normalizeMac(value); const isInvalidInteger = reusable.type === "integer" && Boolean(value) && !validInteger(value); const describedBy = [isInvalidMac ? "equipment-mac-error" : "", isInvalidInteger ? "equipment-integer-error" : "", isMissing ? "equipment-required-error" : ""].filter(Boolean).join(" ") || undefined; return <label key={field.id}>{reusable.label}{field.required ? " *" : ""}<EquipmentValueInput id={componentFieldInputId(c.id, field.id)} type={reusable.type} label={reusable.label} required={field.required} invalid={isMissing || isInvalidMac || isInvalidInteger} describedBy={describedBy} value={value} onChange={(nextValue) => componentPatch(c.id, { values: { ...(c.values ?? {}), [field.id]: nextValue }, duplicateMacAcknowledged: false })} onBlur={() => reusable.type === "mac" && value && normalizeMac(value) && componentPatch(c.id, { values: { ...(c.values ?? {}), [field.id]: normalizeMac(value) } })} /></label>; })}<span className="component-actions"><span className="note-action"><button type="button" className={`button icon-button ${c.notes ? "has-note" : ""}`} aria-label={c.notes ? "View or edit component note" : "Add component note"} title={c.notes ? "View or edit component note" : "Add component note"} onClick={() => setNoteComponentId(c.id)}><MessageSquareText size={16} /></button>{c.notes && <span className="note-tooltip" role="tooltip">{c.notes}</span>}</span><button type="button" className="button icon-button danger" aria-label={`Delete ${c.type}`} title="Delete component" onClick={() => setDeleteComponentId(c.id)}><Trash2 size={16} /></button></span></div></div>)}</div>
        {(invalidMac || invalidInteger || missingComponentValue || duplicateMac) && <div className="equipment-validation-stack">
          {invalidMac && <div id="equipment-mac-error" className="notice validation-notice inline" role="alert"><strong>Check the MAC address format.</strong> Use six hexadecimal pairs such as AA:BB:CC:DD:EE:FF.</div>}
          {invalidInteger && <div id="equipment-integer-error" className="notice validation-notice inline" role="alert"><strong>Enter whole numbers for integer equipment fields.</strong> Decimal values are not accepted.</div>}
          {missingComponentValue && <div id="equipment-required-error" className="notice validation-notice inline" role="alert"><strong>Complete the required equipment fields.</strong> Fill in every field marked with an asterisk before saving.</div>}
          {duplicateMac && <div id="equipment-duplicate-mac-error" className="notice validation-notice inline" role="alert"><label style={{ display: "flex", gridTemplateColumns: "auto 1fr", alignItems: "center", gap: 9 }}><input id="duplicate-mac-acknowledgement" type="checkbox" aria-invalid={Boolean(!duplicateMac.duplicateMacAcknowledged) || undefined} aria-describedby="equipment-duplicate-mac-error" checked={Boolean(duplicateMac.duplicateMacAcknowledged)} onChange={(e) => componentPatch(duplicateMac.id, { duplicateMacAcknowledged: e.target.checked })} />This MAC address already appears on {duplicateMacInstallation ? duplicateMacInstallation.id : "another device at this site"}. I reviewed the possible duplicate and want to save this site record.</label></div>}
        </div>}
      </section>
      <section id="beneficiary-contact-section" className="section"><div className="section-title equipment-section-title"><div><h2>Beneficiary contact</h2><span className="small muted">Optional school or site contacts for coordination</span></div><button type="button" className="button" onClick={addBeneficiaryContact}><Plus size={15} />Add contact person</button></div><div className="equipment-list">
        {beneficiaryContacts.map((contact, index) => <div className="component-template-row" key={contact.id}><div className="component-row">
          <label>Name<input className="field" value={contact.name} onChange={(e) => beneficiaryContactPatch(contact.id, { name: e.target.value })} placeholder="Contact person" /></label>
          <label>Phone number<input className="field" value={contact.phone} onChange={(e) => beneficiaryContactPatch(contact.id, { phone: e.target.value })} placeholder="Mobile or landline" /></label>
          {index > 0 && <span className="component-actions"><button type="button" className="button icon-button danger" aria-label="Remove contact person" title="Remove contact person" onClick={() => removeBeneficiaryContact(contact.id)}><Trash2 size={16} /></button></span>}
        </div></div>)}
      </div></section>
      <section id="remarks-photos-section" className="section collapsible-section"><button type="button" className="button disclosure-button" aria-expanded={showNotesPhotos} onClick={() => setShowNotesPhotos((show) => !show)}><span><strong>Remarks and photos</strong><small>{record.remarks || record.photos.length ? `${record.remarks ? "Notes added" : "No notes"} | ${record.photos.length} ${record.photos.length === 1 ? "photo" : "photos"}` : "Optional notes and photo evidence"}</small></span><ChevronDown size={15} /></button>{showNotesPhotos && <div className="grid-2 collapsible-section-body"><div><div className="section-title"><h2>Remarks</h2></div><textarea className="textarea" rows={5} value={record.remarks} onChange={(e) => patch({ remarks: e.target.value })} placeholder="Activation notes, issue details, or follow-up action" /></div><div><div className="section-title"><h2>Site photos</h2><span className="small muted">Optional, up to 4 images</span></div><label className="dropzone"><ImagePlus size={21} style={{ margin: "auto" }} /><span>Choose site photos</span><input type="file" accept="image/*" multiple hidden onChange={photos} /></label>{record.photos.length > 0 && <p className="small muted">{record.photos.map((p) => p.name).join(", ")}</p>}</div></div>}</section>
    </fieldset>}
    {tab === "visits" && <div id="site-panel-visits" aria-labelledby="site-tab-visits" className="panel" role="tabpanel"><div className="panel-head"><div><h2>Service visits</h2><div className="small muted">Contractor revisits, maintenance, and equipment changes</div></div>{!readOnly && <button type="button" className="button primary" onClick={() => navigate(`/service-visits/new?site=${encodeURIComponent(record.id)}&returnTo=${encodeURIComponent(`/sites/${record.id}`)}`)}><Plus size={15} />New service visit</button>}</div>{visitsLoading ? <div className="section muted">Loading service visits...</div> : visitsError ? <div className="section notice validation-notice"><strong>Unable to load service visits.</strong> {visitsError}</div> : <ServiceVisitTable visits={serviceVisits.map((visit) => ({ installation: record, visit }))} onSelect={(_, visit) => navigate(`/service-visits/${encodeURIComponent(visit.id)}?returnTo=${encodeURIComponent(`/sites/${record.id}`)}`)} />}</div>}
    {tab === "audit" && <div id="site-panel-audit" aria-labelledby="site-tab-audit" className="panel" role="tabpanel"><div className="panel-head"><div><h2>Change log</h2><div className="small muted">Permanent history of record updates and service activity</div></div><History size={18} className="muted" /></div>{auditLoading ? <div className="section muted">Loading change log...</div> : auditError ? <div className="section notice validation-notice"><strong>Unable to load the change log.</strong> {auditError}</div> : <AuditTimeline events={auditEvents} />}</div>}
    {noteComponentId && <ComponentNoteModal component={record.components.find((component) => component.id === noteComponentId)} onChange={(notes) => componentPatch(noteComponentId, { notes })} onClose={() => setNoteComponentId(undefined)} />}
    {deleteComponentId && <DeleteComponentModal component={record.components.find((component) => component.id === deleteComponentId)} onCancel={() => setDeleteComponentId(undefined)} onConfirm={() => deleteComponent(deleteComponentId)} />}
    {showDeleteModal && initial && (
      <div className="modal-backdrop" role="presentation">
        <div className="modal-panel" role="alertdialog" aria-modal="true" aria-labelledby="delete-site-title">
          <div className="modal-icon"><AlertTriangle size={20} /></div>
          <h2 id="delete-site-title">Delete {initial.siteName || initial.id} permanently?</h2>
          <p className="muted">This cannot be undone. The site record, equipment, photos, service visits, and change history for School ID {initial.id} will be removed.</p>
          {deleteError && <div className="notice validation-notice inline" role="alert">{deleteError}</div>}
          <div className="modal-actions">
            <button type="button" className="button" disabled={deleting} onClick={() => { setShowDeleteModal(false); setDeleteError(""); }}>Cancel</button>
            <button type="button" className="button danger-solid" disabled={deleting} onClick={() => void handleDelete()}><Trash2 size={15} />{deleting ? "Deleting..." : "Delete site"}</button>
          </div>
        </div>
      </div>
    )}
    {shouldShowExitModal && (
      <div className="modal-backdrop" role="presentation">
        <div className="modal-panel" role="dialog" aria-modal="true" aria-labelledby="exit-confirm-title" onClick={(e) => e.stopPropagation()}>
          <div className="modal-header">
            <div>
              <h2 id="exit-confirm-title">Unsaved Changes</h2>
              <p className="muted" style={{ marginTop: 8 }}>
                You have edited the site details. Would you like to save your changes before exiting, or discard them and lose all new data?
              </p>
            </div>
            <button type="button" className="button icon-button ghost" aria-label="Close" onClick={handleKeepEditing}>
              <X size={17} />
            </button>
          </div>
          <div className="modal-actions" style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 24 }}>
            <button type="button" className="button danger" disabled={saving} onClick={handleDiscard}>
              Discard changes
            </button>
            <button type="button" className="button" disabled={saving} onClick={handleKeepEditing}>
              Keep editing
            </button>
            <button type="button" className="button primary" disabled={saving} onClick={() => void handleSaveAndExit()}>
              {saving ? "Saving..." : "Save changes"}
            </button>
          </div>
        </div>
      </div>
    )}
  </form>;
}

function ComponentNoteModal({ component, onChange, onClose }: { component?: Component; onChange: (notes: string) => void; onClose: () => void }) {
  const [notes, setNotes] = useState(component?.notes ?? "");
  useEscape(onClose, Boolean(component));
  if (!component) return null;
  return <div className="modal-backdrop" role="presentation"><div className="modal-panel" role="dialog" aria-modal="true" aria-labelledby={`note-${component.id}`}><div className="modal-header"><div><h2 id={`note-${component.id}`}>Equipment note</h2><p className="muted">Add site-specific context for this {component.type.toLowerCase()}.</p></div><button type="button" className="button icon-button ghost" aria-label="Close equipment note" onClick={onClose}><X size={17} /></button></div><label>Notes<textarea autoFocus className="textarea" rows={5} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional condition, issue, or follow-up note" /></label><div className="modal-actions"><button type="button" className="button" onClick={onClose}>Cancel</button><button type="button" className="button primary" onClick={() => { onChange(notes); onClose(); }}>Save note</button></div></div></div>;
}

function DeleteComponentModal({ component, onCancel, onConfirm }: { component?: Component; onCancel: () => void; onConfirm: () => void }) {
  useEscape(onCancel, Boolean(component));
  if (!component) return null;
  return <div className="modal-backdrop" role="presentation"><div className="modal-panel" role="alertdialog" aria-modal="true" aria-labelledby={`delete-component-${component.id}`}><div className="modal-icon"><AlertTriangle size={20} /></div><h2 id={`delete-component-${component.id}`}>Delete {component.type || "this component"}?</h2><p className="muted">This will remove the equipment from the site record when you save changes.</p><div className="modal-actions"><button type="button" className="button" onClick={onCancel}>Cancel</button><button type="button" className="button danger-solid" onClick={onConfirm}><Trash2 size={15} />Delete component</button></div></div></div>;
}

function LocationCombobox({ label, placeholder, value, options, loading = false, disabled = false, invalid = false, describedBy, inputId, clearLabel, onClear, onSelect }: { label: string; placeholder: string; value: string; options: LocationOption[]; loading?: boolean; disabled?: boolean; invalid?: boolean; describedBy?: string; inputId?: string; clearLabel?: string; onClear?: () => void; onSelect: (option: LocationOption) => void }) {
  const root = useRef<HTMLDivElement>(null);
  const id = useId();
  const listId = `${id}-location-options`;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const selected = options.find((option) => option.code === value);
  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("en-PH");
    return normalized ? options.filter((option) => option.name.toLocaleLowerCase("en-PH").includes(normalized)) : options;
  }, [options, query]);
  const activeOptionId = open && filtered[activeIndex] ? `${id}-location-option-${activeIndex}` : undefined;
  useEffect(() => {
    if (!open) return;
    function close(event: MouseEvent) { if (root.current && !root.current.contains(event.target as Node)) setOpen(false); }
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  function choose(option: LocationOption) { onSelect(option); setQuery(""); setOpen(false); setActiveIndex(0); }
  function clear() { onClear?.(); setQuery(""); setOpen(false); setActiveIndex(0); }
  return <label>{label}<div className="location-combobox" ref={root} style={{ position: "relative" }}>
    <Search className="location-combobox-icon" size={15} style={{ pointerEvents: "none", position: "absolute", zIndex: 2, left: 10, top: 11 }} />
    <input id={inputId} className="field location-combobox-input" style={{ paddingLeft: 33, paddingRight: onClear && value ? 36 : undefined }} role="combobox" aria-autocomplete="list" aria-haspopup="listbox" aria-expanded={open} aria-controls={listId} aria-activedescendant={activeOptionId} aria-label={`Search ${label.toLowerCase()}`} aria-invalid={invalid || undefined} aria-describedby={describedBy} disabled={disabled || loading} value={open ? query : selected?.name ?? ""} placeholder={loading ? `Loading ${label.toLowerCase()}s...` : placeholder} onFocus={() => { setQuery(""); setOpen(true); setActiveIndex(0); }} onBlur={() => window.setTimeout(() => { if (root.current && !root.current.contains(document.activeElement)) setOpen(false); }, 0)} onChange={(event) => { setQuery(event.target.value); setOpen(true); setActiveIndex(0); }} onKeyDown={(event) => { if (event.key === "Escape") { setOpen(false); return; } if (event.key === "ArrowDown") { event.preventDefault(); setActiveIndex((index) => open ? Math.min(index + 1, Math.max(filtered.length - 1, 0)) : 0); setOpen(true); } if (event.key === "ArrowUp") { event.preventDefault(); setActiveIndex((index) => open ? Math.max(index - 1, 0) : Math.max(filtered.length - 1, 0)); setOpen(true); } if (event.key === "Enter" && open && filtered[activeIndex]) { event.preventDefault(); choose(filtered[activeIndex]); } }} />
    {onClear && value && !disabled && !loading && <button type="button" className="button icon-button ghost" aria-label={`Clear ${label.toLowerCase()}`} title={`Clear ${label.toLowerCase()}`} style={{ position: "absolute", zIndex: 3, right: 4, top: 4, width: 29, height: 29 }} onClick={clear}><X size={15} /></button>}
    {open && !disabled && !loading && <div className="location-combobox-options" id={listId} role="listbox" aria-label={`${label} options`} style={{ position: "absolute", zIndex: 15, top: "calc(100% + 5px)", left: 0, right: 0, maxHeight: 230, overflowY: "auto", padding: 4, border: "1px solid var(--line)", borderRadius: 8, background: "var(--surface)", boxShadow: "0 8px 16px oklch(0.25 0.03 158 / .12)" }}>{onClear && <div className="location-combobox-option" role="option" aria-selected={!value} tabIndex={-1} style={{ display: "block", width: "100%", border: 0, borderRadius: 6, padding: "8px 9px", textAlign: "left" }} onMouseDown={(event) => { event.preventDefault(); clear(); }}>{clearLabel ?? "None"}</div>}{filtered.length ? filtered.map((option, index) => <div className={`location-combobox-option ${index === activeIndex ? "active" : ""}`} id={`${id}-location-option-${index}`} role="option" aria-selected={option.code === value} tabIndex={-1} key={option.code} style={{ display: "block", width: "100%", border: 0, borderRadius: 6, padding: "8px 9px", textAlign: "left" }} onMouseEnter={() => setActiveIndex(index)} onMouseDown={(event) => { event.preventDefault(); choose(option); }}>{option.name}</div>) : <div className="location-combobox-empty">No matching {label.toLowerCase()}.</div>}</div>}
  </div></label>;
}

function useLocationChoices(level: "region" | "province" | "municipality" | "barangay", parentCode?: string) {
  const enabled = level === "region" || Boolean(parentCode);
  const key = `${level}:${parentCode ?? "root"}`;
  const [result, setResult] = useState<{ key: string; options: LocationOption[]; error: string }>({ key: "", options: [], error: "" });
  useEffect(() => {
    if (!enabled) return;
    let current = true;
    void listLocationOptions(level, parentCode)
      .then((items) => { if (current) setResult({ key, options: items, error: "" }); })
      .catch((cause) => { if (current) setResult({ key, options: [], error: cause instanceof Error ? cause.message : "Unable to load location options." }); });
    return () => { current = false; };
  }, [enabled, key, level, parentCode]);
  return { options: enabled && result.key === key ? result.options : [], loading: enabled && result.key !== key, error: enabled && result.key === key ? result.error : "" };
}

function CustomFieldInput({ field, value, invalid = false, describedBy, inputId, onChange }: { field: CustomFieldDefinition; value: string; invalid?: boolean; describedBy?: string; inputId?: string; onChange: (value: string) => void }) {
  const label = `${field.label}${field.required ? " *" : ""}`;
  const a11y = { id: inputId, "aria-invalid": invalid || undefined, "aria-describedby": describedBy };
  if (field.type === "dropdown") return <label>{label}<select {...a11y} required={field.required} className="select" value={value} onChange={(e) => onChange(e.target.value)}><option value="">Select option</option>{activeOptions(field.options, value).map((option) => <option key={option.id}>{option.name}</option>)}</select></label>;
  return <label>{label}<input {...a11y} required={field.required} className="field" type={field.type} value={value} onChange={(e) => onChange(e.target.value)} placeholder={field.required ? "Required" : "Optional"} /></label>;
}

function resolveSiteStatus(input: string, refs: ReferenceData) {
  const raw = input.trim();
  const normalized = raw.toLowerCase();
  return siteStatusOptions(refs).find((option) => option.value.toLowerCase() === normalized || option.name.toLowerCase() === normalized)?.value ?? "";
}

function ImportRecords({ refs, records, notify, onSaved }: { refs: ReferenceData; records: Installation[]; notify: (s: string) => void; onSaved: () => Promise<void> }) {
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [pendingRecords, setPendingRecords] = useState<Installation[]>([]);
  const [filename, setFilename] = useState("");
  const [saving, setSaving] = useState(false);
  async function downloadTemplate() {
    const wb = await createWorkbook();
    const customFields = (refs.customFields ?? []).filter((field) => field.active).sort((a, b) => a.order - b.order);
    const componentLabels = Array.from(new Set(refs.componentTypes.flatMap((type) => (type.fields ?? []).filter((field) => field.active).map((field) => libraryField(refs, field)?.label).filter(Boolean) as string[])));
    wb.addWorksheet("Installations").addRows([["External Ref", "Site Name", "School ID", "Solution", "Contractor", "Installer / Team Lead", "Install Date", "Activation Date", "Status", "Island Group", "Region", "Region Code", "Province", "Province Code", "Locality", "Locality Code", "Barangay", "Barangay Code", "Longitude", "Latitude", "Beneficiary Name", "Beneficiary Phone", "Additional Beneficiary Contacts", "Remarks", ...customFields.map((field) => field.label)], ["ROW-001", "Cebu Hub 01", "SCH-0001", "Satellite broadband", refs.contractors.find((x) => x.active)?.name ?? "", "Team Lead A", today(), today(), "installed", "Visayas", "Region VII (Central Visayas)", "0700000000", "Cebu", "0730600000", "Cebu City", "30600", "", "", "121.0000", "14.0000", "Juan Dela Cruz", "0917 000 0000", JSON.stringify([{ name: "Maria Santos", phone: "0918 000 0000" }]), "", ...customFields.map(() => "")]]);
    wb.addWorksheet("Components").addRows([["Site Ref", "Component Type", "Notes", ...componentLabels], ["ROW-001", "Modem", "", ...componentLabels.map((label) => label === "Serial number" ? "MDM-00001" : label === "MAC address" ? "A4:5E:60:11:28:9C" : "")]]);
    wb.addWorksheet("Instructions").addRows([
      ["FieldTrack site import guide"],
      ["1. Add one site per row on the Installations sheet. Site Name is required and must be unique."],
      ["2. Give each site a unique External Ref, such as ROW-001. This links equipment to the correct site."],
      ["3. Add deployed equipment on the Components sheet. Enter the matching External Ref under Site Ref."],
      ["4. Fill in the equipment fields that apply to the selected Component Type. Required fields are configured by your admin."],
      ["5. Enter MAC addresses as AA:BB:CC:DD:EE:FF, AA-BB-CC-DD-EE-FF, or 12 hexadecimal characters."],
      ["6. Keep the PSGC code columns for reliable location matching. Barangay is optional; Region, Province, and Locality are required."],
      ["7. Upload the completed workbook in FieldTrack. Review any rows marked Needs attention before saving."],
      [],
      ["Allowed site statuses", siteStatusOptions(refs).map((status) => status.value).join(", ")],
      [],
      ["Custom site fields", "Type or allowed choices"],
      ...customFields.map((field) => [`${field.label}${field.required ? " (required)" : ""}`, field.type === "dropdown" ? field.options.filter((option) => option.active).map((option) => option.name).join(", ") : field.type]),
    ]);
    const buffer = await wb.xlsx.writeBuffer();
    downloadBlob(new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), "fieldtrack-import-template.xlsx");
  }
  async function load(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; if (!file) return;
    setFilename(file.name);
    const { resolveLocation } = await import("@/lib/locations");
    const wb = await createWorkbook(); await wb.xlsx.load(await file.arrayBuffer()); const sheet = wb.getWorksheet("Installations") ?? wb.worksheets[0];
    const headers = (sheet.getRow(1).values as string[]).slice(1).map(String);
    const data: Record<string, string>[] = [];
    sheet.eachRow((row, rowNumber) => { if (rowNumber > 1) { const values = (row.values as string[]).slice(1); data.push(Object.fromEntries(headers.map((header, i) => [header, String(values[i] ?? "")]))); } });
    const siteByRef = new Map<string, Installation>();
    const installationRows = data.map((r, i) => {
      const siteName = String(r["Site Name"] ?? ""); const schoolId = String(r["School ID"] ?? r["Installation ID"] ?? ""); const contractor = String(r.Contractor ?? ""); const unitType = String(r.Solution ?? r["Unit Type"] ?? ""); const status = resolveSiteStatus(String(r.Status ?? ""), refs);
      const location = resolveLocation({ islandGroup: r["Island Group"], region: r.Region, regionCode: r["Region Code"], province: r.Province, provinceCode: r["Province Code"], municipality: r.Locality || r["City/Municipality"], municipalityCode: r["Locality Code"], barangay: r.Barangay, barangayCode: r["Barangay Code"] });
      const customIssue = (refs.customFields ?? []).filter((field) => field.active).map((field) => field.required && !r[field.label] ? `Missing ${field.label}` : field.type === "dropdown" && r[field.label] && !field.options.some((option) => option.active && option.name === r[field.label]) ? `Invalid ${field.label}` : "").find(Boolean);
      const issue = !siteName ? "Missing site name" : !schoolId ? "Missing school ID" : records.some((record) => record.id.toLowerCase() === schoolId.toLowerCase()) ? "Duplicate school ID" : !refs.unitTypes.some((option) => option.active && option.name === unitType) ? "Unknown solution" : !refs.contractors.some((option) => option.active && option.name === contractor) ? "Unknown contractor" : !status ? "Invalid status" : location.issue || customIssue || "";
      if (!issue && location.location) {
        const now = new Date().toISOString();
        const firstContact = { id: crypto.randomUUID(), name: String(r["Beneficiary Name"] ?? ""), role: "", phone: String(r["Beneficiary Phone"] ?? "") };
        const beneficiaryContacts = [firstContact, ...parseAdditionalBeneficiaryContacts(r["Additional Beneficiary Contacts"])].filter(contactHasValue);
        const record: Installation = { id: schoolId, siteName, unitType, contractor, installerTeamLead: String(r["Installer / Team Lead"] ?? r["Installer Team Lead"] ?? ""), installDate: String(r["Install Date"] || today()), activationDate: String(r["Activation Date"] || today()), status: status as Status, ...location.location, contractorAddress: parseContractorAddress(String(r["Complete School Address"] ?? r["Contractor Address"] ?? "")), longitude: String(r.Longitude ?? ""), latitude: String(r.Latitude ?? ""), beneficiaryContacts, beneficiaryName: beneficiaryContacts[0]?.name || "", beneficiaryRole: "", beneficiaryPhone: beneficiaryContacts[0]?.phone || "", remarks: String(r.Remarks ?? ""), components: [], customValues: Object.fromEntries((refs.customFields ?? []).map((field) => [field.id, String(r[field.label] ?? "")])), photos: [], createdBy: "Imported workbook", createdAt: now, updatedBy: "Imported workbook", updatedAt: now, serviceVisits: [], auditEvents: [] };
        siteByRef.set(String(r["External Ref"] ?? ""), record);
      }
      return { row: i + 2, kind: "Site" as const, subject: siteName, details: contractor, reference: location.location ? locationLabel(location.location) : `${r.Barangay ?? ""}, ${r.Locality || r["City/Municipality"] || ""}`, valid: !issue, issue };
    });
    const componentSheet = wb.getWorksheet("Components"); const componentRows: ImportRow[] = [];
    if (componentSheet) { const componentHeaders = (componentSheet.getRow(1).values as string[]).slice(1).map(String); const importedMacs = new Set<string>(); componentSheet.eachRow((row, rowNumber) => { if (rowNumber > 1) { const values = (row.values as string[]).slice(1); const item = Object.fromEntries(componentHeaders.map((header, i) => [header, String(values[i] ?? "")])); const siteRef = item["Site Ref"] || item["Installation Ref"]; const template = componentType(refs, item["Component Type"]); const installation = siteByRef.get(siteRef); const missing = template?.fields.find((field) => { const reusable = libraryField(refs, field); return field.active && field.required && reusable && !item[reusable.label]; }); const macField = template?.fields.find((field) => { const reusable = libraryField(refs, field); return field.active && reusable?.type === "mac" && item[reusable.label]; }); const integerField = template?.fields.find((field) => { const reusable = libraryField(refs, field); return field.active && reusable?.type === "integer" && item[reusable.label] && !validInteger(item[reusable.label]); }); const booleanField = template?.fields.find((field) => { const reusable = libraryField(refs, field); return field.active && reusable?.type === "boolean" && item[reusable.label] && !/^(true|false)$/i.test(item[reusable.label].trim()); }); const missingReusable = missing ? libraryField(refs, missing) : undefined; const macReusable = macField ? libraryField(refs, macField) : undefined; const integerReusable = integerField ? libraryField(refs, integerField) : undefined; const booleanReusable = booleanField ? libraryField(refs, booleanField) : undefined; const mac = macReusable ? item[macReusable.label] : ""; const normalized = normalizeMac(mac); const duplicate = normalized && (importedMacs.has(normalized) || records.some((record) => record.components.some((component) => componentMacValues(refs, component).includes(normalized)))); if (normalized) importedMacs.add(normalized); const issue = !installation ? "Unknown site ref" : !template ? "Unknown equipment type" : missingReusable ? `Missing ${missingReusable.label}` : mac && !normalized ? "Check the MAC address format" : integerReusable ? `${integerReusable.label} must be a whole number` : booleanReusable ? `${booleanReusable.label} must be true or false` : duplicate ? "Duplicate MAC address, review required" : ""; if (!issue && installation && template) installation.components.push({ id: crypto.randomUUID(), type: template.name, notes: item["Notes"] ?? "", values: Object.fromEntries(template.fields.map((field) => { const reusable = libraryField(refs, field); const value = reusable ? String(item[reusable.label] ?? "") : ""; return [field.id, reusable?.type === "boolean" ? value.toLowerCase() : value]; })) }); componentRows.push({ row: rowNumber, kind: "Equipment", subject: item["Component Type"] || "Equipment type required", details: item["Notes"], reference: siteRef, valid: !issue, issue }); } }); }
    setRows([...installationRows, ...componentRows]);
    setPendingRecords([...siteByRef.values()]);
  }
  const valid = rows.filter((r) => r.valid).length;
  return <>
    <div className="page-head"><div><p className="eyebrow">Bulk entry</p><h1>Import site records</h1><p className="muted">Upload a workbook, review the preview, then save rows that are ready.</p></div><button className="button" onClick={downloadTemplate}><Download size={16} />Download workbook template</button></div>
    <div className="panel"><section className="section"><label className="dropzone"><FileSpreadsheet size={26} style={{ margin: "auto" }} /><strong>Choose a completed workbook</strong><span className="small muted">Start with the FieldTrack template. Its Instructions sheet explains how to link equipment to each site.</span><input type="file" accept=".xlsx" hidden onChange={load} /></label></section>
    {rows.length > 0 && <><div className="panel-head"><div><strong>Review imported rows</strong><div className="small muted">{valid} ready to save, {rows.length-valid} need attention</div></div><button className="button primary" disabled={pendingRecords.length === 0 || saving} onClick={async () => { setSaving(true); try { await saveInstallationBatch(filename, pendingRecords); await onSaved(); setRows([]); setPendingRecords([]); notify(`${pendingRecords.length} site records imported.`); } catch (error) { notify(error instanceof Error ? error.message : "Unable to import workbook."); } finally { setSaving(false); } }}>{saving ? "Saving..." : `Save ${pendingRecords.length} ready sites`}</button></div>
    <div className="table-wrap"><table><thead><tr><th>Sheet row</th><th>Type</th><th>Site or equipment</th><th>Contractor or notes</th><th>Location or site ref</th><th>Result</th></tr></thead><tbody>{rows.map((r) => <tr key={`${r.kind}-${r.row}`}><td>{r.row}</td><td>{r.kind}</td><td>{r.subject || "Site name required"}</td><td>{r.details || "None"}</td><td>{r.reference || "Missing"}</td><td>{r.valid ? <span className="pill installed"><CheckCircle2 size={13} />Ready</span> : <span className="pill issue"><AlertTriangle size={13} />{r.issue}</span>}</td></tr>)}</tbody></table></div></>}</div>
  </>;
}

type SchoolDirectoryPreview = { filename: string; entries: SchoolDirectoryEntry[]; total: number; complete: number; partial: number; skipped: number };

function parseCsvRows(source: string) {
  const rows: string[][] = []; let row: string[] = []; let cell = ""; let quoted = false;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (quoted) { if (char === '"' && source[index + 1] === '"') { cell += '"'; index += 1; } else if (char === '"') quoted = false; else cell += char; }
    else if (char === '"') quoted = true;
    else if (char === ",") { row.push(cell); cell = ""; }
    else if (char === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
    else if (char !== "\r") cell += char;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

async function spreadsheetRows(file: File) {
  if (file.name.toLowerCase().endsWith(".csv")) return parseCsvRows(await file.text());
  const workbook = await createWorkbook(); await workbook.xlsx.load(await file.arrayBuffer());
  const sheet = workbook.worksheets[0]; if (!sheet) throw new Error("The workbook does not contain a worksheet.");
  const rows: string[][] = [];
  sheet.eachRow({ includeEmpty: false }, (row) => { const values: string[] = []; for (let column = 1; column <= sheet.columnCount; column += 1) values.push(row.getCell(column).text.trim()); rows.push(values); });
  return rows;
}

function directoryHeader(value: string) { return value.trim().toLowerCase().replace(/[^a-z0-9]/g, ""); }

function SchoolDirectorySettings({ notify }: { notify: (message: string) => void }) {
  const [status, setStatus] = useState<SchoolDirectoryStatus | null>();
  const [preview, setPreview] = useState<SchoolDirectoryPreview>();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const refreshStatus = useCallback(async () => { setLoading(true); try { setStatus(await loadSchoolDirectoryStatus()); setError(""); } catch (loadError) { setError(errorMessage(loadError, "Unable to load the school directory status.")); } finally { setLoading(false); } }, []);
  useEffect(() => {
    let active = true;
    void loadSchoolDirectoryStatus().then((next) => { if (active) { setStatus(next); setError(""); } }).catch((loadError) => { if (active) setError(errorMessage(loadError, "Unable to load the school directory status.")); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  async function loadFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; event.target.value = ""; if (!file) return;
    setError(""); setPreview(undefined);
    try {
      const rows = await spreadsheetRows(file); if (!rows.length) throw new Error("The spreadsheet is empty.");
      const headers = rows[0].map(directoryHeader); const column = (names: string[]) => headers.findIndex((header) => names.includes(header));
      const columns = { schoolId: column(["schoolid"]), schoolName: column(["schoolname"]), islandGroup: column(["islandgroup"]), region: column(["region"]), province: column(["province"]), municipality: column(["municipality", "locality", "citymunicipality"]), barangay: column(["brgy", "barangay"]) };
      if (columns.schoolName < 0) throw new Error('Add a "School Name" column before uploading.');
      const { resolveLocation } = await import("@/lib/locations");
      const entries: SchoolDirectoryEntry[] = []; let skipped = 0; let complete = 0; let partial = 0;
      rows.slice(1).forEach((values, index) => {
        const get = (position: number) => position < 0 ? "" : String(values[position] ?? "").trim();
        const schoolName = get(columns.schoolName); if (!schoolName) { skipped += 1; return; }
        const schoolId = get(columns.schoolId); const raw = { islandGroup: get(columns.islandGroup), region: get(columns.region), province: get(columns.province), municipality: get(columns.municipality), barangay: get(columns.barangay) };
        const resolution = resolveLocation(raw); const location = resolution.location;
        const warnings = [!schoolId ? "Missing School ID" : "", resolution.issue || ""].filter(Boolean);
        if (warnings.length) partial += 1; else complete += 1;
        entries.push({ id: uuid(), schoolId, schoolName, islandGroup: location?.islandGroup || (islandGroups.some((group) => group === raw.islandGroup) ? raw.islandGroup as Installation["islandGroup"] : ""), region: location?.region || raw.region, regionCode: location?.regionCode || "", province: location?.province || raw.province, provinceCode: location?.provinceCode || "", municipality: location?.municipality || raw.municipality, municipalityCode: location?.municipalityCode || "", barangay: location?.barangay || raw.barangay, barangayCode: location?.barangayCode || "", sourceRow: index + 2, warning: warnings.join("; ") });
      });
      setPreview({ filename: file.name, entries, total: Math.max(0, rows.length - 1), complete, partial, skipped });
    } catch (loadError) { setError(errorMessage(loadError, "Unable to read the spreadsheet.")); }
  }

  async function replaceDirectory() {
    if (!preview || !preview.entries.length) return;
    setSaving(true); setError("");
    try { await replaceSchoolDirectory(preview.filename, preview.entries, preview); await refreshStatus(); setPreview(undefined); notify(`${preview.entries.length} school directory rows are now available.`); }
    catch (saveError) { setError(errorMessage(saveError, "Unable to replace the school directory.")); }
    finally { setSaving(false); }
  }

  return <div className="school-directory-settings">
    <div className="section immediate-settings-note"><strong>Directory uploads apply immediately.</strong><div className="small muted">Saved site records are never changed when this directory is replaced.</div></div>
    <div className="section school-directory-current"><div><span className="small muted">Current directory</span>{loading ? <strong>Loading...</strong> : status ? <><strong>{status.filename}</strong><span className="small muted">{status.completeRows + status.partialRows} searchable schools | uploaded {niceDateTime(status.uploadedAt)} by {status.uploadedBy}</span></> : <strong>No directory uploaded</strong>}</div>{status && <div className="school-directory-counts"><span><strong>{status.completeRows}</strong> complete</span><span><strong>{status.partialRows}</strong> partial</span><span><strong>{status.skippedRows}</strong> skipped</span></div>}</div>
    <div className="section"><label className="dropzone"><FileSpreadsheet size={26} style={{ margin: "auto" }} /><strong>Choose an XLSX or CSV file</strong><span className="small muted">Recognized headers: Region, School ID, School Name, BRGY, Municipality, Province, and Island Group.</span><input type="file" accept=".xlsx,.csv" hidden onChange={loadFile} /></label></div>
    {error && <div className="section notice validation-notice" role="alert">{error}</div>}
    {preview && <div className="school-directory-preview"><div className="panel-head"><div><strong>Review {preview.filename}</strong><div className="small muted">{preview.complete} complete, {preview.partial} partial, {preview.skipped} skipped</div></div><div className="toolbar"><button type="button" className="button" disabled={saving} onClick={() => setPreview(undefined)}>Cancel</button><button type="button" className="button primary" disabled={saving || !preview.entries.length} onClick={() => void replaceDirectory()}>{saving ? "Replacing..." : `Replace with ${preview.entries.length} schools`}</button></div></div><div className="table-wrap"><table><thead><tr><th>Row</th><th>School ID</th><th>School name</th><th>Location</th><th>Result</th></tr></thead><tbody>{preview.entries.slice(0, 25).map((entry) => <tr key={entry.id}><td>{entry.sourceRow}</td><td>{entry.schoolId || "None"}</td><td><strong>{entry.schoolName}</strong></td><td>{[entry.barangay, entry.municipality, entry.province].filter(Boolean).join(", ") || "None"}</td><td>{entry.warning ? <span className="pill issue">{entry.warning}</span> : <span className="pill installed"><CheckCircle2 size={13} />Ready</span>}</td></tr>)}</tbody></table></div>{preview.entries.length > 25 && <div className="section small muted">Showing the first 25 of {preview.entries.length} searchable rows.</div>}</div>}
  </div>;
}

type SettingsSection = "users" | "schoolDirectory" | "siteStatuses" | "contractors" | "unitTypes" | "componentTypes" | "customFields" | "serviceVisitTypes";
type ReferenceSettingsSection = Exclude<SettingsSection, "customFields" | "users">;
const settingsPaths: Record<SettingsSection, string> = { users: "/admin/users", schoolDirectory: "/admin/school-directory", siteStatuses: "/admin/statuses", contractors: "/admin/contractors", unitTypes: "/admin/solutions", componentTypes: "/admin/component-types", customFields: "/admin/custom-fields", serviceVisitTypes: "/admin/service-visit-types" };
function settingsSectionFromPathname(pathname: string): SettingsSection {
  return (Object.entries(settingsPaths).find(([, path]) => path === pathname)?.[0] as SettingsSection | undefined) ?? "contractors";
}
const settingsSections = [["users", Users, "Users"], ["schoolDirectory", FileSpreadsheet, "School directory"], ["siteStatuses", CircleDot, "Site statuses"], ["contractors", Users, "Contractors"], ["unitTypes", Package, "Solutions"], ["componentTypes", CircleDot, "Component types"], ["customFields", ClipboardList, "Custom installation fields"], ["serviceVisitTypes", Wrench, "Service visit types"]] as const;
const settingsGroups: { label: string; description: string; sections: SettingsSection[] }[] = [
  { label: "Access management", description: "Accounts, roles, and sign-in access.", sections: ["users"] },
  { label: "Reference data", description: "Choices and lookup data used in records.", sections: ["schoolDirectory", "siteStatuses", "contractors", "unitTypes", "serviceVisitTypes"] },
  { label: "Site and equipment setup", description: "Fields and equipment templates used while encoding sites.", sections: ["componentTypes", "customFields"] },
];
function orderedSettings<T extends { order?: number }>(items: T[]) { return [...items].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)); }
function reorderSettings<T extends { id: string; order?: number }>(items: T[], sourceId: string, targetId: string) { const ordered = orderedSettings(items); const moved = ordered.find((item) => item.id === sourceId); if (!moved || sourceId === targetId) return ordered; const reordered = ordered.filter((item) => item.id !== sourceId); const targetIndex = reordered.findIndex((item) => item.id === targetId); reordered.splice(targetIndex, 0, moved); return reordered.map((item, order) => ({ ...item, order })); }
function reorderSettingsAround<T extends { id: string; order?: number }>(items: T[], sourceId: string, targetId: string, placement: "before" | "after") { const ordered = orderedSettings(items); const moved = ordered.find((item) => item.id === sourceId); if (!moved || sourceId === targetId) return ordered; const reordered = ordered.filter((item) => item.id !== sourceId); const targetIndex = reordered.findIndex((item) => item.id === targetId); if (targetIndex < 0) return ordered; reordered.splice(placement === "after" ? targetIndex + 1 : targetIndex, 0, moved); return reordered.map((item, order) => ({ ...item, order })); }
function dragReorderPlacement<T extends { id: string; order?: number }>(items: T[], sourceId: string, targetId: string, event: PointerEvent<HTMLDivElement>) {
  const ordered = orderedSettings(items);
  const sourceIndex = ordered.findIndex((item) => item.id === sourceId);
  const targetIndex = ordered.findIndex((item) => item.id === targetId);
  if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) return null;
  const bounds = event.currentTarget.getBoundingClientRect();
  const pointerPastMiddle = event.clientY >= bounds.top + bounds.height / 2;
  if (sourceIndex < targetIndex && !pointerPastMiddle) return null;
  if (sourceIndex > targetIndex && pointerPastMiddle) return null;
  return sourceIndex < targetIndex ? "after" : "before";
}
function ReorderHandle({ label, onPointerDown, onKeyDown }: { label: string; onPointerDown: () => void; onKeyDown: (direction: number) => void }) { return <button type="button" className="drag-handle" aria-label={`Reorder ${label}. Use arrow keys to move.`} title="Drag or use arrow keys to reorder" onPointerDown={(event) => { event.preventDefault(); onPointerDown(); }} onKeyDown={(event) => { if (event.key === "ArrowUp" || event.key === "ArrowLeft") { event.preventDefault(); onKeyDown(-1); } else if (event.key === "ArrowDown" || event.key === "ArrowRight") { event.preventDefault(); onKeyDown(1); } }}><GripVertical size={16} /></button>; }
function settingsSectionLabel(section: SettingsSection) { return settingsSections.find(([id]) => id === section)?.[2] ?? "Settings"; }
function settingsSectionHelp(section: SettingsSection) {
  return ({
    users: "Manage who can sign in and what each person can do.",
    schoolDirectory: "Upload the school names and locations used to autofill site records.",
    siteStatuses: "Create and manage the status workflow used by site records.",
    contractors: "Contractor names used on site records, visits, filters, and exports.",
    unitTypes: "Solutions offered to sites, such as internet service types.",
    componentTypes: "Equipment templates and the reusable fields attached to each type.",
    customFields: "Extra site-level fields shown on the site form and workbook files.",
    serviceVisitTypes: "Visit categories used when logging contractor follow-up work.",
  } satisfies Record<SettingsSection, string>)[section];
}
function ReferenceSaveStatus({ state, dirty, error, onRetry }: { state: ReferenceSaveState; dirty: boolean; error: string; onRetry: () => void }) {
  if (state === "saved" && !dirty) return null;
  if (state === "saving") return <div className="reference-save-overlay saving" role="status" aria-live="polite" aria-atomic="true"><div className="reference-save-card"><span className="save-status-dot" /><div><strong>Saving changes</strong><small>Updating reference settings.</small></div></div></div>;
  const status = state === "failed" ? "failed" : "dirty";
  return <div className={`reference-save-status ${status}`} role="status" aria-live="polite" aria-atomic="true">{state === "failed" ? <><AlertTriangle size={15} /><span>Could not save changes</span><button type="button" className="button ghost" title={error || "Review the connection and try again."} onClick={onRetry}>Retry</button></> : <><span className="save-status-dot" /><span>Unsaved changes</span></>}</div>;
}
function NameEditorModal({ title, label, initialValue = "", existingNames = [], onClose, onSave }: { title: string; label: string; initialValue?: string; existingNames?: string[]; onClose: () => void; onSave: (value: string) => void }) {
  const [value, setValue] = useState(initialValue); const [message, setMessage] = useState("");
  useEscape(onClose);
  return <div className="modal-backdrop" role="presentation"><form className="modal-panel" role="dialog" aria-modal="true" aria-labelledby="name-editor-title" onSubmit={(event) => { event.preventDefault(); const next = value.trim(); if (!next) { setMessage(`Enter a ${label.toLowerCase()}.`); return; } if (existingNames.some((name) => name.localeCompare(next, undefined, { sensitivity: "base" }) === 0)) { setMessage(`${next} already exists.`); return; } onSave(next); }}><div className="modal-header"><div><h2 id="name-editor-title">{title}</h2><p className="muted">Use a clear, unique name for staff records and reports.</p></div><button type="button" className="button icon-button ghost" aria-label="Close editor" onClick={onClose}><X size={17} /></button></div><label>{label}<input autoFocus className="field" value={value} onChange={(event) => setValue(event.target.value)} /></label>{message && <div className="notice validation-notice inline" role="alert">{message}</div>}<div className="modal-actions"><button type="button" className="button" onClick={onClose}>Cancel</button><button className="button primary">Save name</button></div></form></div>;
}
function RowActionMenu({ label, children }: { label: string; children: React.ReactNode }) {
  return <details className="row-action-menu" onKeyDown={(event) => { if (event.key === "Escape") { event.currentTarget.removeAttribute("open"); (event.currentTarget.querySelector("summary") as HTMLElement | null)?.focus(); } }}><summary className="button icon-button ghost" aria-haspopup="menu" aria-label={label} title={label}><MoreHorizontal size={16} /></summary><div className="row-action-menu-panel" role="menu" onClick={(event) => { if ((event.target as HTMLElement).closest("button")) event.currentTarget.parentElement?.removeAttribute("open"); }}>{children}</div></details>;
}
function uniqueCopyName(name: string, existingNames: string[]) {
  const names = new Set(existingNames.map((item) => item.toLocaleLowerCase()));
  const base = `${name} copy`;
  let candidate = base;
  let suffix = 2;
  while (names.has(candidate.toLocaleLowerCase())) candidate = `${base} ${suffix++}`;
  return candidate;
}
function SettingsPage({ refs, setRefs, records, profile, referenceSaveState, referenceSaveError, hasUnsavedReferences, saveReferences, discardReferences, refreshWorkspace, deleteComponentType, deleteEquipmentField, notify }: { refs: ReferenceData; setRefs: Dispatch<SetStateAction<ReferenceData>>; records: Installation[]; profile: Profile; referenceSaveState: ReferenceSaveState; referenceSaveError: string; hasUnsavedReferences: boolean; saveReferences: () => Promise<boolean>; discardReferences: () => void; refreshWorkspace: () => Promise<void>; deleteComponentType: (type: ComponentTypeOption) => void; deleteEquipmentField: (field: ComponentFieldAttachment, label: string, typeName: string) => Promise<boolean>; notify: (s: string) => void }) {
  const pathname = usePathname();
  const navigate = useGuardedNavigation();
  const section = settingsSectionFromPathname(pathname);
  const [name, setName] = useState("");
  const [selectedComponentId, setSelectedComponentId] = useState(refs.componentTypes[0]?.id ?? "");
  const [fieldType, setFieldType] = useState<CustomFieldType>("text"); const [required, setRequired] = useState(false);
  const [deletingReference, setDeletingReference] = useState<{ section: ReferenceSettingsSection; option: ReferenceOption }>();
  const [deletingCustomField, setDeletingCustomField] = useState<CustomFieldDefinition>();
  const [renamingReference, setRenamingReference] = useState<{ section: ReferenceSettingsSection; option: ReferenceOption }>();
  const [draggedSetting, setDraggedSetting] = useState<{ section: Exclude<SettingsSection, "users">; id: string }>();
  const [pendingSection, setPendingSection] = useState<SettingsSection>();
  useEffect(() => { void prefetchUsers(); }, []);
  useEscape(() => { setDeletingReference(undefined); setDeletingCustomField(undefined); }, Boolean(deletingReference || deletingCustomField));
  useEffect(() => { if (!draggedSetting) return; function release() { setDraggedSetting(undefined); notify("Order updated. Save changes to apply."); } window.addEventListener("pointerup", release); return () => window.removeEventListener("pointerup", release); }, [draggedSetting, notify]);
  function add(e: FormEvent) { e.preventDefault(); if (!name.trim() || section === "users" || section === "schoolDirectory") return; if (section === "siteStatuses") { const siteStatuses = refs.siteStatuses ?? []; const newStatus: StatusReferenceOption = { id: uuid(), value: statusSlug(name, siteStatuses), name: name.trim(), active: true, order: siteStatuses.length }; setRefs({ ...refs, siteStatuses: [...siteStatuses, newStatus] }); } else if (section === "customFields") { const customFields = refs.customFields ?? []; const newField: CustomFieldDefinition = { id: uuid(), label: name.trim(), type: fieldType, required, active: true, order: customFields.length, options: [] }; setRefs({ ...refs, customFields: [...customFields, newField] }); } else if (section === "componentTypes") { setRefs({ ...refs, componentTypes: [...refs.componentTypes, { id: uuid(), name: name.trim(), active: true, defaultOnNewSite: false, order: refs.componentTypes.length, fields: [] }] }); } else { setRefs({ ...refs, [section]: [...refs[section], { id: uuid(), name: name.trim(), active: true, order: refs[section].length }] }); } setName(""); setRequired(false); notify("Setting added. Save changes to apply."); }
  function reorderReference(target: ReferenceSettingsSection, sourceId: string, targetId: string, placement: "before" | "after" = "before") { setRefs((current) => ({ ...current, [target]: reorderSettingsAround(current[target], sourceId, targetId, placement) })); }
  function reorderCustomField(sourceId: string, targetId: string, placement: "before" | "after" = "before") { setRefs((current) => ({ ...current, customFields: reorderSettingsAround(current.customFields, sourceId, targetId, placement) })); }
  function settingDragOver(target: Exclude<SettingsSection, "users">, targetId: string, event: PointerEvent<HTMLDivElement>) {
    if (draggedSetting?.section !== target || draggedSetting.id === targetId) return;
    if (target === "customFields") {
      const placement = dragReorderPlacement(refs.customFields ?? [], draggedSetting.id, targetId, event);
      if (placement) reorderCustomField(draggedSetting.id, targetId, placement);
      return;
    }
    const placement = dragReorderPlacement(refs[target], draggedSetting.id, targetId, event);
    if (placement) reorderReference(target, draggedSetting.id, targetId, placement);
  }
  function moveSettingWithKeyboard(target: Exclude<SettingsSection, "users">, id: string, direction: number) { if (target === "customFields") { const items = orderedSettings(refs.customFields); const index = items.findIndex((item) => item.id === id); const destination = items[index + direction]; if (!destination) return; reorderCustomField(id, destination.id, direction > 0 ? "after" : "before"); } else { const items = orderedSettings(refs[target]); const index = items.findIndex((item) => item.id === id); const destination = items[index + direction]; if (!destination) return; reorderReference(target, id, destination.id, direction > 0 ? "after" : "before"); } notify("Order updated. Save changes to apply."); }
  function patchOption(target: ReferenceSettingsSection, id: string, data: Partial<ReferenceOption>) { setRefs({ ...refs, [target]: refs[target].map((option) => option.id === id ? { ...option, ...data } : option) }); }
  function patchField(id: string, data: Partial<CustomFieldDefinition>) { setRefs({ ...refs, customFields: (refs.customFields ?? []).map((field) => field.id === id ? { ...field, ...data } : field) }); }
  function renameOption(target: ReferenceSettingsSection, option: ReferenceOption) { setRenamingReference({ section: target, option }); }
  function referenceUsage(target: ReferenceSettingsSection, option: ReferenceOption) { if (target !== "siteStatuses" && target !== "contractors" && target !== "unitTypes") return 0; return records.filter((record) => target === "siteStatuses" ? record.status === (option as StatusReferenceOption).value : target === "contractors" ? record.contractor === option.name : record.unitType === option.name).length; }
  async function deleteReference(target: ReferenceSettingsSection, option: ReferenceOption) { if (target !== "siteStatuses" && target !== "contractors" && target !== "unitTypes") return; if (hasUnsavedReferences) { setDeletingReference(undefined); notify("Save or discard your pending settings changes before deleting a value."); return; } if (referenceUsage(target, option)) { setDeletingReference(undefined); notify(`${option.name} is still used by site records. Deactivate it instead.`); return; } try { await deleteReferencePermanently(target === "siteStatuses" ? "siteStatus" : target === "contractors" ? "contractor" : "unitType", option.id); await refreshWorkspace(); setDeletingReference(undefined); notify(`${option.name} was deleted.`); } catch (error) { notify(error instanceof Error ? error.message : "Unable to delete setting."); } }
  function customFieldUsage(field: CustomFieldDefinition) { return records.filter((record) => Boolean(record.customValues?.[field.id])).length; }
  async function deleteCustomField(field: CustomFieldDefinition) { if (hasUnsavedReferences) { setDeletingCustomField(undefined); notify("Save or discard your pending settings changes before deleting a custom field."); return; } try { await deleteReferencePermanently("customField", field.id); await refreshWorkspace(); setDeletingCustomField(undefined); notify(`${field.label} was deleted.`); } catch (error) { notify(error instanceof Error ? error.message : "Unable to delete custom field."); } }
  function duplicateComponentType(type: ComponentTypeOption) {
    const duplicate: ComponentTypeOption = {
      ...type,
      id: uuid(),
      name: uniqueCopyName(type.name, refs.componentTypes.map((item) => item.name)),
      defaultOnNewSite: false,
      order: refs.componentTypes.length,
      fields: [...(type.fields ?? [])].sort((a, b) => a.order - b.order).map((field, index) => ({ ...field, id: uuid(), order: index })),
    };
    setRefs({ ...refs, componentTypes: [...refs.componentTypes, duplicate] });
    setSelectedComponentId(duplicate.id);
    notify(`${duplicate.name} was duplicated. Save changes to apply.`);
  }
  const selectedComponent = refs.componentTypes.find((item) => item.id === selectedComponentId) ?? refs.componentTypes[0];
  const addLabel = section === "siteStatuses" ? "Add status" : section === "contractors" ? "Add contractor" : section === "unitTypes" ? "Add solution" : section === "componentTypes" ? "Add component type" : section === "serviceVisitTypes" ? "Add visit type" : "Add field";
  function openSection(next: SettingsSection) { navigate(settingsPaths[next], { bypassGuard: true }); }
  function requestSection(next: SettingsSection) { if (next === section) return; if (hasUnsavedReferences) setPendingSection(next); else openSection(next); }
  return <>
    <div className="page-head"><div><p className="eyebrow">Administration</p><h1>Reference settings</h1><p className="muted">Maintain the choices available in site records and reports.</p></div></div>
    <div className="settings-layout"><div className="panel settings-nav-panel"><div className="panel-head"><h2>Settings sections</h2></div><label className="settings-mobile-select">Settings section<select className="select" value={section} onChange={(event) => requestSection(event.target.value as SettingsSection)}>{settingsGroups.map((group) => <optgroup label={group.label} key={group.label}>{group.sections.map((id) => <option value={id} key={id}>{settingsSectionLabel(id)}</option>)}</optgroup>)}</select></label><div className="nav settings-section-tabs">{settingsGroups.map((group) => <div className="settings-nav-group" key={group.label}><div className="settings-nav-group-label"><strong>{group.label}</strong><span>{group.description}</span></div>{group.sections.map((id) => { const [, Icon, label] = settingsSections.find(([sectionId]) => sectionId === id)!; return <button key={id} onClick={() => requestSection(id)} className={section === id ? "active" : ""}><Icon size={16} />{label}</button>; })}</div>)}</div><div className="section small muted settings-audit-note"><Activity size={16} style={{ marginBottom: 8 }} />Deactivated values remain on historical records. Admin changes are recorded in the production audit log.</div></div>
    <div className="panel settings-editor"><div className="panel-head settings-editor-head"><div><h2>{settingsSectionLabel(section)}</h2><div className="small muted">{settingsSectionHelp(section)}</div></div>{section !== "users" && section !== "schoolDirectory" && <div className="toolbar"><ReferenceSaveStatus state={referenceSaveState} dirty={hasUnsavedReferences} error={referenceSaveError} onRetry={() => void saveReferences()} /><button type="button" className="button" disabled={!hasUnsavedReferences || referenceSaveState === "saving"} onClick={discardReferences}>Discard changes</button><button type="button" className="button primary" disabled={!hasUnsavedReferences || referenceSaveState === "saving"} onClick={() => void saveReferences()}>{referenceSaveState === "saving" ? "Saving..." : "Save changes"}</button></div>}</div>
      {section === "schoolDirectory" && <SchoolDirectorySettings notify={notify} />}
      {section === "users" ? <><div className="section immediate-settings-note"><strong>User access changes apply immediately.</strong><div className="small muted">Role changes, activation updates, and password resets take effect after confirmation.</div></div><UsersSettings currentProfile={profile} notify={notify} /></> : section === "customFields" ? <div className="custom-field-settings"><div className="custom-field-list">{orderedSettings(refs.customFields ?? []).map((field) => <CustomFieldSettings key={field.id} field={field} otherFieldNames={(refs.customFields ?? []).filter((item) => item.id !== field.id).map((item) => item.label)} dragging={draggedSetting?.section === "customFields" && draggedSetting.id === field.id} deleteDisabled={hasUnsavedReferences} onDragStart={() => setDraggedSetting({ section: "customFields", id: field.id })} onDragOver={(event) => settingDragOver("customFields", field.id, event)} onKeyboardMove={(direction) => moveSettingWithKeyboard("customFields", field.id, direction)} patchField={patchField} deleteField={() => setDeletingCustomField(field)} />)}</div><form className="custom-field-add-form" onSubmit={add}><input className="field" value={name} onChange={(e) => setName(e.target.value)} placeholder="New field label" /><select className="select" value={fieldType} onChange={(e) => setFieldType(e.target.value as CustomFieldType)}><option value="text">Text</option><option value="number">Number</option><option value="date">Date</option><option value="dropdown">Dropdown</option></select><label><input type="checkbox" checked={required} onChange={(e) => setRequired(e.target.checked)} />Required</label><button className="button primary"><Plus size={15} />Add field</button></form></div> : section === "componentTypes" ? <div className="component-settings-layout"><div className="component-type-list"><div className="component-type-list-body">{orderedSettings(refs.componentTypes).map((item) => <div className={`component-type-list-row ${draggedSetting?.section === "componentTypes" && draggedSetting.id === item.id ? "dragging" : ""}`} key={item.id} onPointerEnter={(event) => settingDragOver("componentTypes", item.id, event)} onPointerMove={(event) => settingDragOver("componentTypes", item.id, event)}><ReorderHandle label={item.name} onPointerDown={() => setDraggedSetting({ section: "componentTypes", id: item.id })} onKeyDown={(direction) => moveSettingWithKeyboard("componentTypes", item.id, direction)} /><button type="button" className={item.id === selectedComponent?.id ? "selected" : ""} onClick={() => setSelectedComponentId(item.id)}><strong>{item.name}{item.defaultOnNewSite && <Pin size={13} className="component-default-pin" aria-label="Default on new site form" />}</strong><span>{item.fields.length} fields | {records.reduce((count, record) => count + record.components.filter((component) => component.type === item.name).length, 0)} installed</span></button></div>)}</div><form className="component-type-add-form" onSubmit={add}><input className="field" value={name} onChange={(e) => setName(e.target.value)} placeholder="New component type" /><button className="button primary"><Plus size={15} />Add type</button></form></div>{selectedComponent && <div className="component-type-editor"><ComponentTypeSettings key={selectedComponent.id} componentType={selectedComponent} equipmentFields={refs.equipmentFields ?? []} otherTypeNames={refs.componentTypes.filter((item) => item.id !== selectedComponent.id).map((item) => item.name)} equipmentFieldUsage={(libraryFieldId) => { const fieldIds = new Set(refs.componentTypes.flatMap((type) => type.fields.filter((field) => field.libraryFieldId === libraryFieldId).map((field) => field.id))); return { attachmentCount: fieldIds.size, savedValueCount: records.reduce((count, record) => count + record.components.reduce((subtotal, component) => subtotal + Object.keys(component.values ?? {}).filter((id) => fieldIds.has(id)).length, 0), 0) }; }} createEquipmentField={(field) => setRefs((current) => ({ ...current, equipmentFields: [...(current.equipmentFields ?? []), field] }))} deleteDisabled={hasUnsavedReferences} deleteEquipmentField={deleteEquipmentField} usageCount={records.reduce((count, record) => count + record.components.filter((component) => component.type === selectedComponent.name).length, 0)} deleteType={() => deleteComponentType(selectedComponent)} duplicateType={() => duplicateComponentType(selectedComponent)} patchType={(data) => setRefs((current) => ({ ...current, componentTypes: current.componentTypes.map((type) => type.id === selectedComponent.id ? { ...type, ...data } : type) }))} renameType={(next) => setRefs((current) => ({ ...current, componentTypes: current.componentTypes.map((type) => type.id === selectedComponent.id ? { ...type, name: next } : type) }))} notify={notify} /></div>}</div> : orderedSettings(refs[section]).map((item) => <div className={`section settings-row reference-settings-row ${draggedSetting?.section === section && draggedSetting.id === item.id ? "dragging" : ""}`} key={item.id} onPointerEnter={(event) => settingDragOver(section, item.id, event)} onPointerMove={(event) => settingDragOver(section, item.id, event)}><ReorderHandle label={item.name} onPointerDown={() => setDraggedSetting({ section, id: item.id })} onKeyDown={(direction) => moveSettingWithKeyboard(section, item.id, direction)} /><div className="reference-settings-copy"><strong>{item.name}</strong><div className="small muted">{section === "siteStatuses" ? `Status code: ${(item as StatusReferenceOption).value} | ${item.active ? "Available for new records" : "Hidden from new records"}` : item.active ? "Available for new records" : "Hidden from new records"}</div></div><RowActionMenu label={`Actions for ${item.name}`}><button type="button" onClick={() => renameOption(section, item)}><Pencil size={15} />Rename</button><button type="button" className={item.active ? "danger" : ""} onClick={() => { patchOption(section, item.id, { active: !item.active }); notify(item.active ? "Setting deactivated. Save changes to apply." : "Setting reactivated. Save changes to apply."); }}><Power size={15} />{item.active ? "Deactivate" : "Reactivate"}</button>{section !== "serviceVisitTypes" && <button type="button" className="danger" disabled={hasUnsavedReferences} title={hasUnsavedReferences ? "Save or discard changes before deleting permanently" : undefined} onClick={() => setDeletingReference({ section, option: item })}><Trash2 size={15} />Delete permanently</button>}</RowActionMenu></div>)}
      {section === "siteStatuses" && <div className="section small muted">Status codes are generated when a status is added and stay stable for saved records. Rename labels, reorder them, or deactivate choices you do not want staff selecting for new updates.</div>}
      {section !== "users" && section !== "schoolDirectory" && section !== "componentTypes" && section !== "customFields" && <form className="section toolbar" onSubmit={add}><input className="field" style={{ maxWidth: 280 }} value={name} onChange={(e) => setName(e.target.value)} placeholder={section === "siteStatuses" ? "Add site status" : "Add approved value"} /><button className="button primary"><Plus size={15} />{addLabel}</button></form>}</div></div>
    {renamingReference && <NameEditorModal title={`Rename ${settingsSectionLabel(renamingReference.section).toLowerCase()}`} label="Name" initialValue={renamingReference.option.name} existingNames={refs[renamingReference.section].filter((item) => item.id !== renamingReference.option.id).map((item) => item.name)} onClose={() => setRenamingReference(undefined)} onSave={(next) => { patchOption(renamingReference.section, renamingReference.option.id, { name: next }); setRenamingReference(undefined); }} />}
    {deletingReference && <div className="modal-backdrop" role="presentation"><div className="modal-panel" role="dialog" aria-modal="true" aria-labelledby="delete-reference"><div className="modal-icon"><AlertTriangle size={20} /></div><h2 id="delete-reference">{referenceUsage(deletingReference.section, deletingReference.option) ? `Cannot delete ${deletingReference.option.name}` : `Delete ${deletingReference.option.name} permanently?`}</h2><p className="muted">{referenceUsage(deletingReference.section, deletingReference.option) ? `This value is used by ${referenceUsage(deletingReference.section, deletingReference.option)} site records. Deactivate it instead so existing records remain accurate.` : "This removes the choice permanently. This cannot be undone."}</p><div className="modal-actions"><button type="button" className="button" onClick={() => setDeletingReference(undefined)}>{referenceUsage(deletingReference.section, deletingReference.option) ? "Close" : "Cancel"}</button>{!referenceUsage(deletingReference.section, deletingReference.option) && <button type="button" className="button danger-solid" onClick={() => deleteReference(deletingReference.section, deletingReference.option)}><Trash2 size={15} />Delete permanently</button>}</div></div></div>}
    {deletingCustomField && <div className="modal-backdrop" role="presentation"><div className="modal-panel" role="dialog" aria-modal="true" aria-labelledby="delete-custom-field"><div className="modal-icon"><AlertTriangle size={20} /></div><h2 id="delete-custom-field">Delete {deletingCustomField.label} permanently?</h2><p className="muted">This cannot be undone. Deleting this custom field removes {customFieldUsage(deletingCustomField)} saved site values and any configured dropdown choices.</p><div className="modal-actions"><button type="button" className="button" onClick={() => setDeletingCustomField(undefined)}>Cancel</button><button type="button" className="button danger-solid" onClick={() => deleteCustomField(deletingCustomField)}><Trash2 size={15} />Delete permanently</button></div></div></div>}
    {pendingSection && <div className="modal-backdrop" role="presentation"><div className="modal-panel" role="alertdialog" aria-modal="true" aria-labelledby="discard-settings-section"><div className="modal-icon"><AlertTriangle size={20} /></div><h2 id="discard-settings-section">Leave without saving changes?</h2><p className="muted">Your unsaved updates in {settingsSectionLabel(section).toLowerCase()} will be discarded before opening {settingsSectionLabel(pendingSection).toLowerCase()}.</p><div className="modal-actions"><button type="button" className="button" onClick={() => setPendingSection(undefined)}>Keep editing</button><button type="button" className="button danger-solid" onClick={() => { discardReferences(); openSection(pendingSection); setPendingSection(undefined); }}>Discard changes</button><button type="button" className="button primary" onClick={async () => { if (await saveReferences()) { openSection(pendingSection); setPendingSection(undefined); } }}>Save and continue</button></div></div></div>}
  </>;
}

function CustomFieldSettings({ field, otherFieldNames, dragging, deleteDisabled, onDragStart, onDragOver, onKeyboardMove, patchField, deleteField }: { field: CustomFieldDefinition; otherFieldNames: string[]; dragging: boolean; deleteDisabled: boolean; onDragStart: () => void; onDragOver: (event: PointerEvent<HTMLDivElement>) => void; onKeyboardMove: (direction: number) => void; patchField: (id: string, data: Partial<CustomFieldDefinition>) => void; deleteField: () => void }) {
  const [editor, setEditor] = useState<{ kind: "field" | "addOption" | "option"; option?: ReferenceOption }>();
  function patchDropdownOption(id: string, data: Partial<ReferenceOption>) { patchField(field.id, { options: field.options.map((option) => option.id === id ? { ...option, ...data } : option) }); }
  return <div className={`custom-field-row ${dragging ? "dragging" : ""}`} onPointerEnter={onDragOver} onPointerMove={onDragOver}>
    <div className="settings-row reference-settings-row"><ReorderHandle label={field.label} onPointerDown={onDragStart} onKeyDown={onKeyboardMove} /><div className="reference-settings-copy"><strong>{field.label}</strong><div className="small muted">{customFieldTypeLabel(field.type)}{field.required ? " | required" : " | optional"}{field.active ? "" : " | inactive"}</div></div><RowActionMenu label={`Actions for ${field.label}`}><button type="button" onClick={() => setEditor({ kind: "field" })}><Pencil size={15} />Edit field</button><button type="button" className={field.active ? "danger" : ""} onClick={() => patchField(field.id, { active: !field.active })}><Power size={15} />{field.active ? "Deactivate" : "Reactivate"}</button><button type="button" className="danger" disabled={deleteDisabled} title={deleteDisabled ? "Save or discard changes before deleting permanently" : undefined} onClick={deleteField}><Trash2 size={15} />Delete permanently</button></RowActionMenu></div>
    <label className="custom-field-required-toggle"><input type="checkbox" checked={field.required} onChange={(e) => patchField(field.id, { required: e.target.checked })} />Required on new site records</label>
    {field.type === "dropdown" && <div className="option-list"><div className="option-list-head"><span className="small muted">Dropdown options</span><button type="button" className="button" onClick={() => setEditor({ kind: "addOption" })}><Plus size={14} />Add option</button></div><div className="option-list-body">{field.options.map((option) => <div className="option-row" key={option.id}><span>{option.name}</span><RowActionMenu label={`Actions for ${option.name}`}><button type="button" onClick={() => setEditor({ kind: "option", option })}><Pencil size={14} />Rename</button><button type="button" className={option.active ? "danger" : ""} onClick={() => patchDropdownOption(option.id, { active: !option.active })}><Power size={14} />{option.active ? "Deactivate" : "Reactivate"}</button></RowActionMenu></div>)}</div></div>}
    {editor?.kind === "field" && <CustomFieldEditorModal field={field} existingNames={otherFieldNames} onClose={() => setEditor(undefined)} onSave={(data) => { patchField(field.id, data); setEditor(undefined); }} />}
    {editor && editor.kind !== "field" && <NameEditorModal title={editor.kind === "option" ? "Rename dropdown option" : "Add dropdown option"} label="Option name" initialValue={editor.option?.name} existingNames={field.options.filter((option) => option.id !== editor.option?.id).map((option) => option.name)} onClose={() => setEditor(undefined)} onSave={(next) => { if (editor.kind === "option" && editor.option) patchDropdownOption(editor.option.id, { name: next }); else patchField(field.id, { options: [...field.options, { id: uuid(), name: next, active: true }] }); setEditor(undefined); }} />}
  </div>;
}

function customFieldTypeLabel(type: CustomFieldType) {
  return ({ text: "Text", number: "Number", date: "Date", dropdown: "Dropdown" } satisfies Record<CustomFieldType, string>)[type];
}

function CustomFieldEditorModal({ field, existingNames, onClose, onSave }: { field: CustomFieldDefinition; existingNames: string[]; onClose: () => void; onSave: (data: Pick<CustomFieldDefinition, "label" | "type" | "required">) => void }) {
  const [label, setLabel] = useState(field.label);
  const [type, setType] = useState<CustomFieldType>(field.type);
  const [required, setRequired] = useState(field.required);
  const [message, setMessage] = useState("");
  useEscape(onClose);
  function submit(event: FormEvent) {
    event.preventDefault();
    const nextLabel = label.trim();
    if (!nextLabel) { setMessage("Enter a field name."); return; }
    if (existingNames.some((name) => name.localeCompare(nextLabel, undefined, { sensitivity: "base" }) === 0)) { setMessage(`${nextLabel} already exists.`); return; }
    onSave({ label: nextLabel, type, required });
  }
  return <div className="modal-backdrop" role="presentation"><form className="modal-panel" role="dialog" aria-modal="true" aria-labelledby="custom-field-editor-title" onSubmit={submit}><div className="modal-header"><div><h2 id="custom-field-editor-title">Edit custom field</h2><p className="muted">Update how this field appears on new site records and workbook files.</p></div><button type="button" className="button icon-button ghost" aria-label="Close custom field editor" onClick={onClose}><X size={17} /></button></div><div className="stack"><label>Field name<input autoFocus className="field" value={label} onChange={(event) => setLabel(event.target.value)} /></label><label>Field type<select className="select" value={type} onChange={(event) => setType(event.target.value as CustomFieldType)}><option value="text">Text</option><option value="number">Number</option><option value="date">Date</option><option value="dropdown">Dropdown</option></select></label><label className="custom-field-required-toggle"><input type="checkbox" checked={required} onChange={(event) => setRequired(event.target.checked)} />Required on new site records</label></div>{message && <div className="notice validation-notice inline" role="alert">{message}</div>}<div className="modal-actions"><button type="button" className="button" onClick={onClose}>Cancel</button><button className="button primary">Save field</button></div></form></div>;
}

function UsersSettings({ currentProfile, notify }: { currentProfile: Profile; notify: (message: string) => void }) {
  const initialProfiles = getCachedUsers();
  const [profiles, setProfiles] = useState<Profile[]>(initialProfiles ?? []);
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(!initialProfiles);
  const [temporaryPassword, setTemporaryPassword] = useState<{ password: string; email: string }>();
  const [resetting, setResetting] = useState<Profile>();
  const [copied, setCopied] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createFormKey, setCreateFormKey] = useState(0);
  const [updatingId, setUpdatingId] = useState<string>();
  const [pendingAccess, setPendingAccess] = useState<{ profile: Profile; data: Partial<Profile>; title: string; detail: string }>();
  useEscape(() => { setTemporaryPassword(undefined); setResetting(undefined); setPendingAccess(undefined); setCopied(false); }, Boolean(temporaryPassword || resetting || pendingAccess));
  const refreshUsers = useCallback(async (force = false) => { if (!getCachedUsers()) setLoading(true); try { setProfiles(await listUsers({ force })); } catch (error) { notify(error instanceof Error ? error.message : "Unable to load users."); } finally { setLoading(false); } }, [notify]);
  useEffect(() => { void Promise.resolve().then(() => refreshUsers()); }, [refreshUsers]);
  async function create(e: FormEvent) { e.preventDefault(); if (!fullName.trim() || !email.trim()) return; setCreating(true); try { const result = await createUser(fullName.trim(), email.trim()); setTemporaryPassword({ password: result.temporaryPassword, email: email.trim() }); setFullName(""); setEmail(""); setCreateFormKey((key) => key + 1); await refreshUsers(true); notify("User created."); } catch (error) { notify(error instanceof Error ? error.message : "Unable to create user."); } finally { setCreating(false); } }
  async function resetPassword() { if (!resetting) return; try { const result = await generateUserTemporaryPassword(resetting.id); setTemporaryPassword({ password: result.temporaryPassword, email: resetting.email }); setResetting(undefined); notify("Temporary password generated."); } catch (error) { notify(error instanceof Error ? error.message : "Unable to generate a temporary password."); } }
  async function copyTemporaryPassword() { if (!temporaryPassword) return; try { await navigator.clipboard.writeText(temporaryPassword.password); setCopied(true); } catch { notify("Unable to copy the password. Select it and copy manually."); } }
  async function patch(profile: Profile, data: Partial<Profile>) { setUpdatingId(profile.id); try { await updateUser({ ...profile, ...data }); await refreshUsers(true); notify("User access updated."); } catch (error) { notify(error instanceof Error ? error.message : "Unable to update user."); } finally { setUpdatingId(undefined); } }
  async function confirmAccess() { if (!pendingAccess) return; const { profile, data } = pendingAccess; setPendingAccess(undefined); await patch(profile, data); }
  return <div>
    <form key={createFormKey} className="section toolbar" onSubmit={create}><input required className="field" value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Display name" /><input required className="field" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Staff email address" /><button className="button primary" disabled={creating}>{creating ? "Creating user..." : <><Plus size={15} />Create user</>}</button></form>
    {loading ? <div className="section muted">Loading users...</div> : profiles.map((profile) => { const updating = updatingId === profile.id; return <div className="section settings-row user-settings-row" key={profile.id}><div className="user-settings-identity"><strong>{profile.fullName}</strong><div className="small muted">{profile.email}{profile.id === currentProfile.id ? " | signed in" : ""}{updating ? " | saving..." : ""}</div></div><div className="user-settings-controls"><label className="user-role-control"><span className="small muted">Role</span><select className="select" aria-label={`Role for ${profile.email}`} value={profile.role} disabled={profile.id === currentProfile.id || updating} onChange={(e) => { const role = e.target.value as Profile["role"]; setPendingAccess({ profile, data: { role }, title: `Change ${profile.fullName}'s role?`, detail: `${profile.email} will become ${role === "admin" ? "an administrator with access to users and reference settings" : role === "guest" ? "a read-only guest who can browse and export records" : "a staff user who can update operational records without admin settings access"}.` }); }}><option value="guest">Guest (read only)</option><option value="staff">Staff</option><option value="admin">Administrator</option></select></label><div className="user-settings-actions">{profile.id !== currentProfile.id && <button type="button" className="button" disabled={updating} onClick={() => setResetting(profile)}><KeyRound size={14} />Temporary password</button>}<button type="button" className={`button ${profile.active ? "danger" : ""}`} disabled={profile.id === currentProfile.id || updating} onClick={() => profile.active ? setPendingAccess({ profile, data: { active: false }, title: `Deactivate ${profile.fullName}?`, detail: `${profile.email} will no longer be able to sign in until an administrator reactivates the account.` }) : void patch(profile, { active: true })}>{updating ? "Saving..." : profile.active ? "Deactivate" : "Activate"}</button></div></div></div>; })}
    {pendingAccess && <div className="modal-backdrop" role="presentation"><div className="modal-panel" role="alertdialog" aria-modal="true" aria-labelledby="confirm-user-access"><div className="modal-icon"><AlertTriangle size={20} /></div><h2 id="confirm-user-access">{pendingAccess.title}</h2><p className="muted">{pendingAccess.detail}</p><div className="modal-actions"><button type="button" className="button" onClick={() => setPendingAccess(undefined)}>Cancel</button><button type="button" className="button primary" onClick={confirmAccess}>Confirm access change</button></div></div></div>}
    {resetting && <div className="modal-backdrop" role="presentation"><div className="modal-panel" role="dialog" aria-modal="true" aria-labelledby="reset-user-password"><div className="modal-icon"><AlertTriangle size={20} /></div><h2 id="reset-user-password">Generate a new temporary password?</h2><p className="muted">The current password for {resetting.email} will stop working immediately. Share the replacement through your approved internal channel.</p><div className="modal-actions"><button type="button" className="button" onClick={() => setResetting(undefined)}>Cancel</button><button type="button" className="button primary" onClick={resetPassword}><KeyRound size={15} />Generate password</button></div></div></div>}
    {temporaryPassword && <div className="modal-backdrop" role="presentation"><div className="modal-panel" role="dialog" aria-modal="true" aria-labelledby="temporary-password-title"><div className="modal-header"><div><h2 id="temporary-password-title">Temporary password</h2><p className="muted">Share this password with {temporaryPassword.email} through your approved internal channel. It will not be shown again.</p></div><button type="button" className="button icon-button ghost" aria-label="Close temporary password" onClick={() => { setTemporaryPassword(undefined); setCopied(false); }}><X size={17} /></button></div><div className="temporary-password" role="status">{temporaryPassword.password}</div><div className="modal-actions"><button type="button" className="button" onClick={copyTemporaryPassword}><ClipboardCopy size={15} />{copied ? "Copied" : "Copy password"}</button><button type="button" className="button primary" onClick={() => { setTemporaryPassword(undefined); setCopied(false); }}>Done</button></div></div></div>}
  </div>;
}

function ComponentTypeSettings({ componentType: type, equipmentFields, otherTypeNames, createEquipmentField, deleteDisabled, deleteEquipmentField, usageCount, deleteType, duplicateType, patchType, renameType, notify }: { componentType: ComponentTypeOption; equipmentFields: EquipmentFieldLibraryItem[]; otherTypeNames: string[]; equipmentFieldUsage: (libraryFieldId: string) => { attachmentCount: number; savedValueCount: number }; createEquipmentField: (field: EquipmentFieldLibraryItem) => void; deleteDisabled: boolean; deleteEquipmentField: (field: ComponentFieldAttachment, label: string, typeName: string) => Promise<boolean>; usageCount: number; deleteType: () => void; duplicateType: () => void; patchType: (data: Partial<ComponentTypeOption>) => void; renameType: (name: string) => void; notify: (message: string) => void }) {
  const fields = type.fields ?? [];
  const [selectedLibraryId, setSelectedLibraryId] = useState(equipmentFields.find((field) => field.active)?.id ?? "");
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deletingField, setDeletingField] = useState<{ field: ComponentFieldAttachment; reusable: EquipmentFieldLibraryItem }>();
  const [newFieldOpen, setNewFieldOpen] = useState(false);
  const [newFieldLabel, setNewFieldLabel] = useState("");
  const [newFieldType, setNewFieldType] = useState<ComponentFieldType>("text");
  const [renameOpen, setRenameOpen] = useState(false);
  const [draggedFieldId, setDraggedFieldId] = useState<string>();
  const [dragOverFieldId, setDragOverFieldId] = useState<string>();
  useEscape(() => { setDeleteOpen(false); setDeletingField(undefined); setNewFieldOpen(false); }, Boolean(deleteOpen || deletingField || newFieldOpen));
  function reorderField(sourceId: string, targetId: string, placement: "before" | "after" = "before") { patchType({ fields: reorderSettingsAround(fields, sourceId, targetId, placement) }); }
  function fieldDragOver(targetId: string, event: PointerEvent<HTMLDivElement>) { if (!draggedFieldId || draggedFieldId === targetId) return; const placement = dragReorderPlacement(fields, draggedFieldId, targetId, event); if (!placement) return; setDragOverFieldId(targetId); reorderField(draggedFieldId, targetId, placement); }
  function moveFieldWithKeyboard(fieldId: string, direction: number) { const ordered = [...fields].sort((a, b) => a.order - b.order); const index = ordered.findIndex((field) => field.id === fieldId); const target = ordered[index + direction]; if (!target) return; reorderField(fieldId, target.id, direction > 0 ? "after" : "before"); notify("Equipment field order updated. Save changes to apply."); }
  useEffect(() => {
    if (!draggedFieldId) return;
    function release() { setDraggedFieldId(undefined); setDragOverFieldId(undefined); notify("Equipment field order updated. Save changes to apply."); }
    window.addEventListener("pointerup", release);
    return () => window.removeEventListener("pointerup", release);
  });
  function addReusableField() { const reusable = equipmentFields.find((field) => field.id === selectedLibraryId); if (!reusable || fields.some((field) => field.libraryFieldId === reusable.id)) return; const field: ComponentFieldAttachment = { id: uuid(), libraryFieldId: reusable.id, required: false, active: true, order: fields.length }; patchType({ fields: [...fields, field] }); notify("Equipment field added. Save changes to apply."); }
  function selectField(value: string) { if (value !== "__new__") { setSelectedLibraryId(value); return; } setSelectedLibraryId(""); setNewFieldOpen(true); }
  function createAndAttachField(e: FormEvent) { e.preventDefault(); const label = newFieldLabel.trim(); if (!label) return; const reusable: EquipmentFieldLibraryItem = { id: uuid(), label, type: newFieldType, active: true }; createEquipmentField(reusable); patchType({ fields: [...fields, { id: uuid(), libraryFieldId: reusable.id, required: false, active: true, order: fields.length }] }); setSelectedLibraryId(reusable.id); setNewFieldLabel(""); setNewFieldType("text"); setNewFieldOpen(false); notify("Equipment field created and added. Save changes to apply."); }
  function patchField(id: string, data: Partial<ComponentFieldAttachment>) { patchType({ fields: fields.map((field) => field.id === id ? { ...field, ...data } : field) }); }
  return <div className="section">
    <div className="settings-row"><div><strong>{type.name}</strong><div className="small muted">{type.active ? "Available for new records" : "Hidden from new records"} | {type.defaultOnNewSite ? "Pinned to new site form" : "Not pinned by default"} | {fields.length} configured fields | {usageCount} installed rows</div></div><div className="toolbar"><button type="button" className={`button icon-button ghost pin-toggle ${type.defaultOnNewSite ? "active" : ""}`} aria-pressed={Boolean(type.defaultOnNewSite)} aria-label={type.defaultOnNewSite ? `Remove ${type.name} from the new site form defaults` : `Pin ${type.name} to the new site form by default`} title={type.defaultOnNewSite ? "Pinned to new site form" : "Pin to new site form"} onClick={() => patchType({ defaultOnNewSite: !type.defaultOnNewSite })}><Pin size={16} /></button><RowActionMenu label={`Actions for ${type.name}`}><button type="button" onClick={() => setRenameOpen(true)}><Pencil size={15} />Rename component type</button><button type="button" onClick={duplicateType}><ClipboardCopy size={15} />Duplicate component type</button><button type="button" className={type.active ? "danger" : ""} onClick={() => patchType({ active: !type.active })}><Power size={15} />{type.active ? "Deactivate component type" : "Reactivate component type"}</button><button type="button" className="danger" disabled={deleteDisabled} title={deleteDisabled ? "Save or discard changes before deleting permanently" : undefined} onClick={() => setDeleteOpen(true)}><Trash2 size={15} />Delete permanently</button></RowActionMenu></div></div>
    <div className="settings-concept-grid"><div><strong>Equipment type setup</strong><span>Controls which fields appear when staff add {type.name} equipment to a site.</span></div><div><strong>New site defaults</strong><span>Use the pin to add this equipment type automatically when staff create a new site.</span></div></div>
    <div className="option-list"><div className="small muted">Fields on this equipment type | drag the handle or use its arrow keys to reorder</div>{[...fields].sort((a, b) => a.order - b.order).map((field) => { const reusable = equipmentFields.find((item) => item.id === field.libraryFieldId); return <div className={`template-field-row ${draggedFieldId === field.id ? "dragging" : ""} ${dragOverFieldId === field.id ? "drag-over" : ""}`} key={field.id} onPointerEnter={(event) => fieldDragOver(field.id, event)} onPointerMove={(event) => fieldDragOver(field.id, event)}><button type="button" className="drag-handle" aria-label={`Reorder ${reusable?.label ?? "equipment field"}. Use arrow keys to move.`} title="Drag or use arrow keys to reorder" onPointerDown={(e) => { e.preventDefault(); setDraggedFieldId(field.id); setDragOverFieldId(field.id); }} onKeyDown={(e) => { if (e.key === "ArrowUp" || e.key === "ArrowLeft") { e.preventDefault(); moveFieldWithKeyboard(field.id, -1); } else if (e.key === "ArrowDown" || e.key === "ArrowRight") { e.preventDefault(); moveFieldWithKeyboard(field.id, 1); } }}><GripVertical size={16} /></button><span>{reusable?.label ?? "Missing equipment field"}</span><span className="small muted">{reusable ? equipmentFieldTypeLabel(reusable.type) : "Unknown"}</span><label><input type="checkbox" checked={field.required} onChange={(e) => patchField(field.id, { required: e.target.checked })} />Required</label><RowActionMenu label={`Actions for ${reusable?.label ?? "equipment field"}`}><button type="button" className={field.active ? "danger" : ""} onClick={() => patchField(field.id, { active: !field.active })}><Power size={14} />{field.active ? "Deactivate field" : "Reactivate field"}</button>{reusable && <button type="button" className="danger" disabled={deleteDisabled} title={deleteDisabled ? "Save or discard changes before removing this field" : undefined} onClick={() => setDeletingField({ field, reusable })}><Trash2 size={14} />Remove from this type</button>}</RowActionMenu></div>; })}<div className="template-field-add"><select className="select" aria-label="Choose an equipment field" value={selectedLibraryId} onChange={(e) => selectField(e.target.value)}><option value="">Choose an equipment field from the reusable library</option>{[...equipmentFields].filter((field) => field.active && !fields.some((attachment) => attachment.libraryFieldId === field.id)).sort((a, b) => { const order = ["Serial number", "MAC address"]; const ai = order.indexOf(a.label); const bi = order.indexOf(b.label); return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi) || a.label.localeCompare(b.label); }).map((field) => <option key={field.id} value={field.id}>{field.label}</option>)}<option value="__new__">+ Create new reusable field...</option></select><button type="button" className="button" onClick={addReusableField}><Plus size={14} />Add field</button></div></div>
    {deleteOpen && <div className="modal-backdrop" role="presentation"><div className="modal-panel" role="dialog" aria-modal="true" aria-labelledby={`delete-${type.id}`}><div className="modal-icon"><AlertTriangle size={20} /></div><h2 id={`delete-${type.id}`}>Delete {type.name} permanently?</h2><p className="muted">This cannot be undone. Deleting this equipment type removes its field setup and {usageCount} saved equipment {usageCount === 1 ? "entry" : "entries"} from site records. Fields used by other equipment types remain available.</p><div className="modal-actions"><button type="button" className="button" onClick={() => setDeleteOpen(false)}>Cancel</button><button type="button" className="button danger-solid" onClick={deleteType}><Trash2 size={15} />Delete permanently</button></div></div></div>}
    {deletingField && <div className="modal-backdrop" role="presentation"><div className="modal-panel" role="alertdialog" aria-modal="true" aria-labelledby={`remove-field-${deletingField.field.id}`}><div className="modal-icon"><AlertTriangle size={20} /></div><h2 id={`remove-field-${deletingField.field.id}`}>Remove {deletingField.reusable.label} from {type.name}?</h2><p className="muted">This removes the field only from this equipment type. Other equipment types that use {deletingField.reusable.label} will keep it. Saved {type.name} values for this field will be deleted.</p><div className="modal-actions"><button type="button" className="button" onClick={() => setDeletingField(undefined)}>Cancel</button><button type="button" className="button danger-solid" onClick={async () => { if (await deleteEquipmentField(deletingField.field, deletingField.reusable.label, type.name)) setDeletingField(undefined); }}><Trash2 size={15} />Remove from this type</button></div></div></div>}
    {renameOpen && <NameEditorModal title="Rename component type" label="Component type name" initialValue={type.name} existingNames={otherTypeNames} onClose={() => setRenameOpen(false)} onSave={(next) => { renameType(next); setRenameOpen(false); }} />}
    {newFieldOpen && <div className="modal-backdrop" role="presentation"><form className="modal-panel" role="dialog" aria-modal="true" aria-labelledby={`new-field-${type.id}`} onSubmit={createAndAttachField}><div className="modal-header"><div><h2 id={`new-field-${type.id}`}>Create equipment field</h2><p className="muted">Add a field to {type.name}. You can also use this field with other equipment types.</p></div><button type="button" className="button icon-button ghost" aria-label="Close field creator" onClick={() => { setNewFieldOpen(false); setNewFieldLabel(""); setNewFieldType("text"); }}><X size={17} /></button></div><div className="stack"><label>Field name<input autoFocus className="field" value={newFieldLabel} onChange={(e) => setNewFieldLabel(e.target.value)} placeholder="For example: Account ID" /></label><label>Field type<select className="select" value={newFieldType} onChange={(e) => setNewFieldType(e.target.value as ComponentFieldType)}><option value="text">Text</option><option value="mac">MAC address</option><option value="integer">Whole number</option><option value="boolean">Yes or No</option></select></label></div><div className="modal-actions"><button type="button" className="button" onClick={() => { setNewFieldOpen(false); setNewFieldLabel(""); setNewFieldType("text"); }}>Cancel</button><button className="button primary"><Plus size={15} />Create field</button></div></form></div>}
  </div>;
}

function installationRows(records: Installation[], refs: ReferenceData) {
  const fields = [...(refs.customFields ?? [])].sort((a, b) => a.order - b.order);
  const header = ["Site Name", "School ID", "Solution", "Contractor", "Installer / Team Lead", "Install Date", "Activation Date", "Status", "Island Group", "Region", "Province", "Locality", "Barangay", "Longitude", "Latitude", "Beneficiary Name", "Beneficiary Phone", "Additional Beneficiary Contacts", "Remarks", ...fields.map((field) => field.label)];
  return [header, ...records.map((r) => [r.siteName, r.id, r.unitType, r.contractor, r.installerTeamLead, r.installDate, r.activationDate ?? "", r.status, r.islandGroup, r.region, r.province, r.municipality, r.barangay, r.longitude, r.latitude, r.beneficiaryName, r.beneficiaryPhone, additionalBeneficiaryContactsValue(r), r.remarks, ...fields.map((field) => (r.customValues ?? {})[field.id] ?? "")])];
}

function downloadCsv(records: Installation[], refs: ReferenceData) {
  const quote = (value: string) => `"${String(value).replaceAll('"', '""')}"`;
  const csv = installationRows(records, refs).map((row) => row.map(quote).join(",")).join("\n");
  downloadBlob(new Blob([csv], { type: "text/csv" }), `fieldtrack-export-${today()}.csv`);
}

function exportMatchKey(value: string) { return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(); }
function isAccessPoint(type: string) { const key = exportMatchKey(type); return /(^| )ap( |$)/.test(key) || key.includes("access point"); }
function isRouterComponent(component: Component) { return /\brouter\b/.test(exportMatchKey(component.type)); }
function findRouterComponent(components: Component[]) {
  const routers = components.filter((component) => !component.removedAt && isRouterComponent(component));
  return routers.find((component) => exportMatchKey(component.type).includes("ruijie")) ?? routers[0];
}
function equipmentFieldValue(component: Component | undefined, refs: ReferenceData, fieldName: "serial" | "kit") {
  if (!component) return "";
  const field = visibleComponentFields(refs, component).find((attachment) => { const reusable = libraryField(refs, attachment); return reusable && exportMatchKey(reusable.label).includes(fieldName); });
  return field ? component.values?.[field.id]?.trim() || "" : "";
}

function installationExcelClipboardRow(record: Installation, refs: ReferenceData, part: "first" | "last") {
  const cleanCell = (value: unknown) => String(value ?? "").replace(/[\t\r\n]+/g, " ").trim();
  const starlink = record.components.find((component) => !component.removedAt && exportMatchKey(component.type).includes("starlink"));
  const completeAddress = [record.barangay, record.municipality, record.province].map((part) => part.trim()).filter(Boolean).join(", ");
  const firstHalf = [
    record.islandGroup,
    record.id,
    record.siteName,
    completeAddress,
  ];
  const lastHalf = [
    equipmentFieldValue(starlink, refs, "kit"),
    record.latitude,
    record.longitude,
    record.activationDate ?? "",
    record.installerTeamLead,
    record.contractor,
    record.region,
  ];
  return (part === "first" ? firstHalf : lastHalf).map(cleanCell).join("\t");
}

function installationRouterContactClipboardRow(record: Installation, refs: ReferenceData) {
  const cleanCell = (value: unknown) => String(value ?? "").replace(/[\t\r\n]+/g, " ").trim();
  const ruijieRouter = findRouterComponent(record.components);
  const contact = beneficiaryContactList(record).find(contactHasValue);
  return [
    record.id,
    record.siteName,
    equipmentFieldValue(ruijieRouter, refs, "serial"),
    contact?.name ?? "",
    contact?.phone ?? "",
  ].map(cleanCell).join("\t");
}

function xlsxInstallationRows(records: Installation[], refs: ReferenceData) {
  const header = ["UNIT", "SCHOOL ID", "SITE NAME", "ISLAND GROUP", "REGION", "PROVINCE", "MUNICIPALITY", "BARANGAY", "Longitude", "Latitude", "STARLINK KIT NUMBER", "STARLINK DATE ACTIVATED", "AP 1 INDOOR SERIAL NUMBER", "AP 2 INDOOR SERIAL NUMBER", "AP 3 OUTDOOR SERIAL NUMBER", "RUIJIE ROUTER SERIAL NUMBER", "MSP", "MSP Installer/Team Lead", "DATE INSTALLED", "CONTACT PERSON NAME", "CONTACT PERSON POSITION", "CONTACT NUMBER", "REMARKS"];
  return [header, ...records.map((record, index) => {
    const activeComponents = record.components.filter((component) => !component.removedAt);
    const starlink = activeComponents.find((component) => exportMatchKey(component.type).includes("starlink"));
    const indoorAccessPoints = activeComponents.filter((component) => isAccessPoint(component.type) && exportMatchKey(component.type).includes("indoor"));
    const outdoorAccessPoint = activeComponents.find((component) => isAccessPoint(component.type) && exportMatchKey(component.type).includes("outdoor"));
    const ruijieRouter = findRouterComponent(activeComponents);
    const contacts = beneficiaryContactList(record).filter(contactHasValue);
    return [index + 1, record.id, record.siteName, record.islandGroup, record.region, record.province, record.municipality, record.barangay, record.longitude, record.latitude, equipmentFieldValue(starlink, refs, "kit"), record.activationDate ?? "", equipmentFieldValue(indoorAccessPoints[0], refs, "serial"), equipmentFieldValue(indoorAccessPoints[1], refs, "serial"), equipmentFieldValue(outdoorAccessPoint, refs, "serial"), equipmentFieldValue(ruijieRouter, refs, "serial"), record.contractor, record.installerTeamLead, record.installDate, contacts.map((contact) => contact.name.trim()).join("\n"), "", contacts.map((contact) => contact.phone.trim()).join("\n"), record.remarks];
  })];
}

async function downloadXlsx(records: Installation[], refs: ReferenceData) {
  const wb = await createWorkbook();
  const worksheet = wb.addWorksheet("Installations", { views: [{ state: "frozen", ySplit: 1 }] });
  worksheet.addRows(xlsxInstallationRows(records, refs));
  worksheet.autoFilter = "A1:W1";
  [8, 16, 34, 15, 26, 20, 22, 22, 14, 14, 22, 20, 24, 24, 25, 27, 24, 26, 17, 26, 24, 20, 36].forEach((width, index) => { worksheet.getColumn(index + 1).width = width; });
  const header = worksheet.getRow(1);
  header.height = 24;
  header.font = { bold: true, color: { argb: "FFFFFFFF" } };
  header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF245C4C" } };
  header.alignment = { vertical: "middle", horizontal: "center" };
  header.eachCell((cell) => { cell.border = { bottom: { style: "thin", color: { argb: "FFB7C9C1" } } }; });
  worksheet.eachRow((row, rowNumber) => { if (rowNumber > 1) { row.alignment = { vertical: "top", wrapText: true }; row.getCell(1).alignment = { vertical: "top", horizontal: "center" }; } });
  const buffer = await wb.xlsx.writeBuffer();
  downloadBlob(new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), `fieldtrack-export-${today()}.xlsx`);
}
