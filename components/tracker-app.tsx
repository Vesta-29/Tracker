"use client";

import { ChangeEvent, Dispatch, FormEvent, SetStateAction, useEffect, useMemo, useRef, useState } from "react";
import ExcelJS from "exceljs";
import {
  Activity, AlertTriangle, BarChart3, CalendarRange, CheckCircle2, ChevronLeft, ChevronRight, CircleDot, ClipboardList,
  Download, FileSpreadsheet, GripVertical, History, ImagePlus, LayoutDashboard, LogOut, Menu, MessageSquareText, Package, Pencil, Plus, Power, RadioTower, Search, Wrench,
  Settings, Trash2, Upload, Users, X, ArrowUp, ArrowDown
} from "lucide-react";
import { defaultReferences, demoInstallations, locations } from "@/lib/demo-data";
import type { AuditEvent, Component, ComponentFieldAttachment, ComponentTypeOption, CustomFieldDefinition, CustomFieldType, EquipmentFieldLibraryItem, Installation, ReferenceData, ReferenceOption, ServiceVisit, ServiceVisitStatus, Status } from "@/lib/types";

type Page = "dashboard" | "installations" | "new" | "serviceVisits" | "import" | "settings";
type Filter = { search: string; status: string; contractor: string; region: string; province: string; municipality: string; barangay: string };
type ImportRow = { row: number; kind: "Site" | "Equipment"; subject: string; details: string; reference: string; valid: boolean; issue: string };
const emptyFilter: Filter = { search: "", status: "", contractor: "", region: "", province: "", municipality: "", barangay: "" };
const statusMeta: Record<Status, { label: string; color: string }> = {
  installed: { label: "Installed", color: "oklch(0.58 0.13 155)" },
  scheduled: { label: "Scheduled", color: "oklch(0.58 0.14 245)" },
  issue: { label: "Issue", color: "oklch(0.72 0.14 70)" },
  cancelled: { label: "Cancelled", color: "oklch(0.62 0.11 28)" },
};
const nav = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { id: "installations", label: "Sites", icon: ClipboardList },
  { id: "serviceVisits", label: "Service visits", icon: Wrench },
  { id: "import", label: "Import sites", icon: Upload },
  { id: "settings", label: "Admin settings", icon: Settings },
] as const;

function uid(prefix: string) { return `${prefix}-${Date.now().toString(36).toUpperCase()}`; }
function today() { return new Date().toISOString().slice(0, 10); }
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
function componentType(refs: ReferenceData, type: string) { return refs.componentTypes.find((option) => option.name === type); }
function libraryField(refs: ReferenceData, attachment: ComponentFieldAttachment) { return (refs.equipmentFields ?? []).find((field) => field.id === attachment.libraryFieldId); }
function visibleComponentFields(refs: ReferenceData, component: Component) { return (componentType(refs, component.type)?.fields ?? []).filter((field) => field.active || Boolean((component.values ?? {})[field.id])).sort((a, b) => a.order - b.order); }
function componentMacValues(refs: ReferenceData, component: Component) { return visibleComponentFields(refs, component).filter((field) => libraryField(refs, field)?.type === "mac").map((field) => normalizeMac((component.values ?? {})[field.id] ?? "")).filter(Boolean); }
function StatusPill({ status }: { status: Status }) { return <span className={`pill ${status}`}><span className="status-dot" style={{ background: statusMeta[status].color }} />{statusMeta[status].label}</span>; }
const currentUser = "Maria Santos";
const serviceStatusLabels: Record<ServiceVisitStatus, string> = { scheduled: "Scheduled", in_progress: "In progress", completed: "Completed", cancelled: "Cancelled" };
const auditFieldLabels: Record<string, string> = { siteName: "site name", unitType: "unit type", contractor: "contractor", installDate: "installation date", status: "status", region: "region", province: "province", municipality: "city or municipality", barangay: "barangay", address: "site address", remarks: "remarks" };
function createAudit(action: string, summary: string, changedFields: string[] = [], beforeData?: Record<string, unknown>, afterData?: Record<string, unknown>): AuditEvent { return { id: uid("AUDIT"), action, actor: currentUser, createdAt: new Date().toISOString(), summary, changedFields, beforeData, afterData }; }
function auditValue(field: string, value: unknown) { if (field === "status" && typeof value === "string" && value in statusMeta) return statusMeta[value as Status].label; return String(value || "blank"); }
function visitAuditSummary(visit: ServiceVisit, action: "created" | "updated") { const equipment = visit.componentChanges.map((change) => change.summary.toLowerCase()).join(", "); return `${currentUser} ${action} ${visit.type.toLowerCase()} service visit ${visit.id}${visit.ticketReference ? ` for ticket ${visit.ticketReference}` : ""}${equipment ? `. Equipment changes: ${equipment}` : ""}.`; }
function installationAudit(previous: Installation | undefined, next: Installation) {
  if (!previous) return createAudit("created", `${currentUser} created this site record.`);
  const tracked = ["siteName", "unitType", "contractor", "installDate", "status", "region", "province", "municipality", "barangay", "address", "remarks"] as const;
  const changed = tracked.filter((field) => previous[field] !== next[field]);
  const equipmentChanged = JSON.stringify(previous.components) !== JSON.stringify(next.components);
  const customFieldsChanged = JSON.stringify(previous.customValues) !== JSON.stringify(next.customValues);
  if (!changed.length && !equipmentChanged && !customFieldsChanged) return;
  const details = changed.length === 1 && !equipmentChanged && !customFieldsChanged
    ? `${auditFieldLabels[changed[0]]} from ${auditValue(changed[0], previous[changed[0]])} to ${auditValue(changed[0], next[changed[0]])}`
    : [changed.length ? `${changed.length} site ${changed.length === 1 ? "detail" : "details"}` : "", equipmentChanged ? "equipment" : "", customFieldsChanged ? "custom fields" : ""].filter(Boolean).join(", ");
  return createAudit("updated", `${currentUser} updated ${details}.`, changed, Object.fromEntries(changed.map((field) => [field, previous[field]])), Object.fromEntries(changed.map((field) => [field, next[field]])));
}

export default function TrackerApp() {
  const [loggedIn, setLoggedIn] = useState(false);
  const [page, setPage] = useState<Page>("dashboard");
  const [records, setRecords] = useState<Installation[]>(demoInstallations);
  const [refs, setRefs] = useState<ReferenceData>(defaultReferences);
  const [filters, setFilters] = useState<Filter>(emptyFilter);
  const [editing, setEditing] = useState<Installation | undefined>();
  const [toast, setToast] = useState("");
  const [mobileMenu, setMobileMenu] = useState(false);
  useEscape(() => setMobileMenu(false), mobileMenu);

  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [navAttempt, setNavAttempt] = useState<Page | null>(null);

  const filtered = useMemo(() => records.filter((r) =>
    (!filters.search || `${r.id} ${r.siteName} ${r.legacyKitNumber ?? ""} ${r.barangay} ${r.municipality}`.toLowerCase().includes(filters.search.toLowerCase())) &&
    (!filters.status || r.status === filters.status) &&
    (!filters.contractor || r.contractor === filters.contractor) &&
    (!filters.region || r.region === filters.region) &&
    (!filters.province || r.province === filters.province) &&
    (!filters.municipality || r.municipality === filters.municipality) &&
    (!filters.barangay || r.barangay === filters.barangay)
  ), [records, filters]);

  function notify(message: string) { setToast(message); setTimeout(() => setToast(""), 3000); }
  function save(record: Installation, dest: Page = "installations") {
    setRecords((current) => { const previous = current.find((item) => item.id === record.id); const audit = installationAudit(previous, record); const saved = { ...record, updatedBy: currentUser, auditEvents: audit ? [audit, ...(record.auditEvents ?? [])] : record.auditEvents ?? [] }; return previous ? current.map((item) => item.id === record.id ? saved : item) : [saved, ...current]; });
    setEditing(undefined); setPage(dest); setHasUnsavedChanges(false); setNavAttempt(null); notify("Site record saved.");
  }
  function saveServiceVisit(installationId: string, visit: ServiceVisit, components: Component[]) {
    setRecords((current) => current.map((record) => { if (record.id !== installationId) return record; const exists = record.serviceVisits.some((item) => item.id === visit.id); const action = exists ? "updated" : "created"; const audit = createAudit(`service_visit_${action}`, visitAuditSummary(visit, action), ["serviceVisits"]); return { ...record, components, serviceVisits: exists ? record.serviceVisits.map((item) => item.id === visit.id ? visit : item) : [visit, ...record.serviceVisits], updatedBy: currentUser, updatedAt: new Date().toISOString(), auditEvents: [audit, ...record.auditEvents] }; })); notify("Service visit saved.");
  }
  function startEdit(record: Installation) { setEditing(record); setPage("new"); }
  function navigate(next: Page) {
    if (page === "new" && hasUnsavedChanges) {
      setNavAttempt(next);
    } else {
      setEditing(undefined);
      setPage(next);
      setMobileMenu(false);
      setHasUnsavedChanges(false);
      setNavAttempt(null);
    }
  }
  if (!loggedIn) return <Login onLogin={() => setLoggedIn(true)} />;

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand"><span className="brand-mark"><RadioTower size={17} /></span>FieldTrack</div>
        <div className="nav">{nav.map(({ id, label, icon: Icon }) => { const active = page === id || (id === "installations" && page === "new"); return <button className={active ? "active" : ""} aria-current={active ? "page" : undefined} key={id} onClick={() => navigate(id)}><Icon size={17} />{label}</button>; })}</div>
      </aside>
      <main className="main">
        <header className="topbar">
          <div className="mobile-brand"><span className="brand-mark"><RadioTower size={16} /></span>FieldTrack</div>
          <div className="muted small desktop-context">Internal site registry</div>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}><div className="right"><strong>Maria Santos</strong><div className="small muted">Administrator</div></div><button className="button icon-button ghost" aria-label="Sign out" title="Sign out" onClick={() => setLoggedIn(false)}><LogOut size={17} /></button></div>
        </header>

        <div className="content">
          {page === "dashboard" && <Dashboard records={filtered} allRecords={records} refs={refs} filters={filters} setFilters={setFilters} setPage={setPage} />}
          {page === "installations" && <Installations records={filtered} refs={refs} filters={filters} setFilters={setFilters} startEdit={startEdit} setPage={setPage} />}
          {page === "serviceVisits" && <ServiceVisitsPage records={records} refs={refs} onSave={saveServiceVisit} />}
          {page === "new" && (
            <InstallationForm
              refs={refs}
              records={records}
              initial={editing}
              onSave={(rec) => {
                save(rec, navAttempt ?? "installations");
              }}
              onCancel={() => {
                setEditing(undefined);
                setPage(navAttempt ?? "installations");
                setHasUnsavedChanges(false);
                setNavAttempt(null);
              }}
              setHasUnsavedChanges={setHasUnsavedChanges}
              navAttempt={navAttempt}
              clearNavAttempt={() => setNavAttempt(null)}
            />
          )}
          {page === "import" && <ImportRecords refs={refs} records={records} notify={notify} />}
          {page === "settings" && <SettingsPage refs={refs} setRefs={setRefs} records={records} deleteComponentType={(type) => { setRefs({ ...refs, componentTypes: refs.componentTypes.filter((item) => item.id !== type.id) }); setRecords((current) => current.map((record) => ({ ...record, components: record.components.filter((component) => component.type !== type.name) }))); notify(`${type.name} and its saved equipment entries were deleted.`); }} renameRecordReferences={(target, from, to) => setRecords((current) => current.map((record) => ({ ...record, contractor: target === "contractors" && record.contractor === from ? to : record.contractor, unitType: target === "unitTypes" && record.unitType === from ? to : record.unitType, components: target === "componentTypes" ? record.components.map((component) => component.type === from ? { ...component, type: to } : component) : record.components, serviceVisits: target === "serviceVisitTypes" ? record.serviceVisits.map((visit) => visit.type === from ? { ...visit, type: to } : visit) : record.serviceVisits })))} notify={notify} />}
        </div>

      </main>
      <nav className="mobile-nav" aria-label="Mobile navigation">
        {nav.slice(0, 3).map(({ id, label, icon: Icon }) => { const active = page === id || (id === "installations" && page === "new"); return <button className={active ? "active" : ""} aria-current={active ? "page" : undefined} key={id} onClick={() => navigate(id)}><Icon size={18} /><span>{label === "Service visits" ? "Visits" : label}</span></button>; })}
        <button className={page === "import" || page === "settings" ? "active" : ""} aria-expanded={mobileMenu} aria-haspopup="dialog" onClick={() => setMobileMenu(true)}><Menu size={18} /><span>More</span></button>
      </nav>
      {mobileMenu && <div className="mobile-menu-backdrop" role="presentation" onClick={() => setMobileMenu(false)}><div className="mobile-menu-panel" role="dialog" aria-modal="true" aria-label="More navigation" onClick={(e) => e.stopPropagation()}><div className="section-title"><h2>More</h2><button type="button" className="button icon-button ghost" aria-label="Close menu" onClick={() => setMobileMenu(false)}><X size={17} /></button></div>{nav.slice(3).map(({ id, label, icon: Icon }) => <button type="button" className={`mobile-menu-link ${page === id ? "active" : ""}`} aria-current={page === id ? "page" : undefined} key={id} onClick={() => navigate(id)}><Icon size={18} />{label}</button>)}</div></div>}
      {toast && <div className="toast" role="status" aria-live="polite" aria-atomic="true">{toast}</div>}
    </div>
  );
}

function Login({ onLogin }: { onLogin: () => void }) {
  return <div className="login"><form className="login-card" onSubmit={(e) => { e.preventDefault(); onLogin(); }}>
    <div className="brand-mark login-mark"><RadioTower size={22} /></div>
    <p className="eyebrow">Workplace operations</p><h1>Sign in to FieldTrack</h1>
    <p className="muted" style={{ margin: "8px 0 20px" }}>Manage sites, deployed equipment, and contractor visits.</p>
    <div className="stack"><label>Email address<input required className="field" type="email" defaultValue="admin@fieldtrack.local" /></label><label>Password<input required className="field" type="password" defaultValue="password" /></label><button className="button primary" type="submit">Sign in</button></div>
    <p className="small muted" style={{ margin: "18px 0 0" }}>Demo mode: use the pre-filled credentials.</p>
  </form></div>;
}

function FilterBar({ refs, filters, setFilters }: { refs: ReferenceData; filters: Filter; setFilters: (f: Filter) => void }) {
  const locationRecords = Object.entries(locations).flatMap(([region, provinces]) => Object.entries(provinces).flatMap(([province, municipalities]) => Object.entries(municipalities as Record<string, readonly string[]>).flatMap(([municipality, barangays]) => barangays.map((barangay) => ({ region, province, municipality, barangay })))));
  const provinces = Array.from(new Set(locationRecords.filter((location) => !filters.region || location.region === filters.region).map((location) => location.province)));
  const municipalities = Array.from(new Set(locationRecords.filter((location) => (!filters.region || location.region === filters.region) && (!filters.province || location.province === filters.province)).map((location) => location.municipality)));
  const barangays = Array.from(new Set(locationRecords.filter((location) => (!filters.region || location.region === filters.region) && (!filters.province || location.province === filters.province) && (!filters.municipality || location.municipality === filters.municipality)).map((location) => location.barangay)));
  const active = filters.search || filters.status || filters.contractor || filters.region || filters.province || filters.municipality || filters.barangay;
  return <div className="filter-stack">
    <div className="toolbar filter-row">
      <div className="input-wrap"><Search className="input-icon" size={17} /><input className="field search" aria-label="Search sites" value={filters.search} onChange={(e) => setFilters({ ...filters, search: e.target.value })} placeholder="Search site, installation ID, or location" /></div>
      <select className="select" aria-label="Filter sites by contractor" value={filters.contractor} onChange={(e) => setFilters({ ...filters, contractor: e.target.value })}><option value="">All contractors</option>{refs.contractors.map((c) => <option key={c.id}>{c.name}</option>)}</select>
      <select className="select" aria-label="Filter sites by region" value={filters.region} onChange={(e) => setFilters({ ...filters, region: e.target.value, province: "", municipality: "", barangay: "" })}><option value="">All regions</option>{Object.keys(locations).map((r) => <option key={r}>{r}</option>)}</select>
      <select className="select" aria-label="Filter sites by province" value={filters.province} onChange={(e) => setFilters({ ...filters, province: e.target.value, municipality: "", barangay: "" })}><option value="">All provinces</option>{provinces.map((province) => <option key={province}>{province}</option>)}</select>
      <select className="select" aria-label="Filter sites by city or municipality" value={filters.municipality} onChange={(e) => setFilters({ ...filters, municipality: e.target.value, barangay: "" })}><option value="">All cities</option>{municipalities.map((municipality) => <option key={municipality}>{municipality}</option>)}</select>
      <select className="select" aria-label="Filter sites by barangay" value={filters.barangay} onChange={(e) => setFilters({ ...filters, barangay: e.target.value })}><option value="">All barangays</option>{barangays.map((barangay) => <option key={barangay}>{barangay}</option>)}</select>
      {active && <button className="button ghost" onClick={() => setFilters(emptyFilter)}><X size={16} />Clear</button>}
    </div>
    <div className="status-filter-row" role="group" aria-label="Filter sites by status">
      <button type="button" className={`button status-filter-pill ${!filters.status ? "active" : ""}`} aria-pressed={!filters.status} onClick={() => setFilters({ ...filters, status: "" })}>All sites</button>
      {(Object.keys(statusMeta) as Status[]).map((status) => <button type="button" className={`button status-filter-pill ${status} ${filters.status === status ? "active" : ""}`} aria-pressed={filters.status === status} key={status} onClick={() => setFilters({ ...filters, status })}><span className="status-dot" style={{ background: statusMeta[status].color }} />{statusMeta[status].label}</button>)}
    </div>
  </div>;
}

function Dashboard({ records, allRecords, refs, filters, setFilters, setPage }: { records: Installation[]; allRecords: Installation[]; refs: ReferenceData; filters: Filter; setFilters: (f: Filter) => void; setPage: (p: Page) => void }) {
  const counts = (Object.keys(statusMeta) as Status[]).map((status) => ({ status, count: records.filter((r) => r.status === status).length }));
  const contractors = refs.contractors.map(({ name }) => ({ name, count: records.filter((r) => r.contractor === name).length })).sort((a,b) => b.count-a.count);
  const max = Math.max(...contractors.map((c) => c.count), 1);
  return <>
    <div className="page-head"><div><p className="eyebrow">Overview</p><h1>Site dashboard</h1><p className="muted">Track site activity and review records that need follow-up.</p></div><button className="button primary" onClick={() => setPage("new")}><Plus size={16} />Add site</button></div>
    <div className="stats">{counts.map(({ status, count }) => <div className="stat" key={status}><div className="small muted">{statusMeta[status].label}</div><div className="stat-value">{count}<span className="status-dot" style={{ background: statusMeta[status].color }} /></div></div>)}</div>
    <div style={{ marginBottom: 16 }}><FilterBar refs={refs} filters={filters} setFilters={setFilters} /></div>
    <div className="two-pane">
      <div className="panel"><div className="panel-head"><div><h2>Recent sites</h2><div className="small muted">{records.length} matching records</div></div><button className="button ghost" onClick={() => setPage("installations")}>View all sites</button></div><RecordsTable records={records.slice(0, 6)} /></div>
      <div className="panel"><div className="panel-head"><div><h2>By contractor</h2><div className="small muted">Current filtered distribution</div></div><BarChart3 size={18} className="muted" /></div><div className="section">{contractors.map((c) => <div className="bar-row" key={c.name}><span className="small" title={c.name}>{c.name.split(" ")[0]}</span><span className="bar"><span style={{ width: `${(c.count/max)*100}%` }} /></span><strong>{c.count}</strong></div>)}</div></div>
    </div>
    {allRecords.some((r) => r.status === "issue") && <div className="notice" style={{ marginTop: 18 }}><strong>{allRecords.filter((r) => r.status === "issue").length} {allRecords.filter((r) => r.status === "issue").length === 1 ? "site needs" : "sites need"} attention.</strong> Open each issue record and review the next action.</div>}
    {allRecords.some((r) => !r.siteName) && <div className="notice" style={{ marginTop: 12 }}><strong>{allRecords.filter((r) => !r.siteName).length} imported sites still need names.</strong> Open each site record and assign a unique site name.</div>}
    {allRecords.some((r) => r.legacyKitNumber) && <div className="notice" style={{ marginTop: 12 }}><strong>{allRecords.filter((r) => r.legacyKitNumber).length} old kit numbers still need equipment assignments.</strong> Open each site record and assign the kit number to the correct equipment.</div>}
  </>;
}

function Installations({ records, refs, filters, setFilters, startEdit, setPage }: { records: Installation[]; refs: ReferenceData; filters: Filter; setFilters: (f: Filter) => void; startEdit: (r: Installation) => void; setPage: (p: Page) => void }) {
  return <>
    <div className="page-head"><div><p className="eyebrow">Registry</p><h1>Sites</h1><p className="muted">Find a site record and review its deployed equipment.</p></div><div className="toolbar"><button className="button" onClick={() => downloadCsv(records, refs)}><Download size={16} />Export CSV</button><button className="button" onClick={() => downloadXlsx(records, refs)}><FileSpreadsheet size={16} />Export XLSX</button><button className="button primary" onClick={() => setPage("new")}><Plus size={16} />Add site</button></div></div>
    <div style={{ marginBottom: 16 }}><FilterBar refs={refs} filters={filters} setFilters={setFilters} /></div>
    <div className="panel"><div className="panel-head"><strong>{records.length} records</strong><span className="small muted">Showing 1-{Math.min(records.length, 20)} of {records.length}</span></div><RecordsTable records={records} onSelect={startEdit} /><div className="pagination"><span className="small muted">20 rows per page</span><div className="toolbar"><button className="button icon-button" aria-label="Previous page" disabled><ChevronLeft size={16} /></button><button className="button icon-button" aria-label="Next page" disabled><ChevronRight size={16} /></button></div></div></div>
  </>;
}

function RecordsTable({ records, onSelect }: { records: Installation[]; onSelect?: (r: Installation) => void }) {
  if (!records.length) return <div className="empty"><ClipboardList size={25} /><p><strong>No sites match these filters.</strong></p><span>Clear a filter or add a site record.</span></div>;
  return <div className="table-wrap"><table><thead><tr><th>Site name</th><th>Installation ID</th><th>Location</th><th>Contractor</th><th>Installation date</th><th>Status</th><th>Equipment</th>{onSelect && <th><span className="sr-only">Actions</span></th>}</tr></thead><tbody>{records.map((r) => <tr key={r.id} onClick={() => onSelect?.(r)} style={{ cursor: onSelect ? "pointer" : "default" }}><td>{r.siteName || <span className="pill issue">Site name required</span>}</td><td><strong>{r.id}</strong></td><td>{r.barangay}, {r.municipality}</td><td>{r.contractor}</td><td>{niceDate(r.installDate)}</td><td><StatusPill status={r.status} /></td><td>{r.components.length}</td>{onSelect && <td><button type="button" className="button icon-button ghost" aria-label={`View ${r.siteName || r.id}`} onClick={(event) => { event.stopPropagation(); onSelect(r); }}><ChevronRight size={16} /></button></td>}</tr>)}</tbody></table></div>;
}

function ServiceVisitsPage({ records, refs, onSave }: { records: Installation[]; refs: ReferenceData; onSave: (installationId: string, visit: ServiceVisit, components: Component[]) => void }) {
  const allDates = records.flatMap((r) => r.serviceVisits.map((v) => v.scheduledDate)).filter(Boolean);
  const minDate = allDates.length ? allDates.reduce((a, b) => (a < b ? a : b)) : "";
  const maxDate = allDates.length ? allDates.reduce((a, b) => (a > b ? a : b)) : "";
  const [filters, setFilters] = useState({ search: "", status: "", type: "", contractor: "", from: minDate, to: maxDate });
  const [editing, setEditing] = useState<{ installation: Installation; visit?: ServiceVisit }>();
  const [newInstallationId, setNewInstallationId] = useState(records[0]?.id ?? "");
  const [chooseSite, setChooseSite] = useState(false);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);
  useEscape(() => setChooseSite(false), chooseSite);

  // Convert date strings to timestamps for slider math
  const minTs = minDate ? new Date(minDate).getTime() : 0;
  const maxTs = maxDate ? new Date(maxDate).getTime() : new Date().getTime();
  const tsRange = maxTs - minTs || 1;
  const fromTs = filters.from ? new Date(filters.from).getTime() : minTs;
  const toTs = filters.to ? new Date(filters.to).getTime() : maxTs;
  const fromPct = Math.round(((fromTs - minTs) / tsRange) * 100);
  const toPct = Math.round(((toTs - minTs) / tsRange) * 100);
  function tsToDate(ts: number) { return new Date(ts).toISOString().split("T")[0]; }

  useEffect(() => {
    if (!showDatePicker) return;
    function onDown(e: MouseEvent) { if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) setShowDatePicker(false); }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [showDatePicker]);

  const visits = records.flatMap((installation) => installation.serviceVisits.map((visit) => ({ installation, visit }))).filter(({ installation, visit }) =>
    (!filters.search || `${installation.siteName} ${installation.id} ${visit.ticketReference}`.toLowerCase().includes(filters.search.toLowerCase())) &&
    (!filters.status || visit.status === filters.status) && (!filters.type || visit.type === filters.type) && (!filters.contractor || visit.contractor === filters.contractor) &&
    (!filters.from || visit.scheduledDate >= filters.from) && (!filters.to || visit.scheduledDate <= filters.to)
  ).sort((a, b) => b.visit.scheduledDate.localeCompare(a.visit.scheduledDate));
  const counts = (Object.keys(serviceStatusLabels) as ServiceVisitStatus[]).map((status) => ({ status, count: visits.filter(({ visit }) => visit.status === status).length }));
  return <>
    <div className="page-head"><div><p className="eyebrow">Field support</p><h1>Service visits</h1><p className="muted">Track contractor maintenance, inspections, repairs, and equipment replacements.</p></div><button className="button primary" onClick={() => setChooseSite(true)}><Plus size={16} />New service visit</button></div>
    <div className="stats">{counts.map(({ status, count }) => <div className="stat" key={status}><div className="small muted">{serviceStatusLabels[status]}</div><div className="stat-value">{count}<Wrench size={17} className="muted" /></div></div>)}</div>
    <div className="panel"><div className="section"><div className="toolbar filter-row">
      <input className="field search" aria-label="Search service visits" placeholder="Search site or ticket" value={filters.search} onChange={(e) => setFilters({ ...filters, search: e.target.value })} />
      <select className="select" aria-label="Filter service visits by status" value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })}><option value="">All statuses</option>{Object.entries(serviceStatusLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select>
      <select className="select" aria-label="Filter service visits by type" value={filters.type} onChange={(e) => setFilters({ ...filters, type: e.target.value })}><option value="">All visit types</option>{refs.serviceVisitTypes.map((type) => <option key={type.id}>{type.name}</option>)}</select>
      <select className="select" aria-label="Filter service visits by contractor" value={filters.contractor} onChange={(e) => setFilters({ ...filters, contractor: e.target.value })}><option value="">All contractors</option>{refs.contractors.map((contractor) => <option key={contractor.id}>{contractor.name}</option>)}</select>
      <div className="drp-wrap" ref={pickerRef}>
        <button type="button" className="drp-trigger" aria-expanded={showDatePicker} aria-label="Open date range picker" onClick={() => setShowDatePicker(!showDatePicker)}>
          <CalendarRange size={13} />
          <span>{filters.from || minDate || "Start"}</span>
          <span className="drp-sep">–</span>
          <span>{filters.to || maxDate || "End"}</span>
        </button>
        {showDatePicker && (
          <div className="drp-panel" role="dialog" aria-label="Date range picker">
            <div className="drp-heading">Time Range</div>
            <div className="drp-field">
              <div className="drp-label-row">
                <span className="drp-label from">From</span>
                <input type="date" className="drp-date-input" aria-label="From date" value={filters.from} min={minDate} max={filters.to || maxDate}
                  onChange={(e) => setFilters({ ...filters, from: e.target.value })} />
              </div>
              <input type="range" className="drp-slider drp-slider-from" aria-label="From date slider" min={0} max={100} value={fromPct}
                style={{ "--drp-pct": `${fromPct}%` } as React.CSSProperties}
                onChange={(e) => { const ts = minTs + (Number(e.target.value) / 100) * tsRange; const d = tsToDate(ts); if (!filters.to || d <= filters.to) setFilters({ ...filters, from: d }); }} />
            </div>
            <div className="drp-field">
              <div className="drp-label-row">
                <span className="drp-label to">To</span>
                <input type="date" className="drp-date-input" aria-label="To date" value={filters.to} min={filters.from || minDate} max={maxDate}
                  onChange={(e) => setFilters({ ...filters, to: e.target.value })} />
              </div>
              <input type="range" className="drp-slider drp-slider-to" aria-label="To date slider" min={0} max={100} value={toPct}
                style={{ "--drp-pct": `${toPct}%` } as React.CSSProperties}
                onChange={(e) => { const ts = minTs + (Number(e.target.value) / 100) * tsRange; const d = tsToDate(ts); if (!filters.from || d >= filters.from) setFilters({ ...filters, to: d }); }} />
            </div>
          </div>
        )}
      </div>
    </div></div>
      <ServiceVisitTable visits={visits} onSelect={(installation, visit) => setEditing({ installation, visit })} />
    </div>
    {chooseSite && <div className="modal-backdrop" role="presentation"><div className="modal-panel" role="dialog" aria-modal="true" aria-labelledby="choose-visit-site"><div className="modal-header"><div><h2 id="choose-visit-site">Choose a site</h2><p className="muted">Select the site receiving contractor support.</p></div><button type="button" className="button icon-button ghost" aria-label="Close site chooser" onClick={() => setChooseSite(false)}><X size={17} /></button></div><label>Site<select autoFocus className="select" value={newInstallationId} onChange={(e) => setNewInstallationId(e.target.value)}>{records.map((record) => <option value={record.id} key={record.id}>{record.siteName || record.id}</option>)}</select></label><div className="modal-actions"><button type="button" className="button" onClick={() => setChooseSite(false)}>Cancel</button><button type="button" className="button primary" onClick={() => { const installation = records.find((record) => record.id === newInstallationId); if (installation) { setChooseSite(false); setEditing({ installation }); } }}><Plus size={15} />Continue</button></div></div></div>}
    {editing && <ServiceVisitModal refs={refs} installation={editing.installation} visit={editing.visit} onClose={() => setEditing(undefined)} onSave={(visit, components) => { onSave(editing.installation.id, visit, components); setEditing(undefined); }} />}
  </>;
}

function ServiceVisitTable({ visits, onSelect }: { visits: { installation: Installation; visit: ServiceVisit }[]; onSelect: (installation: Installation, visit: ServiceVisit) => void }) {
  if (!visits.length) return <div className="empty"><Wrench size={24} /><p><strong>No service visits match these filters.</strong></p></div>;
  return <div className="table-wrap"><table><thead><tr><th>Visit</th><th>Site</th><th>Type</th><th>Ticket</th><th>Contractor</th><th>Scheduled</th><th>Status</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>{visits.map(({ installation, visit }) => <tr key={visit.id} onClick={() => onSelect(installation, visit)} style={{ cursor: "pointer" }}><td><strong>{visit.id}</strong></td><td>{installation.siteName || installation.id}</td><td>{visit.type}</td><td>{visit.ticketReference || "None"}</td><td>{visit.contractor}</td><td>{niceDate(visit.scheduledDate)}</td><td><span className={`pill ${visit.status === "completed" ? "installed" : visit.status === "cancelled" ? "cancelled" : visit.status === "in_progress" ? "issue" : "scheduled"}`}>{serviceStatusLabels[visit.status]}</span></td><td><button type="button" className="button icon-button ghost" aria-label={`View service visit ${visit.id}`} onClick={(event) => { event.stopPropagation(); onSelect(installation, visit); }}><ChevronRight size={16} /></button></td></tr>)}</tbody></table></div>;
}

function AuditTimeline({ events }: { events: AuditEvent[] }) {
  if (!events.length) return <div className="empty"><History size={24} /><p><strong>No changes recorded yet.</strong></p></div>;
  return <div className="timeline">{[...events].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((event) => <div className="timeline-item" key={event.id}><span className="timeline-dot" /><div><strong>{event.summary}</strong><div className="small muted">{niceDateTime(event.createdAt)} by {event.actor}</div>{event.changedFields?.length ? <div className="small muted">Updated: {event.changedFields.map((field) => auditFieldLabels[field] ?? field).join(", ")}</div> : null}</div></div>)}</div>;
}

function ServiceVisitModal({ refs, installation, visit, onClose, onSave }: { refs: ReferenceData; installation: Installation; visit?: ServiceVisit; onClose: () => void; onSave: (visit: ServiceVisit, components: Component[]) => void }) {
  const now = new Date().toISOString(); const id = visit?.id ?? uid("VISIT");
  const [draft, setDraft] = useState<ServiceVisit>(visit ?? { id, type: refs.serviceVisitTypes.find((item) => item.active)?.name ?? "", status: "scheduled", ticketReference: "", contractor: installation.contractor, scheduledDate: today(), notes: "", photos: [], componentChanges: [], createdBy: currentUser, updatedBy: currentUser, createdAt: now, updatedAt: now });
  const [removedIds, setRemovedIds] = useState<string[]>([]);
  const [newComponents, setNewComponents] = useState<Component[]>([]);
  const [showEquipment, setShowEquipment] = useState(false);
  const [showPhotos, setShowPhotos] = useState(false);
  useEscape(onClose);
  const activeComponents = installation.components.filter((component) => !component.removedAt);
  const incompleteNewComponent = newComponents.some((component) => visibleComponentFields(refs, component).some((field) => field.active && field.required && !component.values[field.id]?.trim()));
  const invalidNewMac = newComponents.some((component) => visibleComponentFields(refs, component).some((field) => libraryField(refs, field)?.type === "mac" && component.values[field.id] && !normalizeMac(component.values[field.id])));
  function saveVisit() {
    const updatedAt = new Date().toISOString(); const changes = [...draft.componentChanges];
    const components = installation.components.map((component) => removedIds.includes(component.id) && !component.removedAt ? { ...component, removedAt: updatedAt, removedViaVisitId: draft.id } : component);
    removedIds.forEach((componentId) => { const component = installation.components.find((item) => item.id === componentId); if (component && !component.removedAt) changes.push({ id: uid("VISITCHANGE"), action: "removed", componentId, componentType: component.type, summary: `Removed ${component.type}` }); });
    newComponents.forEach((item) => { const component: Component = { ...item, values: Object.fromEntries(Object.entries(item.values).map(([key, value]) => { const field = visibleComponentFields(refs, item).find((candidate) => candidate.id === key); return [key, field && libraryField(refs, field)?.type === "mac" ? normalizeMac(value) : value]; })), installedAt: updatedAt, installedViaVisitId: draft.id }; components.push(component); changes.push({ id: uid("VISITCHANGE"), action: "installed", componentId: component.id, componentType: component.type, summary: `Installed ${component.type}` }); });
    onSave({ ...draft, updatedBy: currentUser, updatedAt, completedDate: draft.status === "completed" ? draft.completedDate || today() : draft.completedDate, componentChanges: changes }, components);
  }
  function photos(e: ChangeEvent<HTMLInputElement>) { const files = Array.from(e.target.files ?? []).slice(0, 4); setDraft({ ...draft, photos: [...draft.photos, ...files.map((file) => ({ name: file.name, url: URL.createObjectURL(file) }))] }); }
  return <div className="modal-backdrop" role="presentation"><div className="modal-panel modal-wide" role="dialog" aria-modal="true" aria-labelledby={`visit-${draft.id}`}>
    <div className="modal-header"><div><p className="eyebrow">Contractor revisit</p><h2 id={`visit-${draft.id}`}>{visit ? draft.id : "New service visit"}</h2></div><button type="button" className="button icon-button ghost" aria-label="Close service visit" onClick={onClose}><X size={17} /></button></div>
    <div className="grid-3"><label>Visit type<select className="select" value={draft.type} onChange={(e) => setDraft({ ...draft, type: e.target.value })}>{activeOptions(refs.serviceVisitTypes, draft.type).map((item) => <option key={item.id}>{item.name}</option>)}</select></label><label>Status<select className="select" value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value as ServiceVisitStatus })}>{Object.entries(serviceStatusLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label><label>Ticket reference<input className="field" value={draft.ticketReference} onChange={(e) => setDraft({ ...draft, ticketReference: e.target.value })} placeholder="Optional ticket number" /></label><label>Contractor<select className="select" value={draft.contractor} onChange={(e) => setDraft({ ...draft, contractor: e.target.value })}>{activeOptions(refs.contractors, draft.contractor).map((item) => <option key={item.id}>{item.name}</option>)}</select></label><label>Scheduled date<input className="field" type="date" value={draft.scheduledDate} onChange={(e) => setDraft({ ...draft, scheduledDate: e.target.value })} /></label><label>Completed date<input className="field" type="date" value={draft.completedDate ?? ""} onChange={(e) => setDraft({ ...draft, completedDate: e.target.value })} /></label></div>
    <label className="field-block">Visit notes<textarea className="textarea" rows={3} value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} placeholder="Work performed, findings, and follow-up actions" /></label>
    <div className="visit-section"><button type="button" className="button disclosure-button" aria-expanded={showEquipment} onClick={() => setShowEquipment(!showEquipment)}>{showEquipment ? "Hide equipment changes" : "Add equipment changes"}{removedIds.length + newComponents.length > 0 && <span className="pill scheduled">{removedIds.length + newComponents.length}</span>}</button>{showEquipment && <div className="visit-equipment"><h3>Equipment changes</h3><div className="small muted">Select equipment removed during this visit and add installed equipment with its required identifiers.</div>{activeComponents.map((component) => <label className="check-row" key={component.id}><input type="checkbox" checked={removedIds.includes(component.id)} onChange={(e) => setRemovedIds(e.target.checked ? [...removedIds, component.id] : removedIds.filter((id) => id !== component.id))} />Remove {component.type} {Object.values(component.values)[0] ? `(${Object.values(component.values)[0]})` : ""}</label>)}{newComponents.map((component) => <div className="component-template-row" key={component.id}><div className="component-row"><strong>Install {component.type}</strong>{visibleComponentFields(refs, component).map((field) => { const reusable = libraryField(refs, field); return reusable ? <label key={field.id}>{reusable.label}{field.required ? " *" : ""}<input className="field" value={component.values[field.id] ?? ""} onChange={(e) => setNewComponents(newComponents.map((item) => item.id === component.id ? { ...item, values: { ...item.values, [field.id]: e.target.value } } : item))} placeholder={reusable.type === "mac" ? "AA:BB:CC:DD:EE:FF" : reusable.label} /></label> : null; })}<button type="button" className="button icon-button danger" aria-label={`Remove new ${component.type}`} onClick={() => setNewComponents(newComponents.filter((item) => item.id !== component.id))}><Trash2 size={14} /></button></div></div>)}{incompleteNewComponent && <div className="notice validation-notice" role="alert"><strong>Complete the required replacement equipment fields.</strong></div>}{invalidNewMac && <div className="notice validation-notice" role="alert"><strong>Check the replacement MAC address format.</strong></div>}<div className="toolbar"><select className="select" aria-label="Choose installed component type" id={`new-component-${draft.id}`} defaultValue=""><option value="">Choose installed component</option>{refs.componentTypes.filter((item) => item.active).map((item) => <option key={item.id}>{item.name}</option>)}</select><button type="button" className="button" onClick={() => { const select = document.getElementById(`new-component-${draft.id}`) as HTMLSelectElement; if (select.value) { setNewComponents([...newComponents, { id: uid("CMP"), type: select.value, values: {}, notes: "" }]); select.value = ""; } }}><Plus size={14} />Add installed equipment</button></div></div>}</div>
    <div className="visit-section"><button type="button" className="button disclosure-button" aria-expanded={showPhotos} onClick={() => setShowPhotos(!showPhotos)}>{showPhotos ? "Hide visit photos" : "Add visit photos"}{draft.photos.length > 0 && <span className="pill scheduled">{draft.photos.length}</span>}</button>{showPhotos && <><label className="dropzone compact"><ImagePlus size={18} style={{ margin: "auto" }} /><span>Choose optional visit photos</span><input type="file" accept="image/*" multiple hidden onChange={photos} /></label>{draft.photos.length > 0 && <p className="small muted">{draft.photos.map((photo) => photo.name).join(", ")}</p>}</>}</div>
    <div className="modal-actions"><button type="button" className="button" onClick={onClose}>Cancel</button><button type="button" className="button primary" disabled={incompleteNewComponent || invalidNewMac} onClick={saveVisit}>Save service visit</button></div>
  </div></div>;
}

function InstallationForm({
  refs,
  records,
  initial,
  onSave,
  onCancel,
  setHasUnsavedChanges,
  navAttempt,
  clearNavAttempt
}: {
  refs: ReferenceData;
  records: Installation[];
  initial?: Installation;
  onSave: (r: Installation) => void;
  onCancel: () => void;
  setHasUnsavedChanges: (dirty: boolean) => void;
  navAttempt: Page | null;
  clearNavAttempt: () => void;
}) {
  const createdAt = new Date().toISOString();
  const [record, setRecord] = useState<Installation>(initial ?? { id: uid("INS"), siteName: "", unitType: refs.unitTypes.find((x) => x.active)?.name ?? "", contractor: refs.contractors.find((x) => x.active)?.name ?? "", installDate: today(), status: "scheduled", region: "", province: "", municipality: "", barangay: "", address: "", remarks: "", components: [], customValues: {}, photos: [], createdBy: currentUser, createdAt, updatedBy: currentUser, updatedAt: createdAt, serviceVisits: [], auditEvents: [] });
  const [tab, setTab] = useState<"overview" | "visits" | "audit">("overview");
  const [visitOpen, setVisitOpen] = useState<ServiceVisit | null>();
  const [showRemoved, setShowRemoved] = useState(false);
  const [editingDetails] = useState(true);
  const [noteComponentId, setNoteComponentId] = useState<string>();
  const [showExitModal, setShowExitModal] = useState(false);

  const [original] = useState<Installation>(() => JSON.parse(JSON.stringify(record)));
  const isDirty = useMemo(() => {
    return JSON.stringify(record) !== JSON.stringify(original);
  }, [record, original]);

  useEffect(() => {
    setHasUnsavedChanges(isDirty);
    return () => setHasUnsavedChanges(false);
  }, [isDirty, setHasUnsavedChanges]);

  const shouldShowExitModal = showExitModal || Boolean(navAttempt);

  const duplicate = record.siteName && records.some((r) => r.siteName.toLowerCase() === record.siteName.toLowerCase() && r.id !== record.id);
  const provinces = record.region ? Object.keys(locations[record.region as keyof typeof locations] ?? {}) : [];
  const municipalities = record.region && record.province ? Object.keys((locations[record.region as keyof typeof locations] as Record<string, Record<string, readonly string[]>>)?.[record.province] ?? {}) : [];
  const barangays = record.region && record.province && record.municipality ? ((locations[record.region as keyof typeof locations] as Record<string, Record<string, readonly string[]>>)?.[record.province]?.[record.municipality] ?? []) : [];
  const patch = (data: Partial<Installation>) => setRecord((r) => ({ ...r, ...data }));
  const activeFields = (refs.customFields ?? []).filter((field) => field.active || Boolean((record.customValues ?? {})[field.id])).sort((a, b) => a.order - b.order);
  const activeComponents = record.components.filter((component) => !component.removedAt);
  const invalidMac = activeComponents.some((component) => visibleComponentFields(refs, component).some((field) => libraryField(refs, field)?.type === "mac" && (component.values ?? {})[field.id] && !normalizeMac((component.values ?? {})[field.id])));
  const allMacs = activeComponents.flatMap((component) => componentMacValues(refs, component));
  const duplicateMac = activeComponents.find((component) => componentMacValues(refs, component).some((mac) => allMacs.filter((value) => value === mac).length > 1 || records.some((installation) => installation.id !== record.id && installation.components.some((existing) => !existing.removedAt && componentMacValues(refs, existing).includes(mac)))));
  const duplicateMacInstallation = duplicateMac && records.find((installation) => installation.id !== record.id && installation.components.some((existing) => !existing.removedAt && componentMacValues(refs, existing).some((mac) => componentMacValues(refs, duplicateMac).includes(mac))));
  const missingComponentValue = activeComponents.some((component) => visibleComponentFields(refs, component).some((field) => field.active && field.required && !(component.values ?? {})[field.id]?.trim()));

  function submit(e: FormEvent) { e.preventDefault(); if (duplicate || invalidMac || missingComponentValue || (duplicateMac && !duplicateMac.duplicateMacAcknowledged)) return; onSave({ ...record, components: record.components.map((component) => ({ ...component, values: Object.fromEntries(Object.entries(component.values ?? {}).map(([id, value]) => { const attachment = visibleComponentFields(refs, component).find((field) => field.id === id); return [id, attachment && libraryField(refs, attachment)?.type === "mac" && value ? normalizeMac(value) : value]; })) })), updatedAt: new Date().toISOString() }); }
  function addComponent() { patch({ components: [...record.components, { id: uid("CMP"), type: refs.componentTypes.find((x) => x.active)?.name ?? "", values: {}, notes: "", installedAt: new Date().toISOString() }] }); }
  function componentPatch(id: string, data: Partial<Component>) { patch({ components: record.components.map((c) => c.id === id ? { ...c, ...data } : c) }); }
  function photos(e: ChangeEvent<HTMLInputElement>) { const files = Array.from(e.target.files ?? []).slice(0, 4); patch({ photos: [...record.photos, ...files.map((file) => ({ name: file.name, url: URL.createObjectURL(file) }))] }); }

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
    if (duplicate || invalidMac || missingComponentValue || (duplicateMac && !duplicateMac.duplicateMacAcknowledged)) {
      alert("Please fix form validation errors before saving.");
      return;
    }
    setShowExitModal(false);
    onSave({ ...record, components: record.components.map((component) => ({ ...component, values: Object.fromEntries(Object.entries(component.values ?? {}).map(([id, value]) => { const attachment = visibleComponentFields(refs, component).find((field) => field.id === id); return [id, attachment && libraryField(refs, attachment)?.type === "mac" && value ? normalizeMac(value) : value]; })) })), updatedAt: new Date().toISOString() });
  }

  return <form onSubmit={submit}>
    <div className="page-head site-record-head"><div><p className="eyebrow">{initial ? "Site record" : "New site"}</p><div className="site-record-heading-row"><h1>{initial ? initial.siteName || "Site name required" : "Add a site record"}</h1>{initial && <StatusPill status={record.status} />}</div>{initial && <div className="small muted record-id">Installation ID: {initial.id}</div>}<p className="muted site-record-description">{initial ? "Update site details and deployed equipment." : "Review site details, contractor visits, and change history."}</p></div><div className="toolbar site-record-actions"><button type="button" className="button" onClick={() => { if (isDirty) { setShowExitModal(true); } else { onCancel(); } }}>{initial ? "Back to sites" : "Cancel"}</button><button className="button primary">{initial ? "Save changes" : "Save site"}</button></div></div>
    <div className="tabs" role="tablist" aria-label="Site record sections"><button type="button" role="tab" aria-selected={tab === "overview"} className={tab === "overview" ? "active" : ""} onClick={() => setTab("overview")}>Overview</button><button type="button" role="tab" aria-selected={tab === "visits"} className={tab === "visits" ? "active" : ""} onClick={() => setTab("visits")}>Service visits <span>{record.serviceVisits.length}</span></button><button type="button" role="tab" aria-selected={tab === "audit"} className={tab === "audit" ? "active" : ""} onClick={() => setTab("audit")}>Change log <span>{record.auditEvents.length}</span></button></div>
    {tab === "overview" && <fieldset className="panel site-fields editing" role="tabpanel">
      <section className="section ownership-grid"><div><span className="small muted">Created by</span><strong>{record.createdBy}</strong></div><div><span className="small muted">Created</span><strong>{niceDateTime(record.createdAt)}</strong></div><div><span className="small muted">Updated by</span><strong>{record.updatedBy}</strong></div><div><span className="small muted">Last updated</span><strong>{niceDateTime(record.updatedAt)}</strong></div></section>
      <section id="site-details-section" className="section site-details-polish site-details-guided"><div className="section-title"><div><h2>Site details</h2><span className="small muted">Identity, ownership, and current installation state</span></div></div><div className="grid-3">
        <label>Site name<input required className="field" value={record.siteName} onChange={(e) => patch({ siteName: e.target.value })} placeholder="Workplace site name" /></label>
        <label>Unit type<select className="select" value={record.unitType} onChange={(e) => patch({ unitType: e.target.value })}>{activeOptions(refs.unitTypes, record.unitType).map((x) => <option key={x.id}>{x.name}</option>)}</select></label>
        <label>Contractor<select className="select" value={record.contractor} onChange={(e) => patch({ contractor: e.target.value })}>{activeOptions(refs.contractors, record.contractor).map((x) => <option key={x.id}>{x.name}</option>)}</select></label>
        <label>Installation date<input required className="field" type="date" value={record.installDate} onChange={(e) => patch({ installDate: e.target.value })} /></label>
        <label>Status<select className="select" value={record.status} onChange={(e) => patch({ status: e.target.value as Status })}>{Object.keys(statusMeta).map((x) => <option key={x}>{x}</option>)}</select></label>
      </div>{duplicate && <div className="notice validation-notice inline" role="alert"><strong>This site name already exists.</strong> Enter a unique site name before saving.</div>}{record.legacyKitNumber && <div className="notice inline legacy-kit-prompt"><span className="small migration-label">Migration follow-up</span><strong>Assign old kit number: {record.legacyKitNumber}</strong><div className="small">Add the correct equipment, enter this value in its kit-number field, then mark this follow-up as assigned.</div><button type="button" className="button" onClick={() => patch({ legacyKitNumber: undefined })}>Mark kit number assigned</button></div>}</section>
      <section className="section"><div className="section-title"><h2>Site location</h2><span className="small muted">PSGC-aligned fields</span></div><div className="grid-4">
        <label>Region<select required className="select" value={record.region} onChange={(e) => patch({ region: e.target.value, province: "", municipality: "", barangay: "" })}><option value="">Select region</option>{Object.keys(locations).map((x) => <option key={x}>{x}</option>)}</select></label>
        <label>Province<select required className="select" value={record.province} onChange={(e) => patch({ province: e.target.value, municipality: "", barangay: "" })}><option value="">Select province</option>{provinces.map((x) => <option key={x}>{x}</option>)}</select></label>
        <label>City or municipality<select required className="select" value={record.municipality} onChange={(e) => patch({ municipality: e.target.value, barangay: "" })}><option value="">Select city</option>{municipalities.map((x) => <option key={x}>{x}</option>)}</select></label>
        <label>Barangay<select required className="select" value={record.barangay} onChange={(e) => patch({ barangay: e.target.value })}><option value="">Select barangay</option>{barangays.map((x) => <option key={x}>{x}</option>)}</select></label>
      </div><label className="field-block">Site address or landmark<input className="field" value={record.address} onChange={(e) => patch({ address: e.target.value })} placeholder="Optional street, purok, or landmark" /></label></section>
      {activeFields.length > 0 && <section className="section"><div className="section-title"><div><h2>Additional information</h2><span className="small muted">Configured by your workplace administrator.</span></div></div><div className="grid-3">{activeFields.map((field) => <CustomFieldInput field={field} value={(record.customValues ?? {})[field.id] ?? ""} onChange={(value) => patch({ customValues: { ...(record.customValues ?? {}), [field.id]: value } })} key={field.id} />)}</div></section>}
      <section className="section"><div className="section-title"><div><h2>Equipment</h2><span className="small muted">Record the identifiers shown for each equipment type.</span></div><div className="toolbar">{record.components.some((component) => component.removedAt) && <button type="button" className="button" aria-expanded={showRemoved} onClick={() => setShowRemoved(!showRemoved)}>{showRemoved ? "Hide" : "Show"} removed equipment</button>}<button type="button" className="button" onClick={addComponent}><Plus size={15} />Add equipment</button></div></div>
        {!record.components.filter((component) => !component.removedAt).length && <div className="dropzone muted">No active equipment recorded yet. Add each device or kit deployed at this site.</div>}
        {record.components.filter((component) => !editingDetails || showRemoved || !component.removedAt).map((c) => <div className={`component-template-row ${c.removedAt ? "removed-component" : ""}`} key={c.id}><div className="component-row"><label>Component type<select disabled={Boolean(c.removedAt)} className="select" value={c.type} onChange={(e) => componentPatch(c.id, { type: e.target.value, values: {}, duplicateMacAcknowledged: false })}>{activeOptions(refs.componentTypes, c.type).map((x) => <option key={x.id}>{x.name}</option>)}</select></label>{visibleComponentFields(refs, c).map((field) => { const reusable = libraryField(refs, field); if (!reusable) return null; return <label key={field.id}>{reusable.label}{field.required ? " *" : ""}<input disabled={Boolean(c.removedAt)} required={field.required && !c.removedAt} className="field" value={(c.values ?? {})[field.id] ?? ""} onChange={(e) => componentPatch(c.id, { values: { ...(c.values ?? {}), [field.id]: e.target.value }, duplicateMacAcknowledged: false })} onBlur={() => reusable.type === "mac" && (c.values ?? {})[field.id] && normalizeMac((c.values ?? {})[field.id]) && componentPatch(c.id, { values: { ...(c.values ?? {}), [field.id]: normalizeMac((c.values ?? {})[field.id]) } })} placeholder={reusable.type === "mac" ? "AA:BB:CC:DD:EE:FF" : reusable.label} /></label>; })}<span className="note-action"><button type="button" className={`button icon-button ${c.notes ? "has-note" : ""}`} aria-label={c.notes ? "View or edit component note" : "Add component note"} title={c.notes ? "View or edit component note" : "Add component note"} onClick={() => setNoteComponentId(c.id)}><MessageSquareText size={16} /></button>{c.notes && <span className="note-tooltip" role="tooltip">{c.notes}</span>}</span>{c.removedAt ? <span className="pill cancelled">Removed {niceDate(c.removedAt)}</span> : <button type="button" className="button icon-button danger" aria-label={`Remove ${c.type}`} title="Remove component" onClick={() => componentPatch(c.id, { removedAt: new Date().toISOString() })}><Trash2 size={16} /></button>}</div></div>)}
        {invalidMac && <div className="notice validation-notice inline" role="alert"><strong>Check the MAC address format.</strong> Use six hexadecimal pairs such as AA:BB:CC:DD:EE:FF.</div>}
        {missingComponentValue && <div className="notice validation-notice inline" role="alert"><strong>Complete the required equipment fields.</strong> Fill in every field marked with an asterisk before saving.</div>}
        {duplicateMac && <div className="notice validation-notice inline" role="alert"><label style={{ display: "flex", gridTemplateColumns: "auto 1fr", alignItems: "center", gap: 9 }}><input type="checkbox" checked={Boolean(duplicateMac.duplicateMacAcknowledged)} onChange={(e) => componentPatch(duplicateMac.id, { duplicateMacAcknowledged: e.target.checked })} />This MAC address already appears on {duplicateMacInstallation ? duplicateMacInstallation.id : "another device at this site"}. I reviewed the possible duplicate and want to save this site record.</label></div>}
      </section>
      <section className="section"><div className="grid-2"><div><div className="section-title"><h2>Remarks</h2></div><textarea className="textarea" rows={5} value={record.remarks} onChange={(e) => patch({ remarks: e.target.value })} placeholder="Activation notes, issue details, or follow-up action" /></div><div><div className="section-title"><h2>Site photos</h2><span className="small muted">Optional, up to 4 images</span></div><label className="dropzone"><ImagePlus size={21} style={{ margin: "auto" }} /><span>Choose site photos</span><input type="file" accept="image/*" multiple hidden onChange={photos} /></label>{record.photos.length > 0 && <p className="small muted">{record.photos.map((p) => p.name).join(", ")}</p>}</div></div></section>
    </fieldset>}
    {tab === "visits" && <div className="panel" role="tabpanel"><div className="panel-head"><div><h2>Service visits</h2><div className="small muted">Contractor revisits, maintenance, and equipment changes</div></div><button type="button" className="button primary" onClick={() => setVisitOpen(null)}><Plus size={15} />New service visit</button></div><ServiceVisitTable visits={record.serviceVisits.map((visit) => ({ installation: record, visit }))} onSelect={(_, visit) => setVisitOpen(visit)} /></div>}
    {tab === "audit" && <div className="panel" role="tabpanel"><div className="panel-head"><div><h2>Change log</h2><div className="small muted">Permanent history of record updates and service activity</div></div><History size={18} className="muted" /></div><AuditTimeline events={record.auditEvents} /></div>}
    {noteComponentId && <ComponentNoteModal component={record.components.find((component) => component.id === noteComponentId)} onChange={(notes) => componentPatch(noteComponentId, { notes })} onClose={() => setNoteComponentId(undefined)} />}
    {visitOpen !== undefined && <ServiceVisitModal refs={refs} installation={record} visit={visitOpen ?? undefined} onClose={() => setVisitOpen(undefined)} onSave={(visit, components) => { const exists = record.serviceVisits.some((item) => item.id === visit.id); const action = exists ? "updated" : "created"; const audit = createAudit(`service_visit_${action}`, visitAuditSummary(visit, action), ["serviceVisits"]); patch({ components, serviceVisits: exists ? record.serviceVisits.map((item) => item.id === visit.id ? visit : item) : [visit, ...record.serviceVisits], auditEvents: [audit, ...record.auditEvents] }); setVisitOpen(undefined); }} />}

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

function CustomFieldInput({ field, value, onChange }: { field: CustomFieldDefinition; value: string; onChange: (value: string) => void }) {
  const label = `${field.label}${field.required ? " *" : ""}`;
  if (field.type === "dropdown") return <label>{label}<select required={field.required} className="select" value={value} onChange={(e) => onChange(e.target.value)}><option value="">Select option</option>{activeOptions(field.options, value).map((option) => <option key={option.id}>{option.name}</option>)}</select></label>;
  return <label>{label}<input required={field.required} className="field" type={field.type} value={value} onChange={(e) => onChange(e.target.value)} placeholder={field.required ? "Required" : "Optional"} /></label>;
}

function ImportRecords({ refs, records, notify }: { refs: ReferenceData; records: Installation[]; notify: (s: string) => void }) {
  const [rows, setRows] = useState<ImportRow[]>([]);
  async function downloadTemplate() {
    const wb = new ExcelJS.Workbook();
    const customFields = (refs.customFields ?? []).filter((field) => field.active).sort((a, b) => a.order - b.order);
    const componentLabels = Array.from(new Set(refs.componentTypes.flatMap((type) => (type.fields ?? []).filter((field) => field.active).map((field) => libraryField(refs, field)?.label).filter(Boolean) as string[])));
    wb.addWorksheet("Installations").addRows([["External Ref", "Site Name", "Unit Type", "Contractor", "Install Date", "Status", "Region", "Province", "City/Municipality", "Barangay", "Address", "Remarks", ...customFields.map((field) => field.label)], ["ROW-001", "Cebu Hub 01", "Satellite broadband", refs.contractors.find((x) => x.active)?.name ?? "", today(), "installed", "Region VII", "Cebu", "Cebu City", "Lahug", "", "", ...customFields.map(() => "")]]);
    wb.addWorksheet("Components").addRows([["Installation Ref", "Component Type", "Notes", ...componentLabels], ["ROW-001", "Modem", "", ...componentLabels.map((label) => label === "Serial number" ? "MDM-00001" : label === "MAC address" ? "A4:5E:60:11:28:9C" : "")]]);
    wb.addWorksheet("Instructions").addRows([
      ["FieldTrack site import guide"],
      ["1. Add one site per row on the Installations sheet. Site Name is required and must be unique."],
      ["2. Give each site a unique External Ref, such as ROW-001. This links equipment to the correct site."],
      ["3. Add deployed equipment on the Components sheet. Enter the matching External Ref under Installation Ref."],
      ["4. Fill in the equipment fields that apply to the selected Component Type. Required fields are configured by your admin."],
      ["5. Enter MAC addresses as AA:BB:CC:DD:EE:FF, AA-BB-CC-DD-EE-FF, or 12 hexadecimal characters."],
      ["6. Upload the completed workbook in FieldTrack. Review any rows marked Needs attention before saving."],
      [],
      ["Allowed site statuses", "scheduled, installed, issue, cancelled"],
      [],
      ["Custom site fields", "Type or allowed choices"],
      ...customFields.map((field) => [`${field.label}${field.required ? " (required)" : ""}`, field.type === "dropdown" ? field.options.filter((option) => option.active).map((option) => option.name).join(", ") : field.type]),
    ]);
    const buffer = await wb.xlsx.writeBuffer(); const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" })); link.download = "fieldtrack-import-template.xlsx"; link.click();
  }
  async function load(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; if (!file) return;
    const wb = new ExcelJS.Workbook(); await wb.xlsx.load(await file.arrayBuffer()); const sheet = wb.getWorksheet("Installations") ?? wb.worksheets[0];
    const headers = (sheet.getRow(1).values as string[]).slice(1).map(String);
    const data: Record<string, string>[] = [];
    sheet.eachRow((row, rowNumber) => { if (rowNumber > 1) { const values = (row.values as string[]).slice(1); data.push(Object.fromEntries(headers.map((header, i) => [header, String(values[i] ?? "")]))); } });
    const installationRows = data.map((r, i) => {
      const siteName = String(r["Site Name"] ?? ""); const contractor = String(r.Contractor ?? ""); const status = String(r.Status ?? "").toLowerCase();
      const customIssue = (refs.customFields ?? []).filter((field) => field.active).map((field) => field.required && !r[field.label] ? `Missing ${field.label}` : field.type === "dropdown" && r[field.label] && !field.options.some((option) => option.active && option.name === r[field.label]) ? `Invalid ${field.label}` : "").find(Boolean);
      const issue = !siteName ? "Missing site name" : !refs.contractors.some((option) => option.active && option.name === contractor) ? "Unknown contractor" : !Object.keys(statusMeta).includes(status) ? "Invalid status" : customIssue ?? "";
      return { row: i + 2, kind: "Site" as const, subject: siteName, details: contractor, reference: `${r.Barangay ?? ""}, ${r["City/Municipality"] ?? ""}`, valid: !issue, issue };
    });
    const componentSheet = wb.getWorksheet("Components"); const componentRows: ImportRow[] = [];
    if (componentSheet) { const componentHeaders = (componentSheet.getRow(1).values as string[]).slice(1).map(String); const importedMacs = new Set<string>(); componentSheet.eachRow((row, rowNumber) => { if (rowNumber > 1) { const values = (row.values as string[]).slice(1); const item = Object.fromEntries(componentHeaders.map((header, i) => [header, String(values[i] ?? "")])); const template = componentType(refs, item["Component Type"]); const missing = template?.fields.find((field) => { const reusable = libraryField(refs, field); return field.active && field.required && reusable && !item[reusable.label]; }); const macField = template?.fields.find((field) => { const reusable = libraryField(refs, field); return field.active && reusable?.type === "mac" && item[reusable.label]; }); const missingReusable = missing ? libraryField(refs, missing) : undefined; const macReusable = macField ? libraryField(refs, macField) : undefined; const mac = macReusable ? item[macReusable.label] : ""; const normalized = normalizeMac(mac); const duplicate = normalized && (importedMacs.has(normalized) || records.some((record) => record.components.some((component) => componentMacValues(refs, component).includes(normalized)))); if (normalized) importedMacs.add(normalized); const issue = !template ? "Unknown equipment type" : missingReusable ? `Missing ${missingReusable.label}` : mac && !normalized ? "Check the MAC address format" : duplicate ? "Duplicate MAC address, review required" : ""; componentRows.push({ row: rowNumber, kind: "Equipment", subject: item["Component Type"] || "Equipment type required", details: item["Notes"], reference: item["Installation Ref"], valid: !issue, issue }); } }); }
    setRows([...installationRows, ...componentRows]);
  }
  const valid = rows.filter((r) => r.valid).length;
  return <>
    <div className="page-head"><div><p className="eyebrow">Bulk entry</p><h1>Import site records</h1><p className="muted">Upload a workbook, review the preview, then save rows that are ready.</p></div><button className="button" onClick={downloadTemplate}><Download size={16} />Download workbook template</button></div>
    <div className="panel"><section className="section"><label className="dropzone"><FileSpreadsheet size={26} style={{ margin: "auto" }} /><strong>Choose a completed workbook</strong><span className="small muted">Start with the FieldTrack template. Its Instructions sheet explains how to link equipment to each site.</span><input type="file" accept=".xlsx" hidden onChange={load} /></label></section>
    {rows.length > 0 && <><div className="panel-head"><div><strong>Review imported rows</strong><div className="small muted">{valid} ready to save, {rows.length-valid} need attention</div></div><button className="button primary" disabled={valid === 0} onClick={() => notify(`${valid} rows are ready to save. Demo mode does not write imported rows to the database.`)}>Save {valid} ready rows</button></div>
    <div className="table-wrap"><table><thead><tr><th>Sheet row</th><th>Type</th><th>Site or equipment</th><th>Contractor or notes</th><th>Location or site ref</th><th>Result</th></tr></thead><tbody>{rows.map((r) => <tr key={`${r.kind}-${r.row}`}><td>{r.row}</td><td>{r.kind}</td><td>{r.subject || "Site name required"}</td><td>{r.details || "None"}</td><td>{r.reference || "Missing"}</td><td>{r.valid ? <span className="pill installed"><CheckCircle2 size={13} />Ready</span> : <span className="pill issue"><AlertTriangle size={13} />{r.issue}</span>}</td></tr>)}</tbody></table></div></>}</div>
  </>;
}

type SettingsSection = "contractors" | "unitTypes" | "componentTypes" | "customFields" | "serviceVisitTypes";
function SettingsPage({ refs, setRefs, records, deleteComponentType, renameRecordReferences, notify }: { refs: ReferenceData; setRefs: Dispatch<SetStateAction<ReferenceData>>; records: Installation[]; deleteComponentType: (type: ComponentTypeOption) => void; renameRecordReferences: (target: Exclude<SettingsSection, "customFields">, from: string, to: string) => void; notify: (s: string) => void }) {
  const [section, setSection] = useState<SettingsSection>("contractors"); const [name, setName] = useState("");
  const [selectedComponentId, setSelectedComponentId] = useState(refs.componentTypes[0]?.id ?? "");
  const [fieldType, setFieldType] = useState<CustomFieldType>("text"); const [required, setRequired] = useState(false);
  const [deletingReference, setDeletingReference] = useState<{ section: "contractors" | "unitTypes"; option: ReferenceOption }>();
  const [deletingCustomField, setDeletingCustomField] = useState<CustomFieldDefinition>();
  useEscape(() => { setDeletingReference(undefined); setDeletingCustomField(undefined); }, Boolean(deletingReference || deletingCustomField));
  function add(e: FormEvent) { e.preventDefault(); if (!name.trim()) return; if (section === "customFields") { const customFields = refs.customFields ?? []; const newField: CustomFieldDefinition = { id: uid("FIELD"), label: name.trim(), type: fieldType, required, active: true, order: customFields.length, options: [] }; setRefs({ ...refs, customFields: [...customFields, newField] }); } else if (section === "componentTypes") { setRefs({ ...refs, componentTypes: [...refs.componentTypes, { id: uid("COMPONENT"), name: name.trim(), active: true, fields: [] }] }); } else { setRefs({ ...refs, [section]: [...refs[section], { id: uid("REF"), name: name.trim(), active: true }] }); } setName(""); setRequired(false); notify("Setting added."); }
  function patchOption(target: Exclude<SettingsSection, "customFields">, id: string, data: Partial<ReferenceOption>) { setRefs({ ...refs, [target]: refs[target].map((option) => option.id === id ? { ...option, ...data } : option) }); }
  function patchField(id: string, data: Partial<CustomFieldDefinition>) { setRefs({ ...refs, customFields: (refs.customFields ?? []).map((field) => field.id === id ? { ...field, ...data } : field) }); }
  function renameOption(target: Exclude<SettingsSection, "customFields">, option: ReferenceOption) { const next = window.prompt("Rename setting", option.name)?.trim(); if (next) { patchOption(target, option.id, { name: next }); renameRecordReferences(target, option.name, next); notify("Setting renamed."); } }
  function moveField(field: CustomFieldDefinition, direction: number) { const fields = [...(refs.customFields ?? [])].sort((a, b) => a.order - b.order); const index = fields.findIndex((item) => item.id === field.id); const swap = fields[index + direction]; if (!swap) return; setRefs({ ...refs, customFields: (refs.customFields ?? []).map((item) => item.id === field.id ? { ...item, order: swap.order } : item.id === swap.id ? { ...item, order: field.order } : item) }); }
  function referenceUsage(target: "contractors" | "unitTypes", option: ReferenceOption) { return records.filter((record) => target === "contractors" ? record.contractor === option.name : record.unitType === option.name).length; }
  function deleteReference(target: "contractors" | "unitTypes", option: ReferenceOption) { if (referenceUsage(target, option)) { setDeletingReference(undefined); notify(`${option.name} is still used by site records. Deactivate it instead.`); return; } setRefs((current) => ({ ...current, [target]: current[target].filter((item) => item.id !== option.id) })); setDeletingReference(undefined); notify(`${option.name} was deleted.`); }
  function customFieldUsage(field: CustomFieldDefinition) { return records.filter((record) => Boolean(record.customValues?.[field.id])).length; }
  function deleteCustomField(field: CustomFieldDefinition) { setRefs((current) => ({ ...current, customFields: current.customFields.filter((item) => item.id !== field.id) })); setDeletingCustomField(undefined); notify(`${field.label} was deleted.`); }
  const selectedComponent = refs.componentTypes.find((item) => item.id === selectedComponentId) ?? refs.componentTypes[0];
  return <>
    <div className="page-head"><div><p className="eyebrow">Administration</p><h1>Reference settings</h1><p className="muted">Maintain the choices available in site records and reports.</p></div></div>
    <div className="two-pane"><div className="panel"><div className="panel-head"><h2>{section === "contractors" ? "Contractors" : section === "unitTypes" ? "Unit types" : section === "componentTypes" ? "Component types" : section === "serviceVisitTypes" ? "Service visit types" : "Custom installation fields"}</h2></div>
      {section === "customFields" ? [...(refs.customFields ?? [])].sort((a, b) => a.order - b.order).map((field) => <CustomFieldSettings key={field.id} field={field} patchField={patchField} moveField={moveField} deleteField={() => setDeletingCustomField(field)} notify={notify} />) : section === "componentTypes" ? <div className="component-settings-layout"><div className="component-type-list">{refs.componentTypes.map((item) => <button type="button" className={item.id === selectedComponent?.id ? "selected" : ""} key={item.id} onClick={() => setSelectedComponentId(item.id)}><strong>{item.name}</strong><span>{item.fields.length} fields | {records.reduce((count, record) => count + record.components.filter((component) => component.type === item.name).length, 0)} installed</span></button>)}</div>{selectedComponent && <div className="component-type-editor"><ComponentTypeSettings key={selectedComponent.id} componentType={selectedComponent} equipmentFields={refs.equipmentFields ?? []} createEquipmentField={(field) => setRefs((current) => ({ ...current, equipmentFields: [...(current.equipmentFields ?? []), field] }))} usageCount={records.reduce((count, record) => count + record.components.filter((component) => component.type === selectedComponent.name).length, 0)} deleteType={() => deleteComponentType(selectedComponent)} patchType={(data) => setRefs((current) => ({ ...current, componentTypes: current.componentTypes.map((type) => type.id === selectedComponent.id ? { ...type, ...data } : type) }))} renameType={(next) => { renameRecordReferences("componentTypes", selectedComponent.name, next); setRefs((current) => ({ ...current, componentTypes: current.componentTypes.map((type) => type.id === selectedComponent.id ? { ...type, name: next } : type) })); }} notify={notify} /></div>}</div> : refs[section].map((item) => <div className="section settings-row" key={item.id}><div><strong>{item.name}</strong><div className="small muted">{item.active ? "Available for new records" : "Hidden from new records"}</div></div><div className="toolbar"><button type="button" className="button icon-button" title="Rename" onClick={() => renameOption(section, item)}><Pencil size={15} /></button><button type="button" className={`button icon-button ${item.active ? "danger" : ""}`} title={item.active ? "Deactivate" : "Reactivate"} onClick={() => { patchOption(section, item.id, { active: !item.active }); notify(item.active ? "Setting deactivated." : "Setting reactivated."); }}><Power size={15} /></button>{section !== "serviceVisitTypes" && <button type="button" className="button icon-button danger" title="Delete permanently" onClick={() => setDeletingReference({ section, option: item })}><Trash2 size={15} /></button>}</div></div>)}
      <form className="section toolbar" onSubmit={add}><input className="field" style={{ maxWidth: 280 }} value={name} onChange={(e) => setName(e.target.value)} placeholder={section === "customFields" ? "New field label" : "Add approved value"} />{section === "customFields" && <><select className="select" value={fieldType} onChange={(e) => setFieldType(e.target.value as CustomFieldType)}><option value="text">Text</option><option value="number">Number</option><option value="date">Date</option><option value="dropdown">Dropdown</option></select><label style={{ display: "flex", alignItems: "center", gap: 6 }}><input type="checkbox" checked={required} onChange={(e) => setRequired(e.target.checked)} />Required</label></>}<button className="button primary"><Plus size={15} />Add</button></form></div>
    <div className="panel"><div className="panel-head"><h2>Settings sections</h2></div><div className="nav" style={{ padding: 10 }}>{([["contractors", Users, "Contractors"], ["unitTypes", Package, "Unit types"], ["componentTypes", CircleDot, "Component types"], ["customFields", ClipboardList, "Custom installation fields"], ["serviceVisitTypes", Wrench, "Service visit types"]] as const).map(([id, Icon, label]) => <button key={id} onClick={() => setSection(id)} className={section === id ? "active" : ""} style={{ color: section === id ? "var(--ink)" : "var(--ink-muted)", background: section === id ? "var(--accent-soft)" : "transparent" }}><Icon size={16} />{label}</button>)}</div><div className="section small muted"><Activity size={16} style={{ marginBottom: 8 }} />Deactivated values remain on historical records. Admin changes are recorded in the production audit log.</div></div></div>
    {deletingReference && <div className="modal-backdrop" role="presentation"><div className="modal-panel" role="dialog" aria-modal="true" aria-labelledby="delete-reference"><div className="modal-icon"><AlertTriangle size={20} /></div><h2 id="delete-reference">{referenceUsage(deletingReference.section, deletingReference.option) ? `Cannot delete ${deletingReference.option.name}` : `Delete ${deletingReference.option.name} permanently?`}</h2><p className="muted">{referenceUsage(deletingReference.section, deletingReference.option) ? `This value is used by ${referenceUsage(deletingReference.section, deletingReference.option)} site records. Deactivate it instead so existing records remain accurate.` : "This removes the choice permanently. This cannot be undone."}</p><div className="modal-actions"><button type="button" className="button" onClick={() => setDeletingReference(undefined)}>{referenceUsage(deletingReference.section, deletingReference.option) ? "Close" : "Cancel"}</button>{!referenceUsage(deletingReference.section, deletingReference.option) && <button type="button" className="button danger-solid" onClick={() => deleteReference(deletingReference.section, deletingReference.option)}><Trash2 size={15} />Delete permanently</button>}</div></div></div>}
    {deletingCustomField && <div className="modal-backdrop" role="presentation"><div className="modal-panel" role="dialog" aria-modal="true" aria-labelledby="delete-custom-field"><div className="modal-icon"><AlertTriangle size={20} /></div><h2 id="delete-custom-field">Delete {deletingCustomField.label} permanently?</h2><p className="muted">This cannot be undone. Deleting this custom field removes {customFieldUsage(deletingCustomField)} saved site values and any configured dropdown choices.</p><div className="modal-actions"><button type="button" className="button" onClick={() => setDeletingCustomField(undefined)}>Cancel</button><button type="button" className="button danger-solid" onClick={() => deleteCustomField(deletingCustomField)}><Trash2 size={15} />Delete permanently</button></div></div></div>}
  </>;
}

function CustomFieldSettings({ field, patchField, moveField, deleteField, notify }: { field: CustomFieldDefinition; patchField: (id: string, data: Partial<CustomFieldDefinition>) => void; moveField: (field: CustomFieldDefinition, direction: number) => void; deleteField: () => void; notify: (message: string) => void }) {
  function rename() { const next = window.prompt("Rename custom field", field.label)?.trim(); if (next) { patchField(field.id, { label: next }); notify("Custom field renamed."); } }
  function addOption() { const name = window.prompt("Add dropdown option")?.trim(); if (name) { patchField(field.id, { options: [...field.options, { id: uid("OPTION"), name, active: true }] }); notify("Dropdown option added."); } }
  function patchDropdownOption(id: string, data: Partial<ReferenceOption>) { patchField(field.id, { options: field.options.map((option) => option.id === id ? { ...option, ...data } : option) }); }
  function renameDropdownOption(option: ReferenceOption) { const name = window.prompt("Rename dropdown option", option.name)?.trim(); if (name) { patchDropdownOption(option.id, { name }); notify("Dropdown option renamed."); } }
  return <div className="section">
    <div className="settings-row"><div><strong>{field.label}</strong><div className="small muted">{field.type}{field.required ? " | required" : " | optional"}{field.active ? "" : " | inactive"}</div></div><div className="toolbar"><button type="button" className="button icon-button" title="Move up" onClick={() => moveField(field, -1)}><ArrowUp size={15} /></button><button type="button" className="button icon-button" title="Move down" onClick={() => moveField(field, 1)}><ArrowDown size={15} /></button><button type="button" className="button icon-button" title="Rename" onClick={rename}><Pencil size={15} /></button><button type="button" className={`button icon-button ${field.active ? "danger" : ""}`} title={field.active ? "Deactivate" : "Reactivate"} onClick={() => patchField(field.id, { active: !field.active })}><Power size={15} /></button><button type="button" className="button icon-button danger" title="Delete permanently" onClick={deleteField}><Trash2 size={15} /></button></div></div>
    <label style={{ display: "flex", alignItems: "center", gap: 7, marginTop: 11 }}><input type="checkbox" checked={field.required} onChange={(e) => patchField(field.id, { required: e.target.checked })} />Required on new site records</label>
    {field.type === "dropdown" && <div className="option-list"><div className="small muted">Dropdown options</div>{field.options.map((option) => <div className="option-row" key={option.id}><span>{option.name}</span><div className="toolbar"><button type="button" className="button icon-button" title="Rename option" onClick={() => renameDropdownOption(option)}><Pencil size={14} /></button><button type="button" className={`button icon-button ${option.active ? "danger" : ""}`} title={option.active ? "Deactivate option" : "Reactivate option"} onClick={() => patchDropdownOption(option.id, { active: !option.active })}><Power size={14} /></button></div></div>)}<button type="button" className="button" style={{ marginTop: 8 }} onClick={addOption}><Plus size={14} />Add dropdown option</button></div>}
  </div>;
}

function ComponentTypeSettings({ componentType: type, equipmentFields, createEquipmentField, usageCount, deleteType, patchType, renameType, notify }: { componentType: ComponentTypeOption; equipmentFields: EquipmentFieldLibraryItem[]; createEquipmentField: (field: EquipmentFieldLibraryItem) => void; usageCount: number; deleteType: () => void; patchType: (data: Partial<ComponentTypeOption>) => void; renameType: (name: string) => void; notify: (message: string) => void }) {
  const fields = type.fields ?? [];
  const [selectedLibraryId, setSelectedLibraryId] = useState(equipmentFields.find((field) => field.active)?.id ?? "");
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [newFieldOpen, setNewFieldOpen] = useState(false);
  const [newFieldLabel, setNewFieldLabel] = useState("");
  const [newFieldType, setNewFieldType] = useState<"text" | "mac">("text");
  const [draggedFieldId, setDraggedFieldId] = useState<string>();
  const [dragOverFieldId, setDragOverFieldId] = useState<string>();
  useEscape(() => { setDeleteOpen(false); setNewFieldOpen(false); }, deleteOpen || newFieldOpen);
  function reorderField(sourceId: string, targetId: string) { if (sourceId === targetId) return; const ordered = [...fields].sort((a, b) => a.order - b.order); const moved = ordered.find((field) => field.id === sourceId); if (!moved) return; const reordered = ordered.filter((field) => field.id !== sourceId); const targetIndex = reordered.findIndex((field) => field.id === targetId); reordered.splice(targetIndex, 0, moved); patchType({ fields: reordered.map((field, order) => ({ ...field, order })) }); }
  function moveFieldWithKeyboard(fieldId: string, direction: number) { const ordered = [...fields].sort((a, b) => a.order - b.order); const index = ordered.findIndex((field) => field.id === fieldId); const target = ordered[index + direction]; if (!target) return; reorderField(fieldId, target.id); notify("Equipment field order updated."); }
  useEffect(() => {
    if (!draggedFieldId) return;
    function release() { setDraggedFieldId(undefined); setDragOverFieldId(undefined); notify("Equipment field order updated."); }
    window.addEventListener("pointerup", release);
    return () => window.removeEventListener("pointerup", release);
  });
  function addReusableField() { const reusable = equipmentFields.find((field) => field.id === selectedLibraryId); if (!reusable || fields.some((field) => field.libraryFieldId === reusable.id)) return; const field: ComponentFieldAttachment = { id: uid("EQUIPFIELD"), libraryFieldId: reusable.id, required: false, active: true, order: fields.length }; patchType({ fields: [...fields, field] }); notify("Equipment field added."); }
  function selectField(value: string) { if (value !== "__new__") { setSelectedLibraryId(value); return; } setSelectedLibraryId(""); setNewFieldOpen(true); }
  function createAndAttachField(e: FormEvent) { e.preventDefault(); const label = newFieldLabel.trim(); if (!label) return; const reusable: EquipmentFieldLibraryItem = { id: uid("LIBRARYFIELD"), label, type: newFieldType, active: true }; createEquipmentField(reusable); patchType({ fields: [...fields, { id: uid("EQUIPFIELD"), libraryFieldId: reusable.id, required: false, active: true, order: fields.length }] }); setSelectedLibraryId(reusable.id); setNewFieldLabel(""); setNewFieldType("text"); setNewFieldOpen(false); notify("Equipment field created and added."); }
  function patchField(id: string, data: Partial<ComponentFieldAttachment>) { patchType({ fields: fields.map((field) => field.id === id ? { ...field, ...data } : field) }); }
  function rename() { const next = window.prompt("Rename component type", type.name)?.trim(); if (next) { renameType(next); notify("Component type renamed."); } }
  return <div className="section">
    <div className="settings-row"><div><strong>{type.name}</strong><div className="small muted">{type.active ? "Available for new records" : "Hidden from new records"} | {fields.length} configured fields | {usageCount} installed rows</div></div><div className="toolbar"><button type="button" className="button icon-button" title="Rename component type" onClick={rename}><Pencil size={15} /></button><button type="button" className={`button icon-button ${type.active ? "danger" : ""}`} title={type.active ? "Deactivate component type" : "Reactivate component type"} onClick={() => patchType({ active: !type.active })}><Power size={15} /></button><button type="button" className="button icon-button danger" title="Delete component type permanently" onClick={() => setDeleteOpen(true)}><Trash2 size={15} /></button></div></div>
    <div className="option-list"><div className="small muted">Equipment fields | drag the handle or use its arrow keys to reorder</div>{[...fields].sort((a, b) => a.order - b.order).map((field) => { const reusable = equipmentFields.find((item) => item.id === field.libraryFieldId); return <div className={`template-field-row ${draggedFieldId === field.id ? "dragging" : ""} ${dragOverFieldId === field.id ? "drag-over" : ""}`} key={field.id} onPointerEnter={() => { if (!draggedFieldId || draggedFieldId === field.id) return; setDragOverFieldId(field.id); reorderField(draggedFieldId, field.id); }}><button type="button" className="drag-handle" aria-label={`Reorder ${reusable?.label ?? "equipment field"}. Use arrow keys to move.`} title="Drag or use arrow keys to reorder" onPointerDown={(e) => { e.preventDefault(); setDraggedFieldId(field.id); setDragOverFieldId(field.id); }} onKeyDown={(e) => { if (e.key === "ArrowUp" || e.key === "ArrowLeft") { e.preventDefault(); moveFieldWithKeyboard(field.id, -1); } else if (e.key === "ArrowDown" || e.key === "ArrowRight") { e.preventDefault(); moveFieldWithKeyboard(field.id, 1); } }}><GripVertical size={16} /></button><span>{reusable?.label ?? "Missing equipment field"}</span><span className="small muted">{reusable?.type ?? "unknown"}</span><label style={{ display: "flex", alignItems: "center", gap: 5 }}><input type="checkbox" checked={field.required} onChange={(e) => patchField(field.id, { required: e.target.checked })} />Required</label><div className="toolbar"><button type="button" className={`button icon-button ${field.active ? "danger" : ""}`} title={field.active ? "Deactivate field" : "Reactivate field"} onClick={() => patchField(field.id, { active: !field.active })}><Power size={14} /></button></div></div>; })}<div className="toolbar" style={{ marginTop: 9 }}><select className="select" aria-label="Choose an equipment field" value={selectedLibraryId} onChange={(e) => selectField(e.target.value)}><option value="">Choose an equipment field</option>{[...equipmentFields].filter((field) => field.active && !fields.some((attachment) => attachment.libraryFieldId === field.id)).sort((a, b) => { const order = ["Serial number", "MAC address"]; const ai = order.indexOf(a.label); const bi = order.indexOf(b.label); return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi) || a.label.localeCompare(b.label); }).map((field) => <option key={field.id} value={field.id}>{field.label}</option>)}<option value="__new__">+ Create new field...</option></select><button type="button" className="button" onClick={addReusableField}><Plus size={14} />Add field</button></div></div>
    {deleteOpen && <div className="modal-backdrop" role="presentation"><div className="modal-panel" role="dialog" aria-modal="true" aria-labelledby={`delete-${type.id}`}><div className="modal-icon"><AlertTriangle size={20} /></div><h2 id={`delete-${type.id}`}>Delete {type.name} permanently?</h2><p className="muted">This cannot be undone. Deleting this equipment type removes its field setup and {usageCount} saved equipment {usageCount === 1 ? "entry" : "entries"} from site records. Fields used by other equipment types remain available.</p><div className="modal-actions"><button type="button" className="button" onClick={() => setDeleteOpen(false)}>Cancel</button><button type="button" className="button danger-solid" onClick={deleteType}><Trash2 size={15} />Delete permanently</button></div></div></div>}
    {newFieldOpen && <div className="modal-backdrop" role="presentation"><form className="modal-panel" role="dialog" aria-modal="true" aria-labelledby={`new-field-${type.id}`} onSubmit={createAndAttachField}><div className="modal-header"><div><h2 id={`new-field-${type.id}`}>Create equipment field</h2><p className="muted">Add a field to {type.name}. You can also use this field with other equipment types.</p></div><button type="button" className="button icon-button ghost" aria-label="Close field creator" onClick={() => { setNewFieldOpen(false); setNewFieldLabel(""); setNewFieldType("text"); }}><X size={17} /></button></div><div className="stack"><label>Field name<input autoFocus className="field" value={newFieldLabel} onChange={(e) => setNewFieldLabel(e.target.value)} placeholder="For example: Account ID" /></label><label>Field type<select className="select" value={newFieldType} onChange={(e) => setNewFieldType(e.target.value as "text" | "mac")}><option value="text">Text</option><option value="mac">MAC address</option></select></label></div><div className="modal-actions"><button type="button" className="button" onClick={() => { setNewFieldOpen(false); setNewFieldLabel(""); setNewFieldType("text"); }}>Cancel</button><button className="button primary"><Plus size={15} />Create field</button></div></form></div>}
  </div>;
}

function installationRows(records: Installation[], refs: ReferenceData) {
  const fields = [...(refs.customFields ?? [])].sort((a, b) => a.order - b.order);
  const header = ["Site Name", "Installation ID", "Unit Type", "Contractor", "Install Date", "Status", "Region", "Province", "City/Municipality", "Barangay", "Address", "Remarks", ...fields.map((field) => field.label)];
  return [header, ...records.map((r) => [r.siteName, r.id, r.unitType, r.contractor, r.installDate, r.status, r.region, r.province, r.municipality, r.barangay, r.address, r.remarks, ...fields.map((field) => (r.customValues ?? {})[field.id] ?? "")])];
}

function downloadCsv(records: Installation[], refs: ReferenceData) {
  const quote = (value: string) => `"${String(value).replaceAll('"', '""')}"`;
  const csv = installationRows(records, refs).map((row) => row.map(quote).join(",")).join("\n");
  const link = document.createElement("a"); link.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" })); link.download = `fieldtrack-export-${today()}.csv`; link.click();
}

async function downloadXlsx(records: Installation[], refs: ReferenceData) {
  const wb = new ExcelJS.Workbook();
  wb.addWorksheet("Installations").addRows(installationRows(records, refs));
  const labels = Array.from(new Set(refs.componentTypes.flatMap((type) => (type.fields ?? []).map((field) => libraryField(refs, field)?.label).filter(Boolean) as string[])));
  wb.addWorksheet("Components").addRows([["Installation ID", "Component Type", "Notes", ...labels], ...records.flatMap((record) => record.components.map((component) => { const fields = componentType(refs, component.type)?.fields ?? []; return [record.id, component.type, component.notes, ...labels.map((label) => { const field = fields.find((item) => libraryField(refs, item)?.label === label); return field ? (component.values ?? {})[field.id] ?? "" : ""; })]; }))]);
  const buffer = await wb.xlsx.writeBuffer(); const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" })); link.download = `fieldtrack-export-${today()}.xlsx`; link.click();
}

function setChooseSite(arg0: boolean): void {
  throw new Error("Function not implemented.");
}
