"use client";

import { ChangeEvent, Dispatch, FormEvent, SetStateAction, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  Activity, AlertTriangle, ArrowDownAZ, ArrowUpAZ, BarChart3, CalendarRange, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, CircleDot, ClipboardCopy, ClipboardList,
  Download, FileSpreadsheet, GripVertical, History, ImagePlus, KeyRound, LogOut, MessageSquareText, MoreHorizontal, Package, Pencil, Plus, Power, RadioTower, Search, Wrench,
  Trash2, Users, X, ArrowUp, ArrowDown
} from "lucide-react";
import { islandGroups, getIslandGroup } from "@/lib/location-groups";
import { clearInvalidSession, consumeAuthCallback, createUser, deleteReferencePermanently, generateUserTemporaryPassword, getCachedUsers, listLocationOptions, listUsers, loadInstallations, loadInstallationAuditEvents, loadInstallationByDisplayId, loadInstallationDuplicateValidationRecords, loadInstallationForVisitDisplayId, loadInstallationServiceVisits, loadInstallationSummaries, loadInstallationValidationRecords, loadReferences, loadServiceVisitSummaries, loadProfile, persistReferences, prefetchUsers, requestPasswordReset, saveInstallation, saveInstallationBatch, saveVisit, setPassword, signIn, updateUser } from "@/lib/supabase-repository";
import { supabaseConfigured } from "@/lib/supabase-browser";
import { useGuardedNavigation, useNavigationBlocker } from "@/lib/guarded-navigation";
import type { LocationOption } from "@/lib/supabase-repository";
import type { AuditEvent, Component, ComponentFieldAttachment, ComponentFieldType, ComponentTypeOption, CustomFieldDefinition, CustomFieldType, EquipmentFieldLibraryItem, Installation, Profile, ReferenceData, ReferenceOption, ServiceVisit, ServiceVisitStatus, Status } from "@/lib/types";

type Page = "dashboard" | "installations" | "new" | "serviceVisits" | "import" | "settings";
type Filter = { search: string; status: string; contractor: string; islandGroup: string; regionCode: string; provinceCode: string; municipalityCode: string; barangayCode: string; from: string; to: string; attention: "" | "missingName" | "legacyKit" };
type ServiceVisitFilter = { search: string; status: string; type: string; contractor: string; from: string; to: string };
type ReferenceSaveState = "idle" | "saving" | "saved" | "failed";
type ImportRow = { row: number; kind: "Site" | "Equipment"; subject: string; details: string; reference: string; valid: boolean; issue: string };
const emptyFilter: Filter = { search: "", status: "", contractor: "", islandGroup: "", regionCode: "", provinceCode: "", municipalityCode: "", barangayCode: "", from: "", to: "", attention: "" };
const emptyReferences: ReferenceData = { contractors: [], unitTypes: [], componentTypes: [], equipmentFields: [], customFields: [], serviceVisitTypes: [] };
type RouteWorkspace = { profile: Profile; refs: ReferenceData; records: Installation[]; loadedAt: number };
const routeWorkspaceCache = new Map<string, RouteWorkspace>();
function cachedRouteWorkspace(routeKey: string) { return routeWorkspaceCache.get(routeKey); }
function cacheRouteWorkspace(routeKey: string, profile: Profile, refs: ReferenceData, records: Installation[]) { routeWorkspaceCache.set(routeKey, { profile, refs, records, loadedAt: Date.now() }); }
export function invalidateRouteWorkspaceCache() { routeWorkspaceCache.clear(); }
const statusMeta: Record<Status, { label: string; color: string }> = {
  installed: { label: "Installed", color: "oklch(0.58 0.13 155)" },
  scheduled: { label: "Scheduled", color: "oklch(0.58 0.14 245)" },
  issue: { label: "Issue", color: "oklch(0.72 0.14 70)" },
  cancelled: { label: "Cancelled", color: "oklch(0.62 0.11 28)" },
};
function uid(prefix: string) { return `${prefix}-${Date.now().toString(36).toUpperCase()}`; }
function uuid() { return crypto.randomUUID(); }
function today() { return new Date().toISOString().slice(0, 10); }
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
  const next = { ...filters };
  if (next.status && !Object.hasOwn(statusMeta, next.status)) next.status = "";
  if (next.contractor && !refs.contractors.some((item) => item.name === next.contractor)) next.contractor = "";
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
    || JSON.stringify(names(current.serviceVisitTypes)) !== JSON.stringify(names(previous.serviceVisitTypes));
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
function visibleComponentFields(refs: ReferenceData, component: Component) { return (componentType(refs, component.type)?.fields ?? []).filter((field) => field.active || Boolean((component.values ?? {})[field.id])).sort((a, b) => a.order - b.order); }
function componentMacValues(refs: ReferenceData, component: Component) { return visibleComponentFields(refs, component).filter((field) => libraryField(refs, field)?.type === "mac").map((field) => normalizeMac((component.values ?? {})[field.id] ?? "")).filter(Boolean); }
function EquipmentValueInput({ type, label, value, required = false, disabled = false, onChange, onBlur }: { type: ComponentFieldType; label: string; value: string; required?: boolean; disabled?: boolean; onChange: (value: string) => void; onBlur?: () => void }) {
  if (type === "boolean") return <select className="select" value={value} required={required} disabled={disabled} onChange={(event) => onChange(event.target.value)}><option value="">Choose a value</option><option value="true">Yes</option><option value="false">No</option></select>;
  return <input className="field" type={type === "integer" ? "number" : "text"} inputMode={type === "integer" ? "numeric" : undefined} step={type === "integer" ? "1" : undefined} value={value} required={required} disabled={disabled} onChange={(event) => onChange(event.target.value)} onBlur={onBlur} placeholder={type === "mac" ? "AA:BB:CC:DD:EE:FF" : label} />;
}
function StatusPill({ status }: { status: Status }) { return <span className={`pill ${status}`}><span className="status-dot" style={{ background: statusMeta[status].color }} />{statusMeta[status].label}</span>; }
const serviceStatusLabels: Record<ServiceVisitStatus, string> = { scheduled: "Scheduled", in_progress: "In progress", completed: "Completed", cancelled: "Cancelled" };
const auditFieldLabels: Record<string, string> = { siteName: "site name", site_name: "site name", unitType: "solution", unit_type_id: "solution", contractor: "contractor", contractor_id: "contractor", installDate: "installation date", install_date: "installation date", status: "status", islandGroup: "island group", region: "region", region_code: "region", province: "province", province_code: "province", municipality: "locality", municipality_code: "locality", barangay: "barangay", barangay_code: "barangay", address: "site address", remarks: "remarks", notes: "notes", value: "value", removed_at: "removed date", installed_at: "installed date", completed_date: "completed date", scheduled_date: "scheduled date", ticket_reference: "ticket reference" };
const hiddenAuditFields = new Set(["id", "created_at", "updated_at", "created_by", "updated_by", "installation_id", "installation_component_id", "field_definition_id", "component_type_id", "visit_type_id", "actor_id", "import_batch_id"]);
function auditTitle(value: string) { return value.replaceAll("_", " ").replace(/\b[a-z]/g, (letter) => letter.toUpperCase()); }
function auditLabel(field: string) { return auditTitle(auditFieldLabels[field] ?? field); }
function auditValue(value: unknown) { if (value === null || value === undefined || value === "") return "None"; if (typeof value === "boolean") return value ? "Yes" : "No"; if (typeof value === "object") return JSON.stringify(value); const text = String(value); return /^[a-z][a-z _-]*$/i.test(text) ? auditTitle(text) : text; }

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
  const routeKey = `${pathname}?${newVisitSiteId}`;
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
        : pathname === "/admin/users" ? async () => []
        : loadInstallationValidationRecords;
      const [nextProfile, nextRefs, nextRecords] = await Promise.all([loadProfile(), loadReferences(), loadRouteRecords()]);
      cacheRouteWorkspace(routeKey, nextProfile, nextRefs, nextRecords);
      setProfile(nextProfile); setRecords(nextRecords); setRefs(nextRefs); setSavedRefs(nextRefs); setLoadedRouteKey(routeKey); setLoggedIn(true); if (pathname === "/") router.replace("/dashboard");
    }
    catch (error) { const expired = await clearInvalidSession(error); if (expired) invalidateRouteWorkspaceCache(); setLoggedIn(false); setLoadError(expired ? "Your session expired. Sign in again." : error instanceof Error ? error.message : "Unable to load FieldTrack."); }
    finally { setLoading(false); setRefreshing(false); }
  }, [loadedRouteKey, newVisitSiteId, page, pathname, routeKey, router, serviceVisitDetailId, siteDetailId]);
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
      const [latestRefs, latestRecords] = await Promise.all([loadReferences(), reloadRecords ? loadInstallations() : Promise.resolve(undefined)]);
      invalidateRouteWorkspaceCache(); setRefs(latestRefs); setSavedRefs(latestRefs); if (latestRecords) setRecords(latestRecords);
      setReferenceSaveState("saved"); notify("Settings saved."); return true;
    }
    catch (error) { setReferenceSaveState("failed"); setReferenceSaveError(error instanceof Error ? error.message : "Unable to save reference settings."); return false; }
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

  const filtered = useMemo(() => records.filter((r) =>
    (!filters.search || `${r.id} ${r.siteName} ${r.legacyKitNumber ?? ""} ${r.barangay} ${r.municipality}`.toLowerCase().includes(filters.search.toLowerCase())) &&
    (!filters.status || r.status === filters.status) &&
    (!filters.contractor || r.contractor === filters.contractor) &&
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
    try { await saveInstallation(record); await refresh({ invalidate: true }); setEditing(undefined); if (href) navigate(href, { bypassGuard: true }); else setPage(dest); setRouteNavAttempt(""); setHasUnsavedChanges(false); setNavAttempt(null); notify("Site record saved."); }
    catch (error) { notify(error instanceof Error ? error.message : "Unable to save site record."); }
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
  const canEdit = profile?.role !== "guest";

  return (
    <>
          {refreshing && <div className="route-refreshing" role="status" aria-live="polite"><span />Refreshing page data...</div>}
          {page === "dashboard" && <Dashboard records={filtered} allRecords={records} refs={refs} filters={filters} setFilters={setFilters} setPage={setPage} canEdit={canEdit} />}
          {page === "installations" && <Installations records={filtered} allRecords={records} refs={refs} filters={filters} setFilters={setFilters} startEdit={startEdit} setPage={setPage} canEdit={canEdit} />}
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
              onSave={(rec) => {
                save(rec, navAttempt ?? "installations", routeNavAttempt);
              }}
              onCancel={() => {
                setEditing(undefined);
                if (routeNavAttempt) navigate(routeNavAttempt, { bypassGuard: true }); else setPage(navAttempt ?? "installations");
                setRouteNavAttempt("");
                setHasUnsavedChanges(false);
                setNavAttempt(null);
              }}
              setHasUnsavedChanges={setHasUnsavedChanges}
              navAttempt={navAttempt}
              clearNavAttempt={() => { setNavAttempt(null); setRouteNavAttempt(""); }}
              routeNavAttempt={routeNavAttempt}
              readOnly={!canEdit}
            />
          )}
          {page === "import" && <ImportRecords refs={refs} records={records} notify={notify} onSaved={() => refresh({ invalidate: true })} />}
          {page === "settings" && profile?.role === "admin" && <SettingsPage refs={refs} setRefs={setRefs} records={records} profile={profile} referenceSaveState={referenceSaveState} referenceSaveError={referenceSaveError} hasUnsavedReferences={hasUnsavedReferences} saveReferences={saveReferences} discardReferences={() => setRefs(savedRefs)} refreshWorkspace={() => refresh({ invalidate: true })} deleteComponentType={async (type) => { if (hasUnsavedReferences) { notify("Save or discard your pending settings changes before deleting an equipment type."); return; } try { await deleteReferencePermanently("componentType", type.id); await refresh({ invalidate: true }); notify(`${type.name} and its saved equipment entries were deleted.`); } catch (error) { notify(error instanceof Error ? error.message : "Unable to delete component type."); } }} deleteEquipmentField={async (field) => { if (hasUnsavedReferences) { notify("Save or discard your pending settings changes before deleting an equipment field."); return false; } try { await deleteReferencePermanently("equipmentField", field.id); await refresh({ invalidate: true }); notify(`${field.label} and its saved values were deleted.`); return true; } catch (error) { notify(error instanceof Error ? error.message : "Unable to delete equipment field."); return false; } }} notify={notify} />}
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
      <span className="drp-sep">–</span>
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
  const installDates = records.map((record) => record.installDate).filter(Boolean);
  const minDate = installDates.length ? installDates.reduce((a, b) => (a < b ? a : b)) : "";
  const maxDate = installDates.length ? installDates.reduce((a, b) => (a > b ? a : b)) : "";
  const uniqueLocations = <T extends { code: string }>(items: T[]) => Array.from(new Map(items.map((item) => [item.code, item])).values());
  const availableIslandGroups = Array.from(new Set(records.map((record) => record.islandGroup).filter(Boolean)));
  const regions = uniqueLocations(records.filter((record) => !filters.islandGroup || record.islandGroup === filters.islandGroup).map((record) => ({ code: record.regionCode, name: record.region })));
  const provinces = uniqueLocations(records.filter((record) => (!filters.islandGroup || record.islandGroup === filters.islandGroup) && (!filters.regionCode || record.regionCode === filters.regionCode)).map((record) => ({ code: record.provinceCode, name: record.province })));
  const municipalities = uniqueLocations(records.filter((record) => (!filters.islandGroup || record.islandGroup === filters.islandGroup) && (!filters.regionCode || record.regionCode === filters.regionCode) && (!filters.provinceCode || record.provinceCode === filters.provinceCode)).map((record) => ({ code: record.municipalityCode, name: record.municipality })));
  const barangays = uniqueLocations(records.filter((record) => (!filters.islandGroup || record.islandGroup === filters.islandGroup) && (!filters.regionCode || record.regionCode === filters.regionCode) && (!filters.provinceCode || record.provinceCode === filters.provinceCode) && (!filters.municipalityCode || record.municipalityCode === filters.municipalityCode)).map((record) => ({ code: record.barangayCode, name: record.barangay })));
  const activeLocationCount = [filters.islandGroup, filters.regionCode, filters.provinceCode, filters.municipalityCode, filters.barangayCode].filter(Boolean).length;
  const active = filters.search || filters.status || filters.contractor || activeLocationCount || filters.from || filters.to || filters.attention;
  const locationFilters = <>
    <select className="select" aria-label="Filter sites by island group" value={filters.islandGroup} onChange={(e) => setFilters({ ...filters, islandGroup: e.target.value, regionCode: "", provinceCode: "", municipalityCode: "", barangayCode: "" })}><option value="">All island groups</option>{availableIslandGroups.map((group) => <option key={group}>{group}</option>)}</select>
    <select className="select" aria-label="Filter sites by region" value={filters.regionCode} onChange={(e) => setFilters({ ...filters, regionCode: e.target.value, provinceCode: "", municipalityCode: "", barangayCode: "" })}><option value="">All regions</option>{regions.map((region) => <option value={region.code} key={region.code}>{region.name}</option>)}</select>
    <select className="select" aria-label="Filter sites by province" value={filters.provinceCode} onChange={(e) => setFilters({ ...filters, provinceCode: e.target.value, municipalityCode: "", barangayCode: "" })} disabled={!filters.regionCode}><option value="">All provinces</option>{provinces.map((province) => <option value={province.code} key={province.code}>{province.name}</option>)}</select>
    <select className="select" aria-label="Filter sites by locality" value={filters.municipalityCode} onChange={(e) => setFilters({ ...filters, municipalityCode: e.target.value, barangayCode: "" })} disabled={!filters.provinceCode}><option value="">All localities</option>{municipalities.map((municipality) => <option value={municipality.code} key={municipality.code}>{municipality.name}</option>)}</select>
    <select className="select" aria-label="Filter sites by barangay" value={filters.barangayCode} onChange={(e) => setFilters({ ...filters, barangayCode: e.target.value })} disabled={!filters.municipalityCode}><option value="">All barangays</option>{barangays.map((barangay) => <option value={barangay.code} key={barangay.code}>{barangay.name}</option>)}</select>
  </>;
  return <div className="filter-stack">
    <div className="toolbar filter-row">
      <div className="input-wrap"><Search className="input-icon" size={17} /><input className="field search" aria-label="Search sites" value={filters.search} onChange={(e) => setFilters({ ...filters, search: e.target.value })} placeholder="Search site, installation ID, or location" /></div>
      <select className="select" aria-label="Filter sites by contractor" value={filters.contractor} onChange={(e) => setFilters({ ...filters, contractor: e.target.value })}><option value="">All contractors</option>{refs.contractors.map((c) => <option key={c.id}>{c.name}</option>)}</select>
      {compact ? <button type="button" className={`button advanced-filter-trigger ${advanced || activeLocationCount ? "active" : ""}`} aria-expanded={advanced} onClick={() => setAdvanced((open) => !open)}>Advanced filters{activeLocationCount > 0 && <span>{activeLocationCount}</span>}<ChevronDown size={14} /></button> : locationFilters}
      {active && <button className="button ghost" onClick={() => setFilters(emptyFilter)}><X size={16} />Clear</button>}
    </div>
    {compact && advanced && <div className="toolbar filter-row advanced-filter-row">{locationFilters}</div>}
    {filters.attention && <div className="active-queue-filter"><strong>{filters.attention === "missingName" ? "Queue: imported sites missing names" : "Queue: old kit numbers awaiting assignment"}</strong><button type="button" className="button ghost" onClick={() => setFilters({ ...filters, attention: "" })}><X size={14} />Clear queue</button></div>}
    <div className="status-filter-row" role="group" aria-label="Filter sites by status">
      <div className="status-filter-pills">
        <button type="button" className={`button status-filter-pill ${!filters.status ? "active" : ""}`} aria-pressed={!filters.status} onClick={() => setFilters({ ...filters, status: "" })}>All sites</button>
        {(Object.keys(statusMeta) as Status[]).map((status) => <button type="button" className={`button status-filter-pill ${status} ${filters.status === status ? "active" : ""}`} aria-pressed={filters.status === status} key={status} onClick={() => setFilters({ ...filters, status })}><span className="status-dot" style={{ background: statusMeta[status].color }} />{statusMeta[status].label}</button>)}
      </div>
      <DateRangeFilter from={filters.from} to={filters.to} minDate={minDate} maxDate={maxDate} onChange={(range) => setFilters({ ...filters, ...range })} ariaLabel="Filter sites by installation date" />
    </div>
  </div>;
}

function Dashboard({ records, allRecords, refs, filters, setFilters, setPage, canEdit }: { records: Installation[]; allRecords: Installation[]; refs: ReferenceData; filters: Filter; setFilters: (f: Filter) => void; setPage: (p: Page) => void; canEdit: boolean }) {
  const [showAllContractors, setShowAllContractors] = useState(false);
  const counts = (Object.keys(statusMeta) as Status[]).map((status) => ({ status, count: records.filter((r) => r.status === status).length }));
  const contractors = refs.contractors.map(({ name }) => ({ name, count: records.filter((r) => r.contractor === name).length })).filter(({ count }) => count > 0).sort((a,b) => b.count-a.count || a.name.localeCompare(b.name));
  const visibleContractors = showAllContractors ? contractors : contractors.slice(0, 5);
  const max = Math.max(...contractors.map((c) => c.count), 1);
  return <>
    <div className="page-head"><div><p className="eyebrow">Overview</p><h1>Site dashboard</h1><p className="muted">Track site activity and review records that need follow-up.</p></div>{canEdit && <button className="button primary" onClick={() => setPage("new")}><Plus size={16} />Add site</button>}</div>
    <div className="stats">{counts.map(({ status, count }) => <button type="button" className="stat stat-button" key={status} onClick={() => { setFilters({ ...filters, status }); setPage("installations"); }}><span className="small muted">{statusMeta[status].label}</span><span className="stat-value">{count}<span className="status-dot" style={{ background: statusMeta[status].color }} /></span></button>)}</div>
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

function Installations({ records, allRecords, refs, filters, setFilters, startEdit, setPage, canEdit }: { records: Installation[]; allRecords: Installation[]; refs: ReferenceData; filters: Filter; setFilters: (f: Filter) => void; startEdit: (r: Installation) => void; setPage: (p: Page) => void; canEdit: boolean }) {
  return <>
    <div className="page-head"><div><p className="eyebrow">Registry</p><h1>Sites</h1><p className="muted">Find a site record and review its deployed equipment.</p></div><div className="toolbar"><button className="button" onClick={() => downloadCsv(records, refs)}><Download size={16} />Export CSV</button><button className="button" onClick={async () => downloadXlsx(await loadInstallationValidationRecords(), refs)}><FileSpreadsheet size={16} />Export XLSX</button>{canEdit && <button className="button primary" onClick={() => setPage("new")}><Plus size={16} />Add site</button>}</div></div>
    <div style={{ marginBottom: 16 }}><FilterBar records={allRecords} refs={refs} filters={filters} setFilters={setFilters} compact /></div>
    <div className="panel"><div className="panel-head"><strong>{records.length} records</strong></div><RecordsTable key={JSON.stringify(filters)} records={records} onSelect={startEdit} detailed canEdit={canEdit} /></div>
  </>;
}

type SiteSortKey = "siteName" | "id" | "islandGroup" | "location" | "unitType" | "contractor" | "installDate" | "status" | "equipment" | "updatedBy";
function SiteSortHeader({ label, column, sortable, sort, onSort }: { label: string; column: SiteSortKey; sortable: boolean; sort?: { key: SiteSortKey; direction: "asc" | "desc" }; onSort: (key: SiteSortKey) => void }) {
  if (!sortable) return <th>{label}</th>;
  const active = sort?.key === column;
  return <th aria-sort={active ? sort.direction === "asc" ? "ascending" : "descending" : "none"}><button type="button" className={`table-sort ${active ? "active" : ""}`} onClick={() => onSort(column)}>{label}{active && sort.direction === "desc" ? <ArrowDownAZ size={14} /> : <ArrowUpAZ size={14} />}</button></th>;
}
function RecordsTable({ records, onSelect, detailed = false, canEdit = true }: { records: Installation[]; onSelect?: (r: Installation) => void; detailed?: boolean; canEdit?: boolean }) {
  const [sort, setSort] = useState<{ key: SiteSortKey; direction: "asc" | "desc" }>();
  const [page, setPage] = useState(1);
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
  function toggleSort(key: SiteSortKey) { if (!sortable) return; setPage(1); setSort((current) => current?.key === key ? { key, direction: current.direction === "asc" ? "desc" : "asc" } : { key, direction: "asc" }); }
  if (!records.length) return <div className="empty"><ClipboardList size={25} /><p><strong>No sites match these filters.</strong></p><span>{canEdit ? "Clear a filter or add a site record." : "Clear a filter or ask a staff user to add a site record."}</span></div>;
  const sortHeader = (label: string, column: SiteSortKey) => <SiteSortHeader label={label} column={column} sortable={sortable} sort={sort} onSort={toggleSort} />;
  return <><div className={`table-wrap ${detailed ? "sites-table-wrap" : ""}`}><table className={detailed ? "sites-table" : undefined}><thead><tr>{sortHeader("Site name", "siteName")}{sortHeader("Installation ID", "id")}{detailed && sortHeader("Island group", "islandGroup")}{sortHeader("Location", "location")}{detailed && sortHeader("Solution", "unitType")}{sortHeader("Contractor", "contractor")}{sortHeader("Installation date", "installDate")}{sortHeader("Status", "status")}{sortHeader("Equipment", "equipment")}{detailed && sortHeader("Updated by", "updatedBy")}{onSelect && <th><span className="sr-only">Actions</span></th>}</tr></thead><tbody>{visibleRecords.map((r) => <tr key={r.id} onClick={() => onSelect?.(r)} style={{ cursor: onSelect ? "pointer" : "default" }}><td>{r.siteName || <span className="pill issue">Site name required</span>}</td><td><strong>{r.id}</strong></td>{detailed && <td>{r.islandGroup || "None"}</td>}<td>{r.barangay}, {r.municipality}</td>{detailed && <td>{r.unitType}</td>}<td>{r.contractor}</td><td>{niceDate(r.installDate)}</td><td><StatusPill status={r.status} /></td><td>{r.components.length}</td>{detailed && <td>{r.updatedBy}</td>}{onSelect && <td><button type="button" className="button icon-button ghost" aria-label={`View ${r.siteName || r.id}`} onClick={(event) => { event.stopPropagation(); onSelect(r); }}><ChevronRight size={16} /></button></td>}</tr>)}</tbody></table></div>{detailed && <div className="pagination"><span className="small muted">Showing {firstVisible}-{lastVisible} of {sortedRecords.length} records | {pageSize} rows per page</span><div className="toolbar"><button type="button" className="button icon-button" aria-label="Previous page" disabled={currentPage === 1} onClick={() => setPage((current) => Math.max(1, current - 1))}><ChevronLeft size={16} /></button><span className="pagination-page small">Page {currentPage} of {pageCount}</span><button type="button" className="button icon-button" aria-label="Next page" disabled={currentPage === pageCount} onClick={() => setPage((current) => Math.min(pageCount, current + 1))}><ChevronRight size={16} /></button></div></div>}</>;
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
    <div className="stats">{counts.map(({ status, count }) => <button type="button" className={`stat stat-button ${filters.status === status ? "active" : ""}`} aria-pressed={filters.status === status} key={status} onClick={() => setFilters({ ...filters, status: filters.status === status ? "" : status })}><span className="small muted">{serviceStatusLabels[status]}</span><span className="stat-value">{count}<span className="status-dot" style={{ background: status === "completed" ? statusMeta.installed.color : status === "cancelled" ? statusMeta.cancelled.color : status === "in_progress" ? statusMeta.issue.color : statusMeta.scheduled.color }} /></span></button>)}</div>
    <div className="panel"><div className="section filter-stack"><div className="toolbar filter-row">
      <div className="input-wrap"><Search className="input-icon" size={17} /><input className="field search" aria-label="Search service visits" placeholder="Search site or ticket" value={filters.search} onChange={(e) => setFilters({ ...filters, search: e.target.value })} /></div>
      <select className="select" aria-label="Filter service visits by contractor" value={filters.contractor} onChange={(e) => setFilters({ ...filters, contractor: e.target.value })}><option value="">All contractors</option>{refs.contractors.map((contractor) => <option key={contractor.id}>{contractor.name}</option>)}</select>
      <button type="button" className={`button advanced-filter-trigger ${advanced || filters.type ? "active" : ""}`} aria-expanded={advanced} onClick={() => setAdvanced((open) => !open)}>Advanced filters{filters.type && <span>1</span>}<ChevronDown size={14} /></button>
      {active && <button type="button" className="button ghost" onClick={clearFilters}><X size={16} />Clear</button>}
    </div>
    {advanced && <div className="toolbar filter-row advanced-filter-row"><select className="select" aria-label="Filter service visits by type" value={filters.type} onChange={(e) => setFilters({ ...filters, type: e.target.value })}><option value="">All visit types</option>{refs.serviceVisitTypes.map((type) => <option key={type.id}>{type.name}</option>)}</select></div>}
    <div className="status-filter-row" role="group" aria-label="Filter service visits by status"><div className="status-filter-pills"><button type="button" className={`button status-filter-pill ${!filters.status ? "active" : ""}`} aria-pressed={!filters.status} onClick={() => setFilters({ ...filters, status: "" })}>All visits</button>{(Object.keys(serviceStatusLabels) as ServiceVisitStatus[]).map((status) => <button type="button" className={`button status-filter-pill ${filters.status === status ? "active" : ""}`} aria-pressed={filters.status === status} key={status} onClick={() => setFilters({ ...filters, status })}><span className="status-dot" style={{ background: status === "completed" ? statusMeta.installed.color : status === "cancelled" ? statusMeta.cancelled.color : status === "in_progress" ? statusMeta.issue.color : statusMeta.scheduled.color }} />{serviceStatusLabels[status]}</button>)}</div><DateRangeFilter from={filters.from} to={filters.to} minDate={minDate} maxDate={maxDate} onChange={(range) => setFilters({ ...filters, ...range })} ariaLabel="Filter service visits by scheduled date" /></div></div>
      <ServiceVisitTable key={JSON.stringify(filters)} visits={visits} onSelect={(_, visit) => navigate(`/service-visits/${encodeURIComponent(visit.id)}`)} />
    </div>
    {chooseSite && <div className="modal-backdrop" role="presentation"><div className="modal-panel" role="dialog" aria-modal="true" aria-labelledby="choose-visit-site"><div className="modal-header"><div><h2 id="choose-visit-site">Choose a site</h2><p className="muted">Search for the site receiving contractor support.</p></div><button type="button" className="button icon-button ghost" aria-label="Close site chooser" onClick={() => { setChooseSite(false); setSiteSearch(""); navigate("/service-visits"); }}><X size={17} /></button></div><label>Search sites<div className="input-wrap"><Search className="input-icon" size={16} /><input autoFocus className="field search" value={siteSearch} onChange={(e) => setSiteSearch(e.target.value)} placeholder="Site name, ID, location, or contractor" /></div></label><div className="site-search-results" style={{ display: "grid", gap: 4, maxHeight: 244, marginTop: 10, padding: 4, overflowY: "auto", border: "1px solid var(--line)", borderRadius: 8, background: "var(--surface-muted)" }} role="listbox" aria-label="Matching sites">{matchingSites.length ? matchingSites.map((record) => { const selected = record.id === newInstallationId; return <button type="button" className={`button site-search-result ${selected ? "selected" : ""}`} style={{ display: "grid", justifyContent: "stretch", gap: 3, width: "100%", minHeight: 0, padding: "9px 10px", borderColor: selected ? "oklch(0.76 0.06 164)" : "transparent", background: selected ? "var(--accent-soft)" : "transparent", textAlign: "left" }} role="option" aria-selected={selected} key={record.id} onClick={() => setNewInstallationId(record.id)}><strong>{record.siteName || "Site name required"}</strong><span>{record.id} | {record.barangay}, {record.municipality}</span></button>; }) : <div className="site-search-empty">No sites match your search.</div>}</div><div className="modal-actions"><button type="button" className="button" onClick={() => { setChooseSite(false); setSiteSearch(""); navigate("/service-visits"); }}>Cancel</button><button type="button" className="button primary" disabled={!matchingSites.some((record) => record.id === newInstallationId)} onClick={() => { const installation = records.find((record) => record.id === newInstallationId); if (installation) { setChooseSite(false); setSiteSearch(""); router.replace(`/service-visits/new?site=${encodeURIComponent(installation.id)}`); } }}><Plus size={15} />Continue</button></div></div></div>}
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
  return <><div className="table-wrap service-visits-table-wrap"><table className="service-visits-table"><thead><tr><th>Visit</th><th>Site</th><th>Type</th><th>Ticket</th><th>Contractor</th><th>Scheduled</th><th>Status</th>{onSelect && <th><span className="sr-only">Actions</span></th>}</tr></thead><tbody>{visibleVisits.map(({ installation, visit }) => <tr key={visit.id} onClick={() => onSelect?.(installation, visit)} style={{ cursor: onSelect ? "pointer" : "default" }}><td><strong>{visit.id}</strong></td><td>{installation.siteName || installation.id}</td><td>{visit.type}</td><td>{visit.ticketReference || "None"}</td><td>{visit.contractor}</td><td>{niceDate(visit.scheduledDate)}</td><td><span className={`pill ${visit.status === "completed" ? "installed" : visit.status === "cancelled" ? "cancelled" : visit.status === "in_progress" ? "issue" : "scheduled"}`}>{serviceStatusLabels[visit.status]}</span></td>{onSelect && <td><button type="button" className="button icon-button ghost" aria-label={`View service visit ${visit.id}`} onClick={(event) => { event.stopPropagation(); onSelect(installation, visit); }}><ChevronRight size={16} /></button></td>}</tr>)}</tbody></table></div><div className="pagination"><span className="small muted">Showing {firstVisible}-{lastVisible} of {visits.length} visits | {pageSize} rows per page</span><div className="toolbar"><button type="button" className="button icon-button" aria-label="Previous page" disabled={currentPage === 1} onClick={() => setPage((current) => Math.max(1, current - 1))}><ChevronLeft size={16} /></button><span className="pagination-page small">Page {currentPage} of {pageCount}</span><button type="button" className="button icon-button" aria-label="Next page" disabled={currentPage === pageCount} onClick={() => setPage((current) => Math.min(pageCount, current + 1))}><ChevronRight size={16} /></button></div></div></>;
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
  onSave,
  onCancel,
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
  onSave: (r: Installation) => void;
  onCancel: () => void;
  setHasUnsavedChanges: (dirty: boolean) => void;
  navAttempt: Page | null;
  clearNavAttempt: () => void;
  routeNavAttempt?: string;
  readOnly?: boolean;
}) {
  const navigate = useGuardedNavigation();
  const createdAt = new Date().toISOString();
  const [record, setRecord] = useState<Installation>(initial ?? { id: uid("INS"), siteName: "", unitType: refs.unitTypes.find((x) => x.active)?.name ?? "", contractor: refs.contractors.find((x) => x.active)?.name ?? "", installDate: today(), status: "scheduled", islandGroup: "", region: "", regionCode: "", province: "", provinceCode: "", municipality: "", municipalityCode: "", barangay: "", barangayCode: "", address: "", remarks: "", components: [], customValues: {}, photos: [], createdBy: actorName, createdAt, updatedBy: actorName, updatedAt: createdAt, serviceVisits: [], auditEvents: [] });
  const [tab, setTab] = useState<"overview" | "visits" | "audit">("overview");
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>(initial?.auditEvents ?? []);
  const [auditLoaded, setAuditLoaded] = useState(!initial?.dbId || Boolean(initial.auditEvents.length));
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditError, setAuditError] = useState("");
  const [serviceVisits, setServiceVisits] = useState<ServiceVisit[]>(initial?.serviceVisits ?? []);
  const [visitsLoaded, setVisitsLoaded] = useState(!initial?.dbId || Boolean(initial.serviceVisits.length));
  const [visitsLoading, setVisitsLoading] = useState(false);
  const [visitsError, setVisitsError] = useState("");
  const [showRemoved, setShowRemoved] = useState(false);
  const [editingDetails] = useState(true);
  const [noteComponentId, setNoteComponentId] = useState<string>();
  const [showExitModal, setShowExitModal] = useState(false);
  const [triedSubmit, setTriedSubmit] = useState(false);
  const validationSummaryRef = useRef<HTMLDivElement>(null);
  useBlobUrlCleanup(record.photos);

  const [original] = useState<Installation>(() => JSON.parse(JSON.stringify(record)));
  const isDirty = useMemo(() => {
    return JSON.stringify(record) !== JSON.stringify(original);
  }, [record, original]);

  useEffect(() => {
    setHasUnsavedChanges(isDirty);
    return () => setHasUnsavedChanges(false);
  }, [isDirty, setHasUnsavedChanges]);

  const shouldShowExitModal = showExitModal || Boolean(navAttempt) || Boolean(routeNavAttempt);

  const duplicate = record.siteName && records.some((r) => r.siteName.toLowerCase() === record.siteName.toLowerCase() && r.id !== record.id);
  const regionChoices = useLocationChoices("region");
  const provinceChoices = useLocationChoices("province", record.regionCode);
  const municipalityChoices = useLocationChoices("municipality", record.provinceCode);
  const barangayChoices = useLocationChoices("barangay", record.municipalityCode);
  const regions = useMemo(() => regionChoices.options.filter((item) => getIslandGroup(item.code) === record.islandGroup), [record.islandGroup, regionChoices.options]);
  const locationError = regionChoices.error || provinceChoices.error || municipalityChoices.error || barangayChoices.error;
  const missingLocation = !record.islandGroup || !record.regionCode || !record.provinceCode || !record.municipalityCode || !record.barangayCode;
  const patch = (data: Partial<Installation>) => setRecord((r) => ({ ...r, ...data }));
  const activeFields = (refs.customFields ?? []).filter((field) => field.active || Boolean((record.customValues ?? {})[field.id])).sort((a, b) => a.order - b.order);
  const activeComponents = record.components.filter((component) => !component.removedAt);
  const invalidMac = activeComponents.some((component) => visibleComponentFields(refs, component).some((field) => libraryField(refs, field)?.type === "mac" && (component.values ?? {})[field.id] && !normalizeMac((component.values ?? {})[field.id])));
  const invalidInteger = activeComponents.some((component) => visibleComponentFields(refs, component).some((field) => libraryField(refs, field)?.type === "integer" && (component.values ?? {})[field.id] && !validInteger((component.values ?? {})[field.id])));
  const allMacs = activeComponents.flatMap((component) => componentMacValues(refs, component));
  const duplicateMac = activeComponents.find((component) => componentMacValues(refs, component).some((mac) => allMacs.filter((value) => value === mac).length > 1 || records.some((installation) => installation.id !== record.id && installation.components.some((existing) => !existing.removedAt && componentMacValues(refs, existing).includes(mac)))));
  const duplicateMacInstallation = duplicateMac && records.find((installation) => installation.id !== record.id && installation.components.some((existing) => !existing.removedAt && componentMacValues(refs, existing).some((mac) => componentMacValues(refs, duplicateMac).includes(mac))));
  const missingComponentValue = activeComponents.some((component) => visibleComponentFields(refs, component).some((field) => field.active && field.required && !(component.values ?? {})[field.id]?.trim()));
  const hasValidationError = Boolean(duplicate || missingLocation || invalidMac || invalidInteger || missingComponentValue || (duplicateMac && !duplicateMac.duplicateMacAcknowledged));

  function showValidationErrors() { setTriedSubmit(true); requestAnimationFrame(() => validationSummaryRef.current?.focus()); }
  function submit(e: FormEvent) { e.preventDefault(); if (hasValidationError) { showValidationErrors(); return; } onSave({ ...record, components: record.components.map((component) => ({ ...component, values: Object.fromEntries(Object.entries(component.values ?? {}).map(([id, value]) => { const attachment = visibleComponentFields(refs, component).find((field) => field.id === id); return [id, attachment && libraryField(refs, attachment)?.type === "mac" && value ? normalizeMac(value) : value]; })) })), updatedBy: actorName, updatedAt: new Date().toISOString() }); }
  function addComponent() { patch({ components: [...record.components, { id: uid("CMP"), type: refs.componentTypes.find((x) => x.active)?.name ?? "", values: {}, notes: "", installedAt: new Date().toISOString() }] }); }
  function componentPatch(id: string, data: Partial<Component>) { patch({ components: record.components.map((c) => c.id === id ? { ...c, ...data } : c) }); }
  function photos(e: ChangeEvent<HTMLInputElement>) { const files = Array.from(e.target.files ?? []).slice(0, 4); patch({ photos: [...record.photos, ...files.map((file) => ({ name: file.name, url: URL.createObjectURL(file) }))] }); }
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
    // Keep navAttempt intact — user chose to stay; navAttempt will re-trigger if they navigate again
    clearNavAttempt();
  }

  function handleSaveAndExit() {
    if (hasValidationError) { setShowExitModal(false); showValidationErrors(); return; }
    setShowExitModal(false);
    onSave({ ...record, components: record.components.map((component) => ({ ...component, values: Object.fromEntries(Object.entries(component.values ?? {}).map(([id, value]) => { const attachment = visibleComponentFields(refs, component).find((field) => field.id === id); return [id, attachment && libraryField(refs, attachment)?.type === "mac" && value ? normalizeMac(value) : value]; })) })), updatedBy: actorName, updatedAt: new Date().toISOString() });
  }

  return <form onSubmit={submit}>
    <div className="page-head site-record-head"><div><p className="eyebrow">{initial ? "Site record" : "New site"}</p><div className="site-record-heading-row"><h1>{initial ? initial.siteName || "Site name required" : "Add a site record"}</h1>{initial && <StatusPill status={record.status} />}</div>{initial && <div className="small muted record-id">Installation ID: {initial.id}</div>}<p className="muted site-record-description">{initial ? readOnly ? "Review site details, contractor visits, and change history." : "Update site details and deployed equipment." : "Review site details, contractor visits, and change history."}</p></div><div className="toolbar site-record-actions"><button type="button" className="button" onClick={() => { if (isDirty) { setShowExitModal(true); } else { onCancel(); } }}>{initial ? "Back to sites" : "Cancel"}</button>{!readOnly && <button className="button primary">{initial ? "Save changes" : "Save site"}</button>}</div></div>
    <div className="tabs" role="tablist" aria-label="Site record sections" onKeyDown={handleTabKeyDown}><button type="button" id="site-tab-overview" role="tab" aria-controls="site-panel-overview" aria-selected={tab === "overview"} tabIndex={tab === "overview" ? 0 : -1} className={tab === "overview" ? "active" : ""} onClick={() => setTab("overview")}>Overview</button><button type="button" id="site-tab-visits" role="tab" aria-controls="site-panel-visits" aria-selected={tab === "visits"} tabIndex={tab === "visits" ? 0 : -1} className={tab === "visits" ? "active" : ""} onClick={() => void openVisits()}>Service visits {visitsLoaded && <span>{serviceVisits.length}</span>}</button><button type="button" id="site-tab-audit" role="tab" aria-controls="site-panel-audit" aria-selected={tab === "audit"} tabIndex={tab === "audit" ? 0 : -1} className={tab === "audit" ? "active" : ""} onClick={() => void openAudit()}>Change log {auditLoaded && <span>{auditEvents.length}</span>}</button></div>
    {triedSubmit && hasValidationError && <div className="notice validation-notice inline" role="alert" tabIndex={-1} ref={validationSummaryRef}><strong>Check the highlighted site details before saving.</strong> Review the messages below and correct each required value.</div>}
    {tab === "overview" && <fieldset id="site-panel-overview" aria-labelledby="site-tab-overview" className="panel site-fields editing" role="tabpanel" disabled={readOnly}>
      {initial && <section className="section ownership-grid" aria-label="Saved record metadata"><div><span className="small muted">Created by</span><strong>{record.createdBy}</strong></div><div><span className="small muted">Created</span><strong>{niceDateTime(record.createdAt)}</strong></div><div><span className="small muted">Updated by</span><strong>{record.updatedBy}</strong></div><div><span className="small muted">Last saved</span><strong>{niceDateTime(record.updatedAt)}</strong></div></section>}
      <section id="site-details-section" className="section site-details-polish site-details-guided"><div className="section-title"><div><h2>Site details</h2><span className="small muted">Identity, ownership, and current installation state</span></div></div><div className="grid-3">
        <label>Site name<input required className="field" value={record.siteName} onChange={(e) => patch({ siteName: e.target.value })} placeholder="Workplace site name" /></label>
        <label>Solution<select className="select" value={record.unitType} onChange={(e) => patch({ unitType: e.target.value })}>{activeOptions(refs.unitTypes, record.unitType).map((x) => <option key={x.id}>{x.name}</option>)}</select></label>
        <label>Contractor<select className="select" value={record.contractor} onChange={(e) => patch({ contractor: e.target.value })}>{activeOptions(refs.contractors, record.contractor).map((x) => <option key={x.id}>{x.name}</option>)}</select></label>
        <label>Installation date<input required className="field" type="date" value={record.installDate} onChange={(e) => patch({ installDate: e.target.value })} /></label>
        <label>Status<select className="select" value={record.status} onChange={(e) => patch({ status: e.target.value as Status })}>{Object.keys(statusMeta).map((x) => <option key={x}>{x}</option>)}</select></label>
      </div>{duplicate && <div className="notice validation-notice inline" role="alert"><strong>This site name already exists.</strong> Enter a unique site name before saving.</div>}{record.legacyKitNumber && <div className="notice inline legacy-kit-prompt"><span className="small migration-label">Migration follow-up</span><strong>Assign old kit number: {record.legacyKitNumber}</strong><div className="small">Add the correct equipment, enter this value in its kit-number field, then mark this follow-up as assigned.</div><button type="button" className="button" onClick={() => patch({ legacyKitNumber: undefined })}>Mark kit number assigned</button></div>}</section>
      <section className="section"><div className="section-title"><h2>Site location</h2><span className="small muted">PSGC-aligned fields</span></div><div className="grid-4">
        <LocationCombobox label="Island group" placeholder="Search island group" value={record.islandGroup} options={islandGroups.map((group) => ({ code: group, name: group }))} onSelect={(selected) => patch({ islandGroup: selected.code as Installation["islandGroup"], region: "", regionCode: "", province: "", provinceCode: "", municipality: "", municipalityCode: "", barangay: "", barangayCode: "" })} />
        <LocationCombobox label="Region" placeholder="Search region" value={record.regionCode} options={regions} loading={regionChoices.loading} disabled={!record.islandGroup} onSelect={(selected) => patch({ region: selected.name, regionCode: selected.code, province: "", provinceCode: "", municipality: "", municipalityCode: "", barangay: "", barangayCode: "" })} />
        <LocationCombobox label="Province" placeholder="Search province" value={record.provinceCode} options={provinceChoices.options} loading={provinceChoices.loading} disabled={!record.regionCode} onSelect={(selected) => patch({ province: selected.name, provinceCode: selected.code, municipality: "", municipalityCode: "", barangay: "", barangayCode: "" })} />
        <LocationCombobox label="Locality" placeholder="Search locality" value={record.municipalityCode} options={municipalityChoices.options} loading={municipalityChoices.loading} disabled={!record.provinceCode} onSelect={(selected) => patch({ municipality: selected.name, municipalityCode: selected.code, barangay: "", barangayCode: "" })} />
        <LocationCombobox label="Barangay" placeholder="Search barangay" value={record.barangayCode} options={barangayChoices.options} loading={barangayChoices.loading} disabled={!record.municipalityCode} onSelect={(selected) => patch({ barangay: selected.name, barangayCode: selected.code })} />
      </div>{locationError && <div className="notice validation-notice inline" role="alert"><strong>Unable to load location options.</strong> {locationError}</div>}{triedSubmit && missingLocation && <div className="notice validation-notice inline" role="alert"><strong>Complete the site location.</strong> Select an island group, region, province, locality, and barangay.</div>}<label className="field-block">Site address or landmark<input className="field" value={record.address} onChange={(e) => patch({ address: e.target.value })} placeholder="Optional street, purok, or landmark" /></label></section>
      {activeFields.length > 0 && <section className="section"><div className="section-title"><div><h2>Additional information</h2><span className="small muted">Configured by your workplace administrator.</span></div></div><div className="grid-3">{activeFields.map((field) => <CustomFieldInput field={field} value={(record.customValues ?? {})[field.id] ?? ""} onChange={(value) => patch({ customValues: { ...(record.customValues ?? {}), [field.id]: value } })} key={field.id} />)}</div></section>}
      <section className="section"><div className="section-title"><div><h2>Equipment</h2><span className="small muted">Record the identifiers shown for each equipment type.</span></div><div className="toolbar">{record.components.some((component) => component.removedAt) && <button type="button" className="button" aria-expanded={showRemoved} onClick={() => setShowRemoved(!showRemoved)}>{showRemoved ? "Hide" : "Show"} removed equipment</button>}<button type="button" className="button" onClick={addComponent}><Plus size={15} />Add equipment</button></div></div>
        {!record.components.filter((component) => !component.removedAt).length && <div className="dropzone muted">No active equipment recorded yet. Add each device or kit deployed at this site.</div>}
        {record.components.filter((component) => !editingDetails || showRemoved || !component.removedAt).map((c) => <div className={`component-template-row ${c.removedAt ? "removed-component" : ""}`} key={c.id}><div className="component-row"><label>Component type<select disabled={Boolean(c.removedAt)} className="select" value={c.type} onChange={(e) => componentPatch(c.id, { type: e.target.value, values: {}, duplicateMacAcknowledged: false })}>{activeOptions(refs.componentTypes, c.type).map((x) => <option key={x.id}>{x.name}</option>)}</select></label>{visibleComponentFields(refs, c).map((field) => { const reusable = libraryField(refs, field); if (!reusable) return null; return <label key={field.id}>{reusable.label}{field.required ? " *" : ""}<EquipmentValueInput type={reusable.type} label={reusable.label} disabled={Boolean(c.removedAt)} required={field.required && !c.removedAt} value={(c.values ?? {})[field.id] ?? ""} onChange={(value) => componentPatch(c.id, { values: { ...(c.values ?? {}), [field.id]: value }, duplicateMacAcknowledged: false })} onBlur={() => reusable.type === "mac" && (c.values ?? {})[field.id] && normalizeMac((c.values ?? {})[field.id]) && componentPatch(c.id, { values: { ...(c.values ?? {}), [field.id]: normalizeMac((c.values ?? {})[field.id]) } })} /></label>; })}<span className="note-action"><button type="button" className={`button icon-button ${c.notes ? "has-note" : ""}`} aria-label={c.notes ? "View or edit component note" : "Add component note"} title={c.notes ? "View or edit component note" : "Add component note"} onClick={() => setNoteComponentId(c.id)}><MessageSquareText size={16} /></button>{c.notes && <span className="note-tooltip" role="tooltip">{c.notes}</span>}</span>{c.removedAt ? <span className="pill cancelled">Removed {niceDate(c.removedAt)}</span> : <button type="button" className="button icon-button danger" aria-label={`Remove ${c.type}`} title="Remove component" onClick={() => componentPatch(c.id, { removedAt: new Date().toISOString() })}><Trash2 size={16} /></button>}</div></div>)}
        {invalidMac && <div className="notice validation-notice inline" role="alert"><strong>Check the MAC address format.</strong> Use six hexadecimal pairs such as AA:BB:CC:DD:EE:FF.</div>}
        {invalidInteger && <div className="notice validation-notice inline" role="alert"><strong>Enter whole numbers for integer equipment fields.</strong> Decimal values are not accepted.</div>}
        {missingComponentValue && <div className="notice validation-notice inline" role="alert"><strong>Complete the required equipment fields.</strong> Fill in every field marked with an asterisk before saving.</div>}
        {duplicateMac && <div className="notice validation-notice inline" role="alert"><label style={{ display: "flex", gridTemplateColumns: "auto 1fr", alignItems: "center", gap: 9 }}><input type="checkbox" checked={Boolean(duplicateMac.duplicateMacAcknowledged)} onChange={(e) => componentPatch(duplicateMac.id, { duplicateMacAcknowledged: e.target.checked })} />This MAC address already appears on {duplicateMacInstallation ? duplicateMacInstallation.id : "another device at this site"}. I reviewed the possible duplicate and want to save this site record.</label></div>}
      </section>
      <section className="section"><div className="grid-2"><div><div className="section-title"><h2>Remarks</h2></div><textarea className="textarea" rows={5} value={record.remarks} onChange={(e) => patch({ remarks: e.target.value })} placeholder="Activation notes, issue details, or follow-up action" /></div><div><div className="section-title"><h2>Site photos</h2><span className="small muted">Optional, up to 4 images</span></div><label className="dropzone"><ImagePlus size={21} style={{ margin: "auto" }} /><span>Choose site photos</span><input type="file" accept="image/*" multiple hidden onChange={photos} /></label>{record.photos.length > 0 && <p className="small muted">{record.photos.map((p) => p.name).join(", ")}</p>}</div></div></section>
    </fieldset>}
    {tab === "visits" && <div id="site-panel-visits" aria-labelledby="site-tab-visits" className="panel" role="tabpanel"><div className="panel-head"><div><h2>Service visits</h2><div className="small muted">Contractor revisits, maintenance, and equipment changes</div></div>{!readOnly && <button type="button" className="button primary" onClick={() => navigate(`/service-visits/new?site=${encodeURIComponent(record.id)}&returnTo=${encodeURIComponent(`/sites/${record.id}`)}`)}><Plus size={15} />New service visit</button>}</div>{visitsLoading ? <div className="section muted">Loading service visits...</div> : visitsError ? <div className="section notice validation-notice"><strong>Unable to load service visits.</strong> {visitsError}</div> : <ServiceVisitTable visits={serviceVisits.map((visit) => ({ installation: record, visit }))} onSelect={(_, visit) => navigate(`/service-visits/${encodeURIComponent(visit.id)}?returnTo=${encodeURIComponent(`/sites/${record.id}`)}`)} />}</div>}
    {tab === "audit" && <div id="site-panel-audit" aria-labelledby="site-tab-audit" className="panel" role="tabpanel"><div className="panel-head"><div><h2>Change log</h2><div className="small muted">Permanent history of record updates and service activity</div></div><History size={18} className="muted" /></div>{auditLoading ? <div className="section muted">Loading change log...</div> : auditError ? <div className="section notice validation-notice"><strong>Unable to load the change log.</strong> {auditError}</div> : <AuditTimeline events={auditEvents} />}</div>}
    {noteComponentId && <ComponentNoteModal component={record.components.find((component) => component.id === noteComponentId)} onChange={(notes) => componentPatch(noteComponentId, { notes })} onClose={() => setNoteComponentId(undefined)} />}
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
            <button type="button" className="button danger" onClick={handleDiscard}>
              Discard changes
            </button>
            <button type="button" className="button" onClick={handleKeepEditing}>
              Keep editing
            </button>
            <button type="button" className="button primary" onClick={handleSaveAndExit}>
              Save changes
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

function LocationCombobox({ label, placeholder, value, options, loading = false, disabled = false, onSelect }: { label: string; placeholder: string; value: string; options: LocationOption[]; loading?: boolean; disabled?: boolean; onSelect: (option: LocationOption) => void }) {
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
  return <label>{label}<div className="location-combobox" ref={root} style={{ position: "relative" }}>
    <Search className="location-combobox-icon" size={15} style={{ pointerEvents: "none", position: "absolute", zIndex: 2, left: 10, top: 11 }} />
    <input className="field location-combobox-input" style={{ paddingLeft: 33 }} role="combobox" aria-autocomplete="list" aria-haspopup="listbox" aria-expanded={open} aria-controls={listId} aria-activedescendant={activeOptionId} aria-label={`Search ${label.toLowerCase()}`} disabled={disabled || loading} value={open ? query : selected?.name ?? ""} placeholder={loading ? `Loading ${label.toLowerCase()}s...` : placeholder} onFocus={() => { setQuery(""); setOpen(true); setActiveIndex(0); }} onBlur={() => window.setTimeout(() => { if (root.current && !root.current.contains(document.activeElement)) setOpen(false); }, 0)} onChange={(event) => { setQuery(event.target.value); setOpen(true); setActiveIndex(0); }} onKeyDown={(event) => { if (event.key === "Escape") { setOpen(false); return; } if (event.key === "ArrowDown") { event.preventDefault(); setActiveIndex((index) => open ? Math.min(index + 1, Math.max(filtered.length - 1, 0)) : 0); setOpen(true); } if (event.key === "ArrowUp") { event.preventDefault(); setActiveIndex((index) => open ? Math.max(index - 1, 0) : Math.max(filtered.length - 1, 0)); setOpen(true); } if (event.key === "Enter" && open && filtered[activeIndex]) { event.preventDefault(); choose(filtered[activeIndex]); } }} />
    {open && !disabled && !loading && <div className="location-combobox-options" id={listId} role="listbox" aria-label={`${label} options`} style={{ position: "absolute", zIndex: 15, top: "calc(100% + 5px)", left: 0, right: 0, maxHeight: 230, overflowY: "auto", padding: 4, border: "1px solid var(--line)", borderRadius: 8, background: "var(--surface)", boxShadow: "0 8px 16px oklch(0.25 0.03 158 / .12)" }}>{filtered.length ? filtered.map((option, index) => <button type="button" className={`location-combobox-option ${index === activeIndex ? "active" : ""}`} id={`${id}-location-option-${index}`} role="option" aria-selected={option.code === value} tabIndex={-1} key={option.code} style={{ display: "block", width: "100%", border: 0, borderRadius: 6, padding: "8px 9px", textAlign: "left" }} onMouseEnter={() => setActiveIndex(index)} onClick={() => choose(option)}>{option.name}</button>) : <div className="location-combobox-empty">No matching {label.toLowerCase()}.</div>}</div>}
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

function CustomFieldInput({ field, value, onChange }: { field: CustomFieldDefinition; value: string; onChange: (value: string) => void }) {
  const label = `${field.label}${field.required ? " *" : ""}`;
  if (field.type === "dropdown") return <label>{label}<select required={field.required} className="select" value={value} onChange={(e) => onChange(e.target.value)}><option value="">Select option</option>{activeOptions(field.options, value).map((option) => <option key={option.id}>{option.name}</option>)}</select></label>;
  return <label>{label}<input required={field.required} className="field" type={field.type} value={value} onChange={(e) => onChange(e.target.value)} placeholder={field.required ? "Required" : "Optional"} /></label>;
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
    wb.addWorksheet("Installations").addRows([["External Ref", "Site Name", "Solution", "Contractor", "Install Date", "Status", "Island Group", "Region", "Region Code", "Province", "Province Code", "Locality", "Locality Code", "Barangay", "Barangay Code", "Address", "Remarks", ...customFields.map((field) => field.label)], ["ROW-001", "Cebu Hub 01", "Satellite broadband", refs.contractors.find((x) => x.active)?.name ?? "", today(), "installed", "Visayas", "Region VII (Central Visayas)", "0700000000", "Cebu", "0730600000", "Cebu City", "30600", "Lahug", "0730600041", "", "", ...customFields.map(() => "")]]);
    wb.addWorksheet("Components").addRows([["Installation Ref", "Component Type", "Notes", ...componentLabels], ["ROW-001", "Modem", "", ...componentLabels.map((label) => label === "Serial number" ? "MDM-00001" : label === "MAC address" ? "A4:5E:60:11:28:9C" : "")]]);
    wb.addWorksheet("Instructions").addRows([
      ["FieldTrack site import guide"],
      ["1. Add one site per row on the Installations sheet. Site Name is required and must be unique."],
      ["2. Give each site a unique External Ref, such as ROW-001. This links equipment to the correct site."],
      ["3. Add deployed equipment on the Components sheet. Enter the matching External Ref under Installation Ref."],
      ["4. Fill in the equipment fields that apply to the selected Component Type. Required fields are configured by your admin."],
      ["5. Enter MAC addresses as AA:BB:CC:DD:EE:FF, AA-BB-CC-DD-EE-FF, or 12 hexadecimal characters."],
      ["6. Keep the PSGC code columns for reliable location matching. If codes are omitted, provide the complete Island Group, Region, Province, Locality, and Barangay path."],
      ["7. Upload the completed workbook in FieldTrack. Review any rows marked Needs attention before saving."],
      [],
      ["Allowed site statuses", "scheduled, installed, issue, cancelled"],
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
      const siteName = String(r["Site Name"] ?? ""); const contractor = String(r.Contractor ?? ""); const unitType = String(r.Solution ?? r["Unit Type"] ?? ""); const status = String(r.Status ?? "").toLowerCase();
      const location = resolveLocation({ islandGroup: r["Island Group"], region: r.Region, regionCode: r["Region Code"], province: r.Province, provinceCode: r["Province Code"], municipality: r.Locality || r["City/Municipality"], municipalityCode: r["Locality Code"], barangay: r.Barangay, barangayCode: r["Barangay Code"] });
      const customIssue = (refs.customFields ?? []).filter((field) => field.active).map((field) => field.required && !r[field.label] ? `Missing ${field.label}` : field.type === "dropdown" && r[field.label] && !field.options.some((option) => option.active && option.name === r[field.label]) ? `Invalid ${field.label}` : "").find(Boolean);
      const issue = !siteName ? "Missing site name" : !refs.unitTypes.some((option) => option.active && option.name === unitType) ? "Unknown solution" : !refs.contractors.some((option) => option.active && option.name === contractor) ? "Unknown contractor" : !Object.keys(statusMeta).includes(status) ? "Invalid status" : location.issue || customIssue || "";
      if (!issue && location.location) {
        const now = new Date().toISOString();
        const record: Installation = { id: `INS-${crypto.randomUUID().slice(0, 8).toUpperCase()}`, siteName, unitType, contractor, installDate: String(r["Install Date"] || today()), status: status as Status, ...location.location, address: String(r.Address ?? ""), remarks: String(r.Remarks ?? ""), components: [], customValues: Object.fromEntries((refs.customFields ?? []).map((field) => [field.id, String(r[field.label] ?? "")])), photos: [], createdBy: "Imported workbook", createdAt: now, updatedBy: "Imported workbook", updatedAt: now, serviceVisits: [], auditEvents: [] };
        siteByRef.set(String(r["External Ref"] ?? ""), record);
      }
      return { row: i + 2, kind: "Site" as const, subject: siteName, details: contractor, reference: location.location ? `${location.location.barangay}, ${location.location.municipality}` : `${r.Barangay ?? ""}, ${r.Locality || r["City/Municipality"] || ""}`, valid: !issue, issue };
    });
    const componentSheet = wb.getWorksheet("Components"); const componentRows: ImportRow[] = [];
    if (componentSheet) { const componentHeaders = (componentSheet.getRow(1).values as string[]).slice(1).map(String); const importedMacs = new Set<string>(); componentSheet.eachRow((row, rowNumber) => { if (rowNumber > 1) { const values = (row.values as string[]).slice(1); const item = Object.fromEntries(componentHeaders.map((header, i) => [header, String(values[i] ?? "")])); const template = componentType(refs, item["Component Type"]); const installation = siteByRef.get(item["Installation Ref"]); const missing = template?.fields.find((field) => { const reusable = libraryField(refs, field); return field.active && field.required && reusable && !item[reusable.label]; }); const macField = template?.fields.find((field) => { const reusable = libraryField(refs, field); return field.active && reusable?.type === "mac" && item[reusable.label]; }); const integerField = template?.fields.find((field) => { const reusable = libraryField(refs, field); return field.active && reusable?.type === "integer" && item[reusable.label] && !validInteger(item[reusable.label]); }); const booleanField = template?.fields.find((field) => { const reusable = libraryField(refs, field); return field.active && reusable?.type === "boolean" && item[reusable.label] && !/^(true|false)$/i.test(item[reusable.label].trim()); }); const missingReusable = missing ? libraryField(refs, missing) : undefined; const macReusable = macField ? libraryField(refs, macField) : undefined; const integerReusable = integerField ? libraryField(refs, integerField) : undefined; const booleanReusable = booleanField ? libraryField(refs, booleanField) : undefined; const mac = macReusable ? item[macReusable.label] : ""; const normalized = normalizeMac(mac); const duplicate = normalized && (importedMacs.has(normalized) || records.some((record) => record.components.some((component) => componentMacValues(refs, component).includes(normalized)))); if (normalized) importedMacs.add(normalized); const issue = !installation ? "Unknown installation ref" : !template ? "Unknown equipment type" : missingReusable ? `Missing ${missingReusable.label}` : mac && !normalized ? "Check the MAC address format" : integerReusable ? `${integerReusable.label} must be a whole number` : booleanReusable ? `${booleanReusable.label} must be true or false` : duplicate ? "Duplicate MAC address, review required" : ""; if (!issue && installation && template) installation.components.push({ id: crypto.randomUUID(), type: template.name, notes: item["Notes"] ?? "", values: Object.fromEntries(template.fields.map((field) => { const reusable = libraryField(refs, field); const value = reusable ? String(item[reusable.label] ?? "") : ""; return [field.id, reusable?.type === "boolean" ? value.toLowerCase() : value]; })) }); componentRows.push({ row: rowNumber, kind: "Equipment", subject: item["Component Type"] || "Equipment type required", details: item["Notes"], reference: item["Installation Ref"], valid: !issue, issue }); } }); }
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

type SettingsSection = "users" | "contractors" | "unitTypes" | "componentTypes" | "customFields" | "serviceVisitTypes";
type ReferenceSettingsSection = Exclude<SettingsSection, "customFields" | "users">;
const settingsPaths: Record<SettingsSection, string> = { users: "/admin/users", contractors: "/admin/contractors", unitTypes: "/admin/solutions", componentTypes: "/admin/component-types", customFields: "/admin/custom-fields", serviceVisitTypes: "/admin/service-visit-types" };
function settingsSectionFromPathname(pathname: string): SettingsSection {
  return (Object.entries(settingsPaths).find(([, path]) => path === pathname)?.[0] as SettingsSection | undefined) ?? "contractors";
}
const settingsSections = [["users", Users, "Users"], ["contractors", Users, "Contractors"], ["unitTypes", Package, "Solutions"], ["componentTypes", CircleDot, "Component types"], ["customFields", ClipboardList, "Custom installation fields"], ["serviceVisitTypes", Wrench, "Service visit types"]] as const;
function orderedSettings<T extends { order?: number }>(items: T[]) { return [...items].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)); }
function reorderSettings<T extends { id: string; order?: number }>(items: T[], sourceId: string, targetId: string) { const ordered = orderedSettings(items); const moved = ordered.find((item) => item.id === sourceId); if (!moved || sourceId === targetId) return ordered; const reordered = ordered.filter((item) => item.id !== sourceId); const targetIndex = reordered.findIndex((item) => item.id === targetId); reordered.splice(targetIndex, 0, moved); return reordered.map((item, order) => ({ ...item, order })); }
function ReorderHandle({ label, onPointerDown, onKeyDown }: { label: string; onPointerDown: () => void; onKeyDown: (direction: number) => void }) { return <button type="button" className="drag-handle" aria-label={`Reorder ${label}. Use arrow keys to move.`} title="Drag or use arrow keys to reorder" onPointerDown={(event) => { event.preventDefault(); onPointerDown(); }} onKeyDown={(event) => { if (event.key === "ArrowUp" || event.key === "ArrowLeft") { event.preventDefault(); onKeyDown(-1); } else if (event.key === "ArrowDown" || event.key === "ArrowRight") { event.preventDefault(); onKeyDown(1); } }}><GripVertical size={16} /></button>; }
function settingsSectionLabel(section: SettingsSection) { return settingsSections.find(([id]) => id === section)?.[2] ?? "Settings"; }
function ReferenceSaveStatus({ state, dirty, error, onRetry }: { state: ReferenceSaveState; dirty: boolean; error: string; onRetry: () => void }) {
  return <div className={`reference-save-status ${state === "saving" ? "saving" : state === "failed" ? "failed" : dirty ? "dirty" : "saved"}`} role="status" aria-live="polite">{state === "saving" ? <><span className="save-status-dot" />Saving changes...</> : state === "failed" ? <><AlertTriangle size={15} />Could not save changes<button type="button" className="button ghost" title={error} onClick={onRetry}>Retry</button></> : dirty ? <><span className="save-status-dot" />Unsaved changes</> : <><CheckCircle2 size={15} />Changes saved</>}</div>;
}
function NameEditorModal({ title, label, initialValue = "", existingNames = [], onClose, onSave }: { title: string; label: string; initialValue?: string; existingNames?: string[]; onClose: () => void; onSave: (value: string) => void }) {
  const [value, setValue] = useState(initialValue); const [message, setMessage] = useState("");
  useEscape(onClose);
  return <div className="modal-backdrop" role="presentation"><form className="modal-panel" role="dialog" aria-modal="true" aria-labelledby="name-editor-title" onSubmit={(event) => { event.preventDefault(); const next = value.trim(); if (!next) { setMessage(`Enter a ${label.toLowerCase()}.`); return; } if (existingNames.some((name) => name.localeCompare(next, undefined, { sensitivity: "base" }) === 0)) { setMessage(`${next} already exists.`); return; } onSave(next); }}><div className="modal-header"><div><h2 id="name-editor-title">{title}</h2><p className="muted">Use a clear, unique name for staff records and reports.</p></div><button type="button" className="button icon-button ghost" aria-label="Close editor" onClick={onClose}><X size={17} /></button></div><label>{label}<input autoFocus className="field" value={value} onChange={(event) => setValue(event.target.value)} /></label>{message && <div className="notice validation-notice inline" role="alert">{message}</div>}<div className="modal-actions"><button type="button" className="button" onClick={onClose}>Cancel</button><button className="button primary">Save name</button></div></form></div>;
}
function RowActionMenu({ label, children }: { label: string; children: React.ReactNode }) {
  return <details className="row-action-menu"><summary className="button icon-button ghost" aria-label={label} title={label}><MoreHorizontal size={16} /></summary><div className="row-action-menu-panel" onClick={(event) => { if ((event.target as HTMLElement).closest("button")) event.currentTarget.parentElement?.removeAttribute("open"); }}>{children}</div></details>;
}
function SettingsPage({ refs, setRefs, records, profile, referenceSaveState, referenceSaveError, hasUnsavedReferences, saveReferences, discardReferences, refreshWorkspace, deleteComponentType, deleteEquipmentField, notify }: { refs: ReferenceData; setRefs: Dispatch<SetStateAction<ReferenceData>>; records: Installation[]; profile: Profile; referenceSaveState: ReferenceSaveState; referenceSaveError: string; hasUnsavedReferences: boolean; saveReferences: () => Promise<boolean>; discardReferences: () => void; refreshWorkspace: () => Promise<void>; deleteComponentType: (type: ComponentTypeOption) => void; deleteEquipmentField: (field: EquipmentFieldLibraryItem) => Promise<boolean>; notify: (s: string) => void }) {
  const pathname = usePathname();
  const navigate = useGuardedNavigation();
  const [section, setSection] = useState<SettingsSection>(() => settingsSectionFromPathname(pathname)); const [name, setName] = useState("");
  const [selectedComponentId, setSelectedComponentId] = useState(refs.componentTypes[0]?.id ?? "");
  const [fieldType, setFieldType] = useState<CustomFieldType>("text"); const [required, setRequired] = useState(false);
  const [deletingReference, setDeletingReference] = useState<{ section: "contractors" | "unitTypes"; option: ReferenceOption }>();
  const [deletingCustomField, setDeletingCustomField] = useState<CustomFieldDefinition>();
  const [renamingReference, setRenamingReference] = useState<{ section: ReferenceSettingsSection; option: ReferenceOption }>();
  const [draggedSetting, setDraggedSetting] = useState<{ section: Exclude<SettingsSection, "users">; id: string }>();
  const [pendingSection, setPendingSection] = useState<SettingsSection>();
  useEffect(() => { void prefetchUsers(); }, []);
  useEscape(() => { setDeletingReference(undefined); setDeletingCustomField(undefined); }, Boolean(deletingReference || deletingCustomField));
  useEffect(() => { if (!draggedSetting) return; function release() { setDraggedSetting(undefined); notify("Order updated. Save changes to apply."); } window.addEventListener("pointerup", release); return () => window.removeEventListener("pointerup", release); }, [draggedSetting, notify]);
  function add(e: FormEvent) { e.preventDefault(); if (!name.trim() || section === "users") return; if (section === "customFields") { const customFields = refs.customFields ?? []; const newField: CustomFieldDefinition = { id: uuid(), label: name.trim(), type: fieldType, required, active: true, order: customFields.length, options: [] }; setRefs({ ...refs, customFields: [...customFields, newField] }); } else if (section === "componentTypes") { setRefs({ ...refs, componentTypes: [...refs.componentTypes, { id: uuid(), name: name.trim(), active: true, order: refs.componentTypes.length, fields: [] }] }); } else { setRefs({ ...refs, [section]: [...refs[section], { id: uuid(), name: name.trim(), active: true, order: refs[section].length }] }); } setName(""); setRequired(false); notify("Setting added. Save changes to apply."); }
  function reorderReference(target: ReferenceSettingsSection, sourceId: string, targetId: string) { setRefs((current) => ({ ...current, [target]: reorderSettings(current[target], sourceId, targetId) })); }
  function reorderCustomField(sourceId: string, targetId: string) { setRefs((current) => ({ ...current, customFields: reorderSettings(current.customFields, sourceId, targetId) })); }
  function moveSettingWithKeyboard(target: Exclude<SettingsSection, "users">, id: string, direction: number) { if (target === "customFields") { const items = orderedSettings(refs.customFields); const index = items.findIndex((item) => item.id === id); const destination = items[index + direction]; if (!destination) return; reorderCustomField(id, destination.id); } else { const items = orderedSettings(refs[target]); const index = items.findIndex((item) => item.id === id); const destination = items[index + direction]; if (!destination) return; reorderReference(target, id, destination.id); } notify("Order updated. Save changes to apply."); }
  function patchOption(target: ReferenceSettingsSection, id: string, data: Partial<ReferenceOption>) { setRefs({ ...refs, [target]: refs[target].map((option) => option.id === id ? { ...option, ...data } : option) }); }
  function patchField(id: string, data: Partial<CustomFieldDefinition>) { setRefs({ ...refs, customFields: (refs.customFields ?? []).map((field) => field.id === id ? { ...field, ...data } : field) }); }
  function renameOption(target: ReferenceSettingsSection, option: ReferenceOption) { setRenamingReference({ section: target, option }); }
  function moveField(field: CustomFieldDefinition, direction: number) { const fields = [...(refs.customFields ?? [])].sort((a, b) => a.order - b.order); const index = fields.findIndex((item) => item.id === field.id); const swap = fields[index + direction]; if (!swap) return; setRefs({ ...refs, customFields: (refs.customFields ?? []).map((item) => item.id === field.id ? { ...item, order: swap.order } : item.id === swap.id ? { ...item, order: field.order } : item) }); }
  function referenceUsage(target: "contractors" | "unitTypes", option: ReferenceOption) { return records.filter((record) => target === "contractors" ? record.contractor === option.name : record.unitType === option.name).length; }
  async function deleteReference(target: "contractors" | "unitTypes", option: ReferenceOption) { if (hasUnsavedReferences) { setDeletingReference(undefined); notify("Save or discard your pending settings changes before deleting a value."); return; } if (referenceUsage(target, option)) { setDeletingReference(undefined); notify(`${option.name} is still used by site records. Deactivate it instead.`); return; } try { await deleteReferencePermanently(target === "contractors" ? "contractor" : "unitType", option.id); await refreshWorkspace(); setDeletingReference(undefined); notify(`${option.name} was deleted.`); } catch (error) { notify(error instanceof Error ? error.message : "Unable to delete setting."); } }
  function customFieldUsage(field: CustomFieldDefinition) { return records.filter((record) => Boolean(record.customValues?.[field.id])).length; }
  async function deleteCustomField(field: CustomFieldDefinition) { if (hasUnsavedReferences) { setDeletingCustomField(undefined); notify("Save or discard your pending settings changes before deleting a custom field."); return; } try { await deleteReferencePermanently("customField", field.id); await refreshWorkspace(); setDeletingCustomField(undefined); notify(`${field.label} was deleted.`); } catch (error) { notify(error instanceof Error ? error.message : "Unable to delete custom field."); } }
  const selectedComponent = refs.componentTypes.find((item) => item.id === selectedComponentId) ?? refs.componentTypes[0];
  const addLabel = section === "contractors" ? "Add contractor" : section === "unitTypes" ? "Add solution" : section === "componentTypes" ? "Add component type" : section === "serviceVisitTypes" ? "Add visit type" : "Add field";
  function openSection(next: SettingsSection) { setSection(next); navigate(settingsPaths[next], { bypassGuard: true }); }
  function requestSection(next: SettingsSection) { if (next === section) return; if (hasUnsavedReferences) setPendingSection(next); else openSection(next); }
  return <>
    <div className="page-head"><div><p className="eyebrow">Administration</p><h1>Reference settings</h1><p className="muted">Maintain the choices available in site records and reports.</p></div><ReferenceSaveStatus state={referenceSaveState} dirty={hasUnsavedReferences} error={referenceSaveError} onRetry={() => void saveReferences()} /></div>
    <div className="settings-layout"><div className="panel settings-nav-panel"><div className="panel-head"><h2>Settings sections</h2></div><label className="settings-mobile-select">Settings section<select className="select" value={section} onChange={(event) => requestSection(event.target.value as SettingsSection)}>{settingsSections.map(([id, , label]) => <option value={id} key={id}>{label}</option>)}</select></label><div className="nav settings-section-tabs">{settingsSections.map(([id, Icon, label]) => <button key={id} onClick={() => requestSection(id)} className={section === id ? "active" : ""}><Icon size={16} />{label}</button>)}</div><div className="section small muted settings-audit-note"><Activity size={16} style={{ marginBottom: 8 }} />Deactivated values remain on historical records. Admin changes are recorded in the production audit log.</div></div>
    <div className="panel settings-editor"><div className="panel-head settings-editor-head"><h2>{settingsSectionLabel(section)}</h2>{section !== "users" && <div className="toolbar"><button type="button" className="button" disabled={!hasUnsavedReferences || referenceSaveState === "saving"} onClick={discardReferences}>Discard changes</button><button type="button" className="button primary" disabled={!hasUnsavedReferences || referenceSaveState === "saving"} onClick={() => void saveReferences()}>{referenceSaveState === "saving" ? "Saving..." : "Save changes"}</button></div>}</div>
      {section === "users" ? <><div className="section immediate-settings-note"><strong>User access changes apply immediately.</strong><div className="small muted">Role changes, activation updates, and password resets take effect after confirmation.</div></div><UsersSettings currentProfile={profile} notify={notify} /></> : section === "customFields" ? orderedSettings(refs.customFields ?? []).map((field) => <CustomFieldSettings key={field.id} field={field} otherFieldNames={(refs.customFields ?? []).filter((item) => item.id !== field.id).map((item) => item.label)} dragging={draggedSetting?.section === "customFields" && draggedSetting.id === field.id} deleteDisabled={hasUnsavedReferences} onDragStart={() => setDraggedSetting({ section: "customFields", id: field.id })} onDragEnter={() => { if (draggedSetting?.section === "customFields") reorderCustomField(draggedSetting.id, field.id); }} onKeyboardMove={(direction) => moveSettingWithKeyboard("customFields", field.id, direction)} patchField={patchField} moveField={moveField} deleteField={() => setDeletingCustomField(field)} />) : section === "componentTypes" ? <div className="component-settings-layout"><div className="component-type-list">{orderedSettings(refs.componentTypes).map((item) => <div className={`component-type-list-row ${draggedSetting?.section === "componentTypes" && draggedSetting.id === item.id ? "dragging" : ""}`} key={item.id} onPointerEnter={() => { if (draggedSetting?.section === "componentTypes") reorderReference("componentTypes", draggedSetting.id, item.id); }}><ReorderHandle label={item.name} onPointerDown={() => setDraggedSetting({ section: "componentTypes", id: item.id })} onKeyDown={(direction) => moveSettingWithKeyboard("componentTypes", item.id, direction)} /><button type="button" className={item.id === selectedComponent?.id ? "selected" : ""} onClick={() => setSelectedComponentId(item.id)}><strong>{item.name}</strong><span>{item.fields.length} fields | {records.reduce((count, record) => count + record.components.filter((component) => component.type === item.name).length, 0)} installed</span></button></div>)}</div>{selectedComponent && <div className="component-type-editor"><ComponentTypeSettings key={selectedComponent.id} componentType={selectedComponent} equipmentFields={refs.equipmentFields ?? []} otherTypeNames={refs.componentTypes.filter((item) => item.id !== selectedComponent.id).map((item) => item.name)} equipmentFieldUsage={(libraryFieldId) => { const fieldIds = new Set(refs.componentTypes.flatMap((type) => type.fields.filter((field) => field.libraryFieldId === libraryFieldId).map((field) => field.id))); return { attachmentCount: fieldIds.size, savedValueCount: records.reduce((count, record) => count + record.components.reduce((subtotal, component) => subtotal + Object.keys(component.values ?? {}).filter((id) => fieldIds.has(id)).length, 0), 0) }; }} createEquipmentField={(field) => setRefs((current) => ({ ...current, equipmentFields: [...(current.equipmentFields ?? []), field] }))} deleteDisabled={hasUnsavedReferences} deleteEquipmentField={deleteEquipmentField} usageCount={records.reduce((count, record) => count + record.components.filter((component) => component.type === selectedComponent.name).length, 0)} deleteType={() => deleteComponentType(selectedComponent)} patchType={(data) => setRefs((current) => ({ ...current, componentTypes: current.componentTypes.map((type) => type.id === selectedComponent.id ? { ...type, ...data } : type) }))} renameType={(next) => setRefs((current) => ({ ...current, componentTypes: current.componentTypes.map((type) => type.id === selectedComponent.id ? { ...type, name: next } : type) }))} notify={notify} /></div>}</div> : orderedSettings(refs[section]).map((item) => <div className={`section settings-row reference-settings-row ${draggedSetting?.section === section && draggedSetting.id === item.id ? "dragging" : ""}`} key={item.id} onPointerEnter={() => { if (draggedSetting?.section === section) reorderReference(section, draggedSetting.id, item.id); }}><ReorderHandle label={item.name} onPointerDown={() => setDraggedSetting({ section, id: item.id })} onKeyDown={(direction) => moveSettingWithKeyboard(section, item.id, direction)} /><div className="reference-settings-copy"><strong>{item.name}</strong><div className="small muted">{item.active ? "Available for new records" : "Hidden from new records"}</div></div><RowActionMenu label={`Actions for ${item.name}`}><button type="button" onClick={() => renameOption(section, item)}><Pencil size={15} />Rename</button><button type="button" className={item.active ? "danger" : ""} onClick={() => { patchOption(section, item.id, { active: !item.active }); notify(item.active ? "Setting deactivated. Save changes to apply." : "Setting reactivated. Save changes to apply."); }}><Power size={15} />{item.active ? "Deactivate" : "Reactivate"}</button>{section !== "serviceVisitTypes" && <button type="button" className="danger" disabled={hasUnsavedReferences} title={hasUnsavedReferences ? "Save or discard changes before deleting permanently" : undefined} onClick={() => setDeletingReference({ section, option: item })}><Trash2 size={15} />Delete permanently</button>}</RowActionMenu></div>)}
      {section !== "users" && <form className="section toolbar" onSubmit={add}><input className="field" style={{ maxWidth: 280 }} value={name} onChange={(e) => setName(e.target.value)} placeholder={section === "customFields" ? "New field label" : "Add approved value"} />{section === "customFields" && <><select className="select" value={fieldType} onChange={(e) => setFieldType(e.target.value as CustomFieldType)}><option value="text">Text</option><option value="number">Number</option><option value="date">Date</option><option value="dropdown">Dropdown</option></select><label style={{ display: "flex", alignItems: "center", gap: 6 }}><input type="checkbox" checked={required} onChange={(e) => setRequired(e.target.checked)} />Required</label></>}<button className="button primary"><Plus size={15} />{addLabel}</button></form>}</div></div>
    {renamingReference && <NameEditorModal title={`Rename ${settingsSectionLabel(renamingReference.section).toLowerCase()}`} label="Name" initialValue={renamingReference.option.name} existingNames={refs[renamingReference.section].filter((item) => item.id !== renamingReference.option.id).map((item) => item.name)} onClose={() => setRenamingReference(undefined)} onSave={(next) => { patchOption(renamingReference.section, renamingReference.option.id, { name: next }); setRenamingReference(undefined); }} />}
    {deletingReference && <div className="modal-backdrop" role="presentation"><div className="modal-panel" role="dialog" aria-modal="true" aria-labelledby="delete-reference"><div className="modal-icon"><AlertTriangle size={20} /></div><h2 id="delete-reference">{referenceUsage(deletingReference.section, deletingReference.option) ? `Cannot delete ${deletingReference.option.name}` : `Delete ${deletingReference.option.name} permanently?`}</h2><p className="muted">{referenceUsage(deletingReference.section, deletingReference.option) ? `This value is used by ${referenceUsage(deletingReference.section, deletingReference.option)} site records. Deactivate it instead so existing records remain accurate.` : "This removes the choice permanently. This cannot be undone."}</p><div className="modal-actions"><button type="button" className="button" onClick={() => setDeletingReference(undefined)}>{referenceUsage(deletingReference.section, deletingReference.option) ? "Close" : "Cancel"}</button>{!referenceUsage(deletingReference.section, deletingReference.option) && <button type="button" className="button danger-solid" onClick={() => deleteReference(deletingReference.section, deletingReference.option)}><Trash2 size={15} />Delete permanently</button>}</div></div></div>}
    {deletingCustomField && <div className="modal-backdrop" role="presentation"><div className="modal-panel" role="dialog" aria-modal="true" aria-labelledby="delete-custom-field"><div className="modal-icon"><AlertTriangle size={20} /></div><h2 id="delete-custom-field">Delete {deletingCustomField.label} permanently?</h2><p className="muted">This cannot be undone. Deleting this custom field removes {customFieldUsage(deletingCustomField)} saved site values and any configured dropdown choices.</p><div className="modal-actions"><button type="button" className="button" onClick={() => setDeletingCustomField(undefined)}>Cancel</button><button type="button" className="button danger-solid" onClick={() => deleteCustomField(deletingCustomField)}><Trash2 size={15} />Delete permanently</button></div></div></div>}
    {pendingSection && <div className="modal-backdrop" role="presentation"><div className="modal-panel" role="alertdialog" aria-modal="true" aria-labelledby="discard-settings-section"><div className="modal-icon"><AlertTriangle size={20} /></div><h2 id="discard-settings-section">Leave without saving changes?</h2><p className="muted">Your unsaved updates in {settingsSectionLabel(section).toLowerCase()} will be discarded before opening {settingsSectionLabel(pendingSection).toLowerCase()}.</p><div className="modal-actions"><button type="button" className="button" onClick={() => setPendingSection(undefined)}>Keep editing</button><button type="button" className="button danger-solid" onClick={() => { discardReferences(); openSection(pendingSection); setPendingSection(undefined); }}>Discard changes</button><button type="button" className="button primary" onClick={async () => { if (await saveReferences()) { openSection(pendingSection); setPendingSection(undefined); } }}>Save and continue</button></div></div></div>}
  </>;
}

function CustomFieldSettings({ field, otherFieldNames, dragging, deleteDisabled, onDragStart, onDragEnter, onKeyboardMove, patchField, moveField, deleteField }: { field: CustomFieldDefinition; otherFieldNames: string[]; dragging: boolean; deleteDisabled: boolean; onDragStart: () => void; onDragEnter: () => void; onKeyboardMove: (direction: number) => void; patchField: (id: string, data: Partial<CustomFieldDefinition>) => void; moveField: (field: CustomFieldDefinition, direction: number) => void; deleteField: () => void }) {
  const [editor, setEditor] = useState<{ kind: "field" | "addOption" | "option"; option?: ReferenceOption }>();
  function patchDropdownOption(id: string, data: Partial<ReferenceOption>) { patchField(field.id, { options: field.options.map((option) => option.id === id ? { ...option, ...data } : option) }); }
  return <div className="section">
    <div className={`settings-row reference-settings-row ${dragging ? "dragging" : ""}`} onPointerEnter={onDragEnter}><ReorderHandle label={field.label} onPointerDown={onDragStart} onKeyDown={onKeyboardMove} /><div className="reference-settings-copy"><strong>{field.label}</strong><div className="small muted">{field.type}{field.required ? " | required" : " | optional"}{field.active ? "" : " | inactive"}</div></div><RowActionMenu label={`Actions for ${field.label}`}><button type="button" onClick={() => moveField(field, -1)}><ArrowUp size={15} />Move up</button><button type="button" onClick={() => moveField(field, 1)}><ArrowDown size={15} />Move down</button><button type="button" onClick={() => setEditor({ kind: "field" })}><Pencil size={15} />Rename</button><button type="button" className={field.active ? "danger" : ""} onClick={() => patchField(field.id, { active: !field.active })}><Power size={15} />{field.active ? "Deactivate" : "Reactivate"}</button><button type="button" className="danger" disabled={deleteDisabled} title={deleteDisabled ? "Save or discard changes before deleting permanently" : undefined} onClick={deleteField}><Trash2 size={15} />Delete permanently</button></RowActionMenu></div>
    <label style={{ display: "flex", alignItems: "center", gap: 7, marginTop: 11 }}><input type="checkbox" checked={field.required} onChange={(e) => patchField(field.id, { required: e.target.checked })} />Required on new site records</label>
    {field.type === "dropdown" && <div className="option-list"><div className="small muted">Dropdown options</div>{field.options.map((option) => <div className="option-row" key={option.id}><span>{option.name}</span><RowActionMenu label={`Actions for ${option.name}`}><button type="button" onClick={() => setEditor({ kind: "option", option })}><Pencil size={14} />Rename</button><button type="button" className={option.active ? "danger" : ""} onClick={() => patchDropdownOption(option.id, { active: !option.active })}><Power size={14} />{option.active ? "Deactivate" : "Reactivate"}</button></RowActionMenu></div>)}<button type="button" className="button" style={{ marginTop: 8 }} onClick={() => setEditor({ kind: "addOption" })}><Plus size={14} />Add dropdown option</button></div>}
    {editor && <NameEditorModal title={editor.kind === "field" ? "Rename custom field" : editor.kind === "option" ? "Rename dropdown option" : "Add dropdown option"} label={editor.kind === "field" ? "Field name" : "Option name"} initialValue={editor.kind === "field" ? field.label : editor.option?.name} existingNames={editor.kind === "field" ? otherFieldNames : field.options.filter((option) => option.id !== editor.option?.id).map((option) => option.name)} onClose={() => setEditor(undefined)} onSave={(next) => { if (editor.kind === "field") patchField(field.id, { label: next }); else if (editor.kind === "option" && editor.option) patchDropdownOption(editor.option.id, { name: next }); else patchField(field.id, { options: [...field.options, { id: uuid(), name: next, active: true }] }); setEditor(undefined); }} />}
  </div>;
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
  const [updatingId, setUpdatingId] = useState<string>();
  const [pendingAccess, setPendingAccess] = useState<{ profile: Profile; data: Partial<Profile>; title: string; detail: string }>();
  useEscape(() => { setTemporaryPassword(undefined); setResetting(undefined); setPendingAccess(undefined); setCopied(false); }, Boolean(temporaryPassword || resetting || pendingAccess));
  const refreshUsers = useCallback(async (force = false) => { if (!getCachedUsers()) setLoading(true); try { setProfiles(await listUsers({ force })); } catch (error) { notify(error instanceof Error ? error.message : "Unable to load users."); } finally { setLoading(false); } }, [notify]);
  useEffect(() => { void Promise.resolve().then(() => refreshUsers()); }, [refreshUsers]);
  async function create(e: FormEvent) { e.preventDefault(); if (!fullName.trim() || !email.trim()) return; setCreating(true); try { const result = await createUser(fullName.trim(), email.trim()); setTemporaryPassword({ password: result.temporaryPassword, email: email.trim() }); setFullName(""); setEmail(""); await refreshUsers(true); notify("User created."); } catch (error) { notify(error instanceof Error ? error.message : "Unable to create user."); } finally { setCreating(false); } }
  async function resetPassword() { if (!resetting) return; try { const result = await generateUserTemporaryPassword(resetting.id); setTemporaryPassword({ password: result.temporaryPassword, email: resetting.email }); setResetting(undefined); notify("Temporary password generated."); } catch (error) { notify(error instanceof Error ? error.message : "Unable to generate a temporary password."); } }
  async function copyTemporaryPassword() { if (!temporaryPassword) return; try { await navigator.clipboard.writeText(temporaryPassword.password); setCopied(true); } catch { notify("Unable to copy the password. Select it and copy manually."); } }
  async function patch(profile: Profile, data: Partial<Profile>) { setUpdatingId(profile.id); try { await updateUser({ ...profile, ...data }); await refreshUsers(true); notify("User access updated."); } catch (error) { notify(error instanceof Error ? error.message : "Unable to update user."); } finally { setUpdatingId(undefined); } }
  async function confirmAccess() { if (!pendingAccess) return; const { profile, data } = pendingAccess; setPendingAccess(undefined); await patch(profile, data); }
  return <div>
    <form className="section toolbar" onSubmit={create}><input required className="field" value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Display name" /><input required className="field" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Staff email address" /><button className="button primary" disabled={creating}>{creating ? "Creating user..." : <><Plus size={15} />Create user</>}</button></form>
    {loading ? <div className="section muted">Loading users...</div> : profiles.map((profile) => { const updating = updatingId === profile.id; return <div className="section settings-row user-settings-row" key={profile.id}><div className="user-settings-identity"><strong>{profile.fullName}</strong><div className="small muted">{profile.email}{profile.id === currentProfile.id ? " | signed in" : ""}{updating ? " | saving..." : ""}</div></div><div className="user-settings-controls"><label className="user-role-control"><span className="small muted">Role</span><select className="select" aria-label={`Role for ${profile.email}`} value={profile.role} disabled={profile.id === currentProfile.id || updating} onChange={(e) => { const role = e.target.value as Profile["role"]; setPendingAccess({ profile, data: { role }, title: `Change ${profile.fullName}'s role?`, detail: `${profile.email} will become ${role === "admin" ? "an administrator with access to users and reference settings" : role === "guest" ? "a read-only guest who can browse and export records" : "a staff user who can update operational records without admin settings access"}.` }); }}><option value="guest">Guest (read only)</option><option value="staff">Staff</option><option value="admin">Administrator</option></select></label><div className="user-settings-actions">{profile.id !== currentProfile.id && <button type="button" className="button" disabled={updating} onClick={() => setResetting(profile)}><KeyRound size={14} />Temporary password</button>}<button type="button" className={`button ${profile.active ? "danger" : ""}`} disabled={profile.id === currentProfile.id || updating} onClick={() => profile.active ? setPendingAccess({ profile, data: { active: false }, title: `Deactivate ${profile.fullName}?`, detail: `${profile.email} will no longer be able to sign in until an administrator reactivates the account.` }) : void patch(profile, { active: true })}>{updating ? "Saving..." : profile.active ? "Deactivate" : "Activate"}</button></div></div></div>; })}
    {pendingAccess && <div className="modal-backdrop" role="presentation"><div className="modal-panel" role="alertdialog" aria-modal="true" aria-labelledby="confirm-user-access"><div className="modal-icon"><AlertTriangle size={20} /></div><h2 id="confirm-user-access">{pendingAccess.title}</h2><p className="muted">{pendingAccess.detail}</p><div className="modal-actions"><button type="button" className="button" onClick={() => setPendingAccess(undefined)}>Cancel</button><button type="button" className="button primary" onClick={confirmAccess}>Confirm access change</button></div></div></div>}
    {resetting && <div className="modal-backdrop" role="presentation"><div className="modal-panel" role="dialog" aria-modal="true" aria-labelledby="reset-user-password"><div className="modal-icon"><AlertTriangle size={20} /></div><h2 id="reset-user-password">Generate a new temporary password?</h2><p className="muted">The current password for {resetting.email} will stop working immediately. Share the replacement through your approved internal channel.</p><div className="modal-actions"><button type="button" className="button" onClick={() => setResetting(undefined)}>Cancel</button><button type="button" className="button primary" onClick={resetPassword}><KeyRound size={15} />Generate password</button></div></div></div>}
    {temporaryPassword && <div className="modal-backdrop" role="presentation"><div className="modal-panel" role="dialog" aria-modal="true" aria-labelledby="temporary-password-title"><div className="modal-header"><div><h2 id="temporary-password-title">Temporary password</h2><p className="muted">Share this password with {temporaryPassword.email} through your approved internal channel. It will not be shown again.</p></div><button type="button" className="button icon-button ghost" aria-label="Close temporary password" onClick={() => { setTemporaryPassword(undefined); setCopied(false); }}><X size={17} /></button></div><div className="temporary-password" role="status">{temporaryPassword.password}</div><div className="modal-actions"><button type="button" className="button" onClick={copyTemporaryPassword}><ClipboardCopy size={15} />{copied ? "Copied" : "Copy password"}</button><button type="button" className="button primary" onClick={() => { setTemporaryPassword(undefined); setCopied(false); }}>Done</button></div></div></div>}
  </div>;
}

function ComponentTypeSettings({ componentType: type, equipmentFields, otherTypeNames, equipmentFieldUsage, createEquipmentField, deleteDisabled, deleteEquipmentField, usageCount, deleteType, patchType, renameType, notify }: { componentType: ComponentTypeOption; equipmentFields: EquipmentFieldLibraryItem[]; otherTypeNames: string[]; equipmentFieldUsage: (libraryFieldId: string) => { attachmentCount: number; savedValueCount: number }; createEquipmentField: (field: EquipmentFieldLibraryItem) => void; deleteDisabled: boolean; deleteEquipmentField: (field: EquipmentFieldLibraryItem) => Promise<boolean>; usageCount: number; deleteType: () => void; patchType: (data: Partial<ComponentTypeOption>) => void; renameType: (name: string) => void; notify: (message: string) => void }) {
  const fields = type.fields ?? [];
  const [selectedLibraryId, setSelectedLibraryId] = useState(equipmentFields.find((field) => field.active)?.id ?? "");
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deletingField, setDeletingField] = useState<EquipmentFieldLibraryItem>();
  const [newFieldOpen, setNewFieldOpen] = useState(false);
  const [newFieldLabel, setNewFieldLabel] = useState("");
  const [newFieldType, setNewFieldType] = useState<ComponentFieldType>("text");
  const [renameOpen, setRenameOpen] = useState(false);
  const [draggedFieldId, setDraggedFieldId] = useState<string>();
  const [dragOverFieldId, setDragOverFieldId] = useState<string>();
  useEscape(() => { setDeleteOpen(false); setDeletingField(undefined); setNewFieldOpen(false); }, Boolean(deleteOpen || deletingField || newFieldOpen));
  function reorderField(sourceId: string, targetId: string) { if (sourceId === targetId) return; const ordered = [...fields].sort((a, b) => a.order - b.order); const moved = ordered.find((field) => field.id === sourceId); if (!moved) return; const reordered = ordered.filter((field) => field.id !== sourceId); const targetIndex = reordered.findIndex((field) => field.id === targetId); reordered.splice(targetIndex, 0, moved); patchType({ fields: reordered.map((field, order) => ({ ...field, order })) }); }
  function moveFieldWithKeyboard(fieldId: string, direction: number) { const ordered = [...fields].sort((a, b) => a.order - b.order); const index = ordered.findIndex((field) => field.id === fieldId); const target = ordered[index + direction]; if (!target) return; reorderField(fieldId, target.id); notify("Equipment field order updated. Save changes to apply."); }
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
    <div className="settings-row"><div><strong>{type.name}</strong><div className="small muted">{type.active ? "Available for new records" : "Hidden from new records"} | {fields.length} configured fields | {usageCount} installed rows</div></div><RowActionMenu label={`Actions for ${type.name}`}><button type="button" onClick={() => setRenameOpen(true)}><Pencil size={15} />Rename component type</button><button type="button" className={type.active ? "danger" : ""} onClick={() => patchType({ active: !type.active })}><Power size={15} />{type.active ? "Deactivate component type" : "Reactivate component type"}</button><button type="button" className="danger" disabled={deleteDisabled} title={deleteDisabled ? "Save or discard changes before deleting permanently" : undefined} onClick={() => setDeleteOpen(true)}><Trash2 size={15} />Delete permanently</button></RowActionMenu></div>
    <div className="option-list"><div className="small muted">Equipment fields | drag the handle or use its arrow keys to reorder</div>{[...fields].sort((a, b) => a.order - b.order).map((field) => { const reusable = equipmentFields.find((item) => item.id === field.libraryFieldId); return <div className={`template-field-row ${draggedFieldId === field.id ? "dragging" : ""} ${dragOverFieldId === field.id ? "drag-over" : ""}`} key={field.id} onPointerEnter={() => { if (!draggedFieldId || draggedFieldId === field.id) return; setDragOverFieldId(field.id); reorderField(draggedFieldId, field.id); }}><button type="button" className="drag-handle" aria-label={`Reorder ${reusable?.label ?? "equipment field"}. Use arrow keys to move.`} title="Drag or use arrow keys to reorder" onPointerDown={(e) => { e.preventDefault(); setDraggedFieldId(field.id); setDragOverFieldId(field.id); }} onKeyDown={(e) => { if (e.key === "ArrowUp" || e.key === "ArrowLeft") { e.preventDefault(); moveFieldWithKeyboard(field.id, -1); } else if (e.key === "ArrowDown" || e.key === "ArrowRight") { e.preventDefault(); moveFieldWithKeyboard(field.id, 1); } }}><GripVertical size={16} /></button><span>{reusable?.label ?? "Missing equipment field"}</span><span className="small muted">{reusable ? equipmentFieldTypeLabel(reusable.type) : "Unknown"}</span><label style={{ display: "flex", alignItems: "center", gap: 5 }}><input type="checkbox" checked={field.required} onChange={(e) => patchField(field.id, { required: e.target.checked })} />Required</label><RowActionMenu label={`Actions for ${reusable?.label ?? "equipment field"}`}><button type="button" className={field.active ? "danger" : ""} onClick={() => patchField(field.id, { active: !field.active })}><Power size={14} />{field.active ? "Deactivate field" : "Reactivate field"}</button>{reusable && <button type="button" className="danger" disabled={deleteDisabled} title={deleteDisabled ? "Save or discard changes before deleting permanently" : undefined} onClick={() => setDeletingField(reusable)}><Trash2 size={14} />Delete permanently</button>}</RowActionMenu></div>; })}<div className="template-field-add"><select className="select" aria-label="Choose an equipment field" value={selectedLibraryId} onChange={(e) => selectField(e.target.value)}><option value="">Choose an equipment field</option>{[...equipmentFields].filter((field) => field.active && !fields.some((attachment) => attachment.libraryFieldId === field.id)).sort((a, b) => { const order = ["Serial number", "MAC address"]; const ai = order.indexOf(a.label); const bi = order.indexOf(b.label); return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi) || a.label.localeCompare(b.label); }).map((field) => <option key={field.id} value={field.id}>{field.label}</option>)}<option value="__new__">+ Create new field...</option></select><button type="button" className="button" onClick={addReusableField}><Plus size={14} />Add field</button></div></div>
    {deleteOpen && <div className="modal-backdrop" role="presentation"><div className="modal-panel" role="dialog" aria-modal="true" aria-labelledby={`delete-${type.id}`}><div className="modal-icon"><AlertTriangle size={20} /></div><h2 id={`delete-${type.id}`}>Delete {type.name} permanently?</h2><p className="muted">This cannot be undone. Deleting this equipment type removes its field setup and {usageCount} saved equipment {usageCount === 1 ? "entry" : "entries"} from site records. Fields used by other equipment types remain available.</p><div className="modal-actions"><button type="button" className="button" onClick={() => setDeleteOpen(false)}>Cancel</button><button type="button" className="button danger-solid" onClick={deleteType}><Trash2 size={15} />Delete permanently</button></div></div></div>}
    {deletingField && (() => { const usage = equipmentFieldUsage(deletingField.id); return <div className="modal-backdrop" role="presentation"><div className="modal-panel" role="alertdialog" aria-modal="true" aria-labelledby={`delete-field-${deletingField.id}`}><div className="modal-icon"><AlertTriangle size={20} /></div><h2 id={`delete-field-${deletingField.id}`}>Delete {deletingField.label} permanently?</h2><p className="muted">This cannot be undone. The field will be removed from {usage.attachmentCount} equipment {usage.attachmentCount === 1 ? "type" : "types"}, and {usage.savedValueCount} saved site {usage.savedValueCount === 1 ? "value" : "values"} will be deleted.</p><div className="modal-actions"><button type="button" className="button" onClick={() => setDeletingField(undefined)}>Cancel</button><button type="button" className="button danger-solid" onClick={async () => { if (await deleteEquipmentField(deletingField)) setDeletingField(undefined); }}><Trash2 size={15} />Delete field permanently</button></div></div></div>; })()}
    {renameOpen && <NameEditorModal title="Rename component type" label="Component type name" initialValue={type.name} existingNames={otherTypeNames} onClose={() => setRenameOpen(false)} onSave={(next) => { renameType(next); setRenameOpen(false); }} />}
    {newFieldOpen && <div className="modal-backdrop" role="presentation"><form className="modal-panel" role="dialog" aria-modal="true" aria-labelledby={`new-field-${type.id}`} onSubmit={createAndAttachField}><div className="modal-header"><div><h2 id={`new-field-${type.id}`}>Create equipment field</h2><p className="muted">Add a field to {type.name}. You can also use this field with other equipment types.</p></div><button type="button" className="button icon-button ghost" aria-label="Close field creator" onClick={() => { setNewFieldOpen(false); setNewFieldLabel(""); setNewFieldType("text"); }}><X size={17} /></button></div><div className="stack"><label>Field name<input autoFocus className="field" value={newFieldLabel} onChange={(e) => setNewFieldLabel(e.target.value)} placeholder="For example: Account ID" /></label><label>Field type<select className="select" value={newFieldType} onChange={(e) => setNewFieldType(e.target.value as ComponentFieldType)}><option value="text">Text</option><option value="mac">MAC address</option><option value="integer">Whole number</option><option value="boolean">Yes or No</option></select></label></div><div className="modal-actions"><button type="button" className="button" onClick={() => { setNewFieldOpen(false); setNewFieldLabel(""); setNewFieldType("text"); }}>Cancel</button><button className="button primary"><Plus size={15} />Create field</button></div></form></div>}
  </div>;
}

function installationRows(records: Installation[], refs: ReferenceData) {
  const fields = [...(refs.customFields ?? [])].sort((a, b) => a.order - b.order);
  const header = ["Site Name", "Installation ID", "Solution", "Contractor", "Install Date", "Status", "Island Group", "Region", "Region Code", "Province", "Province Code", "Locality", "Locality Code", "Barangay", "Barangay Code", "Address", "Remarks", ...fields.map((field) => field.label)];
  return [header, ...records.map((r) => [r.siteName, r.id, r.unitType, r.contractor, r.installDate, r.status, r.islandGroup, r.region, r.regionCode, r.province, r.provinceCode, r.municipality, r.municipalityCode, r.barangay, r.barangayCode, r.address, r.remarks, ...fields.map((field) => (r.customValues ?? {})[field.id] ?? "")])];
}

function downloadCsv(records: Installation[], refs: ReferenceData) {
  const quote = (value: string) => `"${String(value).replaceAll('"', '""')}"`;
  const csv = installationRows(records, refs).map((row) => row.map(quote).join(",")).join("\n");
  downloadBlob(new Blob([csv], { type: "text/csv" }), `fieldtrack-export-${today()}.csv`);
}

async function downloadXlsx(records: Installation[], refs: ReferenceData) {
  const wb = await createWorkbook();
  wb.addWorksheet("Installations").addRows(installationRows(records, refs));
  const labels = Array.from(new Set(refs.componentTypes.flatMap((type) => (type.fields ?? []).map((field) => libraryField(refs, field)?.label).filter(Boolean) as string[])));
  wb.addWorksheet("Components").addRows([["Installation ID", "Component Type", "Notes", ...labels], ...records.flatMap((record) => record.components.map((component) => { const fields = componentType(refs, component.type)?.fields ?? []; return [record.id, component.type, component.notes, ...labels.map((label) => { const field = fields.find((item) => libraryField(refs, item)?.label === label); return field ? (component.values ?? {})[field.id] ?? "" : ""; })]; }))]);
  const buffer = await wb.xlsx.writeBuffer();
  downloadBlob(new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), `fieldtrack-export-${today()}.xlsx`);
}
